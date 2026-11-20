import { Store, type OppRow } from "../db/store.js";
import { aiEnabled, settings } from "../lib/config.js";
import { answerCallback, askQuestion, editButtons, sendDocument, sendMessage } from "./api.js";
import { loadProfile } from "../lib/config.js";
import { preparePack } from "../apply/pack.js";
import { checklistText } from "../apply/requirements.js";
import { deadlineText, esc, formatEvidence } from "./format.js";
import { LINK_DAYS, trackerLink } from "../web/tracker.js";

/** Feedback -> ranking weights (bounded ±10 per key in the store). */
const FEEDBACK_DELTA: Record<string, number> = { apply: 2, save: 1, skip: -0.5, ni: -2 };
const STATUS: Record<string, string> = { apply: "preparing", save: "saved", skip: "skipped", ni: "not_interested" };
const ACK: Record<string, string> = {
  apply: "Preparing your application pack…",
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
  message?: { chat: { id: number; type?: string }; text?: string; message_id?: number; reply_to_message?: { message_id: number } };
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
    await store.setStatus(key, STATUS[action]);
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
    if (action === "apply") await sendApplicationPack(row, String(chatId), store);
    return;
  }

  // Answers to questions the agent asked ("Reply to this message with…").
  const replyTo = u.message?.reply_to_message?.message_id;
  if (replyTo) {
    const q = await store.getSetting<{ key: string; item: string }>(`question:${replyTo}`);
    if (q) {
      const answer = (u.message?.text ?? "").trim().slice(0, 500);
      if (!answer) return reply("I couldn't read that answer — please reply with text.");
      const answers = (await store.getSetting<Record<string, string>>("answers")) ?? {};
      answers[q.item] = answer;
      await store.setSetting("answers", answers);
      await store.setSetting(`question:${replyTo}`, { ...q, answered: true });
      const row = await store.get(q.key);
      if (row) {
        await store.setStatus(q.key, "preparing", { blocking: null, notes: [row.notes, `${q.item}: ${answer}`].filter(Boolean).join("\n") });
        await reply(`✅ Saved your ${esc(q.item)}. I'll use it for this and future applications.`);
        return sendApplicationPack(row, String(chatId), store);
      }
      return reply(`✅ Saved your ${esc(q.item)}.`);
    }
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

/** Build and send the application pack: checklist, tailored CV, letter outline, referee drafts. */
export async function sendApplicationPack(row: OppRow, chatId: string, store: Store) {
  const send = (t: string) => sendMessage(t, undefined, chatId);
  let prof;
  try {
    prof = loadProfile();
  } catch {
    return send("⚠️ Your profile isn't available to the bot yet, so I can't build the pack. I've marked it as preparing.");
  }
  const answers = (await store.getSetting<Record<string, string>>("answers")) ?? {};
  if (answers.GPA && !prof.gpa) prof = { ...prof, gpa: answers.GPA };

  await send(`⏳ Preparing your application pack for <b>${esc(row.title)}</b>…`);
  const pack = await preparePack(row, prof);

  if (pack.closed) {
    await store.setStatus(row.key, "skipped", { blocking: `Official page says "${pack.closed}"` });
    return send(`🚫 The official page now says "<i>${esc(pack.closed)}</i>". I've moved it to Skipped. <a href="${esc(row.official_url)}">Check the page</a>.`);
  }

  const missing = pack.checklist.filter((i) => i.status === "missing");
  const head = [
    `📋 <b>Checklist — ${esc(row.title)}</b>`,
    `Deadline: ${esc(deadlineText(row))}`,
    row.verdict === "check" ? `🔎 Check eligibility first: ${esc(row.eligibility.reasons.join("; "))}` : "",
    pack.pageFetched ? "" : "⚠️ I couldn't open the official page just now, so this checklist is based on what I saved earlier.",
    "",
    checklistText(pack.checklist, esc),
    "",
    pack.noBots
      ? "🤚 This site doesn't allow bots, so I won't fill anything in there. Use the files below and apply by hand."
      : "When you're ready, apply on the official page. You always do the final submit yourself.",
  ].filter((l) => l !== "");
  await sendMessage(head.join("\n"), [[{ text: "🔗 Open official page", url: row.official_url }]], chatId);

  for (const f of pack.files) await sendDocument(chatId, f.name, f.data);
  await send("📎 Above: your CV tailored to this page (re-ordered, nothing added) and a letter <b>outline</b>. Write the red parts in your own words.");

  if (pack.referees.length && pack.checklist.some((i) => i.id === "recommendation")) {
    await sendMessage(
      "✉️ Referee requests (drafts). Tap one to open it in your email app, then read it and send it yourself:",
      pack.referees.map((r) => [{ text: `Email ${r.name}`, url: r.href }]),
      chatId,
    );
  }

  if (missing.length) {
    await store.setStatus(row.key, "waiting_on_me", { blocking: missing.map((m) => m.label).join(", ") });
    for (const m of missing) {
      if (m.id === "gpa") {
        const id = await askQuestion(chatId, `⛔ <b>${esc(row.title)}</b> asks for your GPA. Reply to this message with it (e.g. "3.4/4.0"), or ignore this to stop here.`);
        if (id) await store.setSetting(`question:${id}`, { key: row.key, item: "GPA" });
      }
    }
    return send(`⏸ Paused on: ${esc(missing.map((m) => m.label).join(", "))}. It's in your tracker as "Waiting on me".`);
  }
  await store.setStatus(row.key, "preparing", { blocking: null });
}
