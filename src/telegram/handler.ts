import { Store, type OppRow } from "../db/store.js";
import { settings } from "../lib/config.js";
import { answerCallback, editButtons, sendMessage } from "./api.js";
import { deadlineText, esc, formatEvidence } from "./format.js";

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
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } };
}

export async function handleUpdate(u: TgUpdate, store = new Store(), ownerChatId = process.env.TELEGRAM_CHAT_ID ?? "") {
  const chatId = u.message?.chat.id ?? u.callback_query?.message?.chat.id;
  if (chatId === undefined) return;

  // First-time setup: tell the owner their chat id. Everyone else is ignored.
  if (!ownerChatId) {
    if (u.message?.text?.startsWith("/start")) {
      await sendMessage(`Your chat id is <code>${chatId}</code>. Save it as TELEGRAM_CHAT_ID.`, undefined, String(chatId));
    }
    return;
  }
  if (String(chatId) !== String(ownerChatId)) return;

  if (u.callback_query) {
    const [action, key] = (u.callback_query.data ?? "").split(":");
    const row = key ? await store.get(key) : null;
    if (!row) return answerCallback(u.callback_query.id, "Item not found");
    if (action === "src") {
      await answerCallback(u.callback_query.id, "Sources");
      return sendMessage(formatEvidence(row));
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
      await sendMessage(
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
      return sendMessage(`👋 Opportunity Agent is running.\n\n${HELP}`);
    case "/pause":
      await store.setPaused(true);
      return sendMessage("⏸ Paused. No searches, digests or alerts until /resume.");
    case "/resume":
      await store.setPaused(false);
      return sendMessage("▶️ Resumed.");
    case "/status": {
      const paused = await store.isPaused();
      const spent = await store.aiSpentThisMonth();
      const broken = await store.brokenSources(3);
      return sendMessage(
        `${paused ? "⏸ Paused" : "▶️ Running"}\nAI spend this month: $${spent.toFixed(2)} of $${settings.aiMonthlyCapUsd}\nBroken sources: ${broken.length ? broken.join(", ") : "none"}`,
      );
    }
    case "/saved":
      return sendMessage(`<b>Saved & in progress</b>\n${listRows(await store.byStatus(["saved", "preparing", "waiting_on_me"]), "Nothing saved yet.")}`);
    case "/deadlines":
      return sendMessage(`<b>Deadlines in the next 7 days</b>\n${listRows(await store.deadlinesWithin(7), "No saved deadlines this week.")}`);
    case "/tracker": {
      const rows = await store.byStatus(["saved", "preparing", "waiting_on_me", "submitted", "interview", "result"], 50);
      return sendMessage(`<b>Tracker</b>\n${listRows(rows, "Nothing tracked yet.")}`);
    }
    default:
      return sendMessage(`I didn't understand that.\n\n${HELP}`);
  }
}
