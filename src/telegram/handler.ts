import { Store, type OppRow } from "../db/store.js";
import { aiEnabled, settings } from "../lib/config.js";
import { answerCallback, editButtons, sendMessage } from "./api.js";
import { deadlineText, esc, formatEvidence } from "./format.js";
import { LINK_DAYS, trackerLink } from "../web/tracker.js";

/** Feedback -> ranking weights (bounded ±10 per key in the store). */
const FEEDBACK_DELTA: Record<string, number> = { apply: 2, save: 1, skip: -0.5, ni: -2 };
const STATUS: Record<string, string> = { apply: "preparing", save: "saved", skip: "skipped", ni: "not_interested" };
const ACK: Record<string, string> = {
  apply: "Marked as preparing ✅",
  save: "Saved 💾 — you'll get deadline reminders",
  skip: "Skipped",
  ni: "Got it — fewer like this 🚫",
};

const HELP = `<b>Commands</b>
/saved – saved & in-progress items
/deadlines – deadlines in the next 7 days
/tracker – everything by status
/web – private link to the tracker page (edit status, notes, blockers)
/status – agent status & AI spend
/pause – stop all automation (kill switch)
/resume – start again
/help – this list`;

function listRows(rows: OppRow[], empty: string) {
  if (!rows.length) return empty;
  return rows
    .map((r) => `• <b>${esc(r.title)}</b> [${r.status}]\n  ${esc(deadlineText(r))} · <a href="${esc(r.official_url)}">link</a>${r.blocking ? `\n  blocking: ${esc(r.blocking)}` : ""}`)
    .join("\n");
}

export interface TgUpdate {
  message?: { chat: { id: number; type?: string }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } };
}

export async function handleUpdate(u: TgUpdate, store = new Store()) {
  const chatId = u.message?.chat.id ?? u.callback_query?.message?.chat.id;
  if (chatId === undefined) return;
  const isPrivate = u.message ? u.message.chat.type === "private" : true;

  // First-time setup: the first private /start claims the bot. After that, everyone else is ignored.
  let owner = process.env.TELEGRAM_CHAT_ID || (await store.getSetting<string>("owner_chat_id"));
  if (!owner) {
    if (isPrivate && u.message?.text?.startsWith("/start")) {
      await store.setSetting("owner_chat_id", String(chatId));
      owner = String(chatId);
      await sendMessage(`✅ You're registered as the owner. Only you can use this bot.\n\n${HELP}`, undefined, String(chatId));
    }
    return;
  }
  if (String(chatId) !== String(owner)) return;
  const reply = (text: string, buttons?: Parameters<typeof sendMessage>[1]) => sendMessage(text, buttons, String(chatId));

  if (u.callback_query) {
    const [action, key] = (u.callback_query.data ?? "").split(":");
    const row = key ? await store.get(key) : null;
    if (!row) return answerCallback(u.callback_query.id, "Item not found");
    if (action === "src") {
      await answerCallback(u.callback_query.id, "Sources");
      return reply(formatEvidence(row));
    }
    if (!STATUS[action]) return answerCallback(u.callback_query.id, "Unknown action");
    await store.setStatus(key, STATUS[action], action === "apply" ? { blocking: "Application assistant arrives in Phase 3 — apply via the official page for now" } : {});
    await store.addFeedback(key, action);
    const d = FEEDBACK_DELTA[action];
    await store.bumpWeight(`type:${row.type}`, d / 2);
    if (row.provider) await store.bumpWeight(`provider:${row.provider.toLowerCase()}`, d);
    await answerCallback(u.callback_query.id, ACK[action]);
    const m = u.callback_query.message!;
    await editButtons(m.chat.id, m.message_id, [
      [{ text: `✔ ${ACK[action].split(" —")[0]}`, callback_data: `src:${key}` }],
      [{ text: "📄 Show sources", callback_data: `src:${key}` }, { text: "🔗 Official page", url: row.official_url }],
    ]);
    if (action === "apply") {
      const x = row.extracted;
      await reply(
        [
          `<b>Next steps: ${esc(row.title)}</b>`,
          x.howToApply.value ? `How to apply (from the page): <i>${esc(x.howToApply.value)}</i>` : "How to apply isn't stated clearly — check the page.",
          `Deadline: ${esc(deadlineText(row))}`,
          row.verdict === "check" ? `Check first: ${esc(row.eligibility.reasons.join("; "))}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
    return;
  }

  const text = (u.message?.text ?? "").trim();
  const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@.*/, "");
  switch (cmd) {
    case "/start":
    case "/help":
      return reply(`👋 Opportunity Agent is running.\n\n${HELP}`);
    case "/pause":
      await store.setPaused(true);
      return reply("⏸ Paused. No searches, digests or alerts until /resume.");
    case "/resume":
      await store.setPaused(false);
      return reply("▶️ Resumed.");
    case "/status": {
      const paused = await store.isPaused();
      const spent = await store.aiSpentThisMonth();
      const broken = await store.brokenSources(3);
      return reply(
        `${paused ? "⏸ Paused" : "▶️ Running"}\n${aiEnabled() ? `AI spend this month: $${spent.toFixed(2)} of $${settings.aiMonthlyCapUsd}` : "Mode: free (no AI, $0)"}\nBroken sources: ${broken.length ? broken.join(", ") : "none"}`,
      );
    }
    case "/saved":
      return reply(`<b>Saved & in progress</b>\n${listRows(await store.byStatus(["saved", "preparing", "waiting_on_me"]), "Nothing saved yet.")}`);
    case "/deadlines":
      return reply(`<b>Deadlines in the next 7 days</b>\n${listRows(await store.deadlinesWithin(7), "No saved deadlines this week.")}`);
    case "/web": {
      const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "opportunity-agent-mocha.vercel.app";
      return reply(`🗂 <a href="${trackerLink(`https://${host}`)}">Open your tracker</a>\nPrivate link — don't forward it. It expires in ${LINK_DAYS} days.`);
    }
    case "/tracker": {
      const rows = await store.byStatus(["saved", "preparing", "waiting_on_me", "submitted", "interview", "result"], 50);
      return reply(`<b>Tracker</b>\n${listRows(rows, "Nothing tracked yet.")}`);
    }
    default:
      return reply(`I didn't understand that.\n\n${HELP}`);
  }
}
