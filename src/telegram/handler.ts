import { Store, type OppRow } from "../db/store.js";
import { aiEnabled, settings } from "../lib/config.js";
import { answerCallback, askQuestion, editButtons, sendDocument, sendMessage } from "./api.js";
import { loadProfile } from "../lib/config.js";
import { preparePack } from "../apply/pack.js";
import { checklistText } from "../apply/requirements.js";
import { DOC_TYPES, checklistDocs, deleteDocument, guessType, readDocument, storeDocument, type DocType, type StoredDoc } from "../vault/docs.js";
import { downloadFile } from "./api.js";
import { extractPage, pageCount } from "../vault/pages.js";
import { publishProfile } from "../lib/profile-sync.js";
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
/docs – your stored documents (send me a scan or PDF to add one)
/page kcse 2 – keep only page 2 of a stored PDF (the full scan is kept too)
/label transcript kcse – change what a stored document is
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
  message?: {
    chat: { id: number; type?: string };
    text?: string;
    caption?: string;
    message_id?: number;
    reply_to_message?: { message_id: number };
    document?: { file_id: string; file_name?: string; file_size?: number; mime_type?: string };
    photo?: { file_id: string; file_size?: number; width: number }[];
  };
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
  await publishProfile(store).catch(() => {});

  if (u.callback_query) {
    const data = u.callback_query.data ?? "";
    if (data.startsWith("dt:") || data.startsWith("dg:")) return handleDocCallback(data, u.callback_query.id, String(chatId), store);
    if (data.startsWith("fa:")) {
      await queueForm(store, data.slice(3));
      await answerCallback(u.callback_query.id, "Queued");
      return reply("🧩 Queued. A cloud browser will read the form and send you an answer sheet within about 20 minutes. Nothing will be submitted.");
    }
    const [action, key] = data.split(":");
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

  // Documents (scans, PDFs, photos) go to the encrypted vault.
  if (u.message?.document || u.message?.photo?.length) return receiveDocument(u.message, String(chatId), store);

  // Answers to questions the agent asked ("Reply to this message with…").
  const replyTo = u.message?.reply_to_message?.message_id;
  if (replyTo) {
    const q = await store.getSetting<{ key: string; item: string }>(`question:${replyTo}`);
    if (q?.item === "form_url") {
      const m = (u.message?.text ?? "").match(/https?:\/\/\S+/);
      if (!m) return reply("Please reply with the full link (starting with https://).");
      await queueForm(store, q.key, m[0]);
      return reply("🧩 Got it — I'll read that form within about 20 minutes.");
    }
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
    case "/docs":
      return listDocuments(String(chatId), store);
    case "/page":
      return keepOnePage(text, String(chatId), store);
    case "/label":
      return relabelDocument(text, String(chatId), store);
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
  const docs = (await store.getSetting<Record<string, StoredDoc>>("documents")) ?? {};
  prof = { ...prof, documents: checklistDocs(Object.values(docs).map((d) => d.type)) } as typeof prof;

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
  if (!pack.noBots) {
    await sendMessage("Want help with the form itself? I'll read the real application form and send you each field with your answer ready to copy.", [[{ text: "🧩 Prepare form answers", callback_data: `fa:${row.key}` }]], chatId);
  }
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

// ── Document vault ─────────────────────────────────────────────────────────────

type Msg = NonNullable<TgUpdate["message"]>;

async function receiveDocument(m: Msg, chatId: string, store: Store) {
  const send = (t: string, b?: Parameters<typeof sendMessage>[1]) => sendMessage(t, b, chatId);
  if (!process.env.VAULT_PASSPHRASE) return send("⚠️ The document vault isn't switched on yet.");
  const file = m.document ?? [...(m.photo ?? [])].sort((a, b) => b.width - a.width)[0];
  const name = m.document?.file_name ?? `photo-${new Date().toISOString().slice(0, 10)}.jpg`;
  if (!file) return;
  if ((file.file_size ?? 0) > 20 * 1024 * 1024) return send("That file is over 20 MB, which is Telegram's limit for bots. Please send a smaller scan or PDF.");
  const data = await downloadFile(file.file_id);
  const path = await storeDocument(store.db, data, name);
  const pending = { path, name, bytes: data.length, pages: (await pageCount(data)) ?? undefined };
  const guessed = guessType(`${m.caption ?? ""} ${name}`);
  if (guessed) return labelDocument(guessed, pending, chatId, store);
  const id = String(Date.now() % 1e9);
  await store.setSetting(`upload:${id}`, pending);
  const types = Object.entries(DOC_TYPES) as [DocType, string][];
  const rows = [];
  for (let i = 0; i < types.length; i += 2) rows.push(types.slice(i, i + 2).map(([t, label]) => ({ text: label, callback_data: `dt:${id}:${t}` })));
  return send(`🔒 Stored <b>${esc(name)}</b> encrypted. What is it?`, rows);
}

async function labelDocument(type: DocType, pending: { path: string; name: string; bytes: number; pages?: number }, chatId: string, store: Store) {
  const docs = (await store.getSetting<Record<string, StoredDoc>>("documents")) ?? {};
  const key = type === "other" ? `other-${Date.now() % 1e9}` : type;
  const old = docs[key];
  if (old && old.path !== pending.path) await deleteDocument(store.db, old.path);
  docs[key] = { type, ...pending, uploaded: new Date().toISOString() };
  await store.setSetting("documents", docs);
  let note = type === "passport" || type === "national_id" ? " It is never sent to any AI and only comes back to you via /docs." : "";
  if (pending.pages && pending.pages > 1 && type !== "cv" && type !== "transcript" && type !== "other") {
    note += `\n📄 This PDF has ${pending.pages} pages. If only one of them is the ${esc(DOC_TYPES[type])}, send <code>/page ${key} 2</code> (with the right page number) and I'll keep just that page.`;
  }
  return sendMessage(`✅ Saved as <b>${esc(DOC_TYPES[type])}</b>${old ? " (replaced the old one)" : ""}.${note}\nSee all with /docs.`, undefined, chatId);
}

async function listDocuments(chatId: string, store: Store) {
  const docs = (await store.getSetting<Record<string, StoredDoc>>("documents")) ?? {};
  const have = Object.entries(docs);
  const missing = (["kcse", "kcse_results", "transcript", "enrolment", "moringa", "icdl", "passport"] as DocType[]).filter((t) => !docs[t]);
  const lines = [
    "🗂 <b>Your documents</b> (encrypted)",
    ...(have.length ? have.map(([, d]) => `• ${esc(DOC_TYPES[d.type])} — ${esc(d.name)}`) : ["Nothing stored yet."]),
    missing.length ? `\nStill useful to add: ${missing.map((t) => DOC_TYPES[t]).join(", ")}. Just send me a scan or PDF.` : "",
  ];
  const buttons = have.map(([key, d]) => [{ text: `📥 ${DOC_TYPES[d.type]}`, callback_data: `dg:${key}` }]);
  return sendMessage(lines.filter(Boolean).join("\n"), buttons.length ? buttons : undefined, chatId);
}

async function handleDocCallback(data: string, callbackId: string, chatId: string, store: Store) {
  if (data.startsWith("dt:")) {
    const [, id, type] = data.split(":");
    const pending = await store.getSetting<{ path: string; name: string; bytes: number }>(`upload:${id}`);
    if (!pending || "used" in pending || !(type in DOC_TYPES)) return answerCallback(callbackId, "That upload has expired — send it again.");
    await answerCallback(callbackId, "Saved");
    await store.setSetting(`upload:${id}`, { used: true });
    return labelDocument(type as DocType, pending, chatId, store);
  }
  const key = data.slice(3);
  const docs = (await store.getSetting<Record<string, StoredDoc>>("documents")) ?? {};
  const d = docs[key];
  if (!d) return answerCallback(callbackId, "Not found");
  await answerCallback(callbackId, "Sending…");
  return sendDocument(chatId, d.name, await readDocument(store.db, d.path));
}

/** Queue a form for the cloud browser (GitHub Actions picks it up within ~20 minutes). */
async function queueForm(store: Store, key: string, url?: string) {
  const queue = (await store.getSetting<{ key: string; url?: string; requested: string }[]>("form_queue")) ?? [];
  const rest = queue.filter((r) => r.key !== key);
  rest.push({ key, ...(url ? { url } : {}), requested: new Date().toISOString() });
  await store.setSetting("form_queue", rest.slice(-10));
}

/** "/page kcse 2": keep only one page of a stored PDF; the full scan is kept as "<slot>_full". */
async function keepOnePage(text: string, chatId: string, store: Store) {
  const send = (t: string) => sendMessage(t, undefined, chatId);
  const [, slotRaw, nRaw] = text.trim().split(/\s+/);
  const docs = (await store.getSetting<Record<string, StoredDoc>>("documents")) ?? {};
  const slot = (slotRaw ?? "").toLowerCase();
  const n = Number(nRaw);
  if (!slot || !docs[slot] || !Number.isInteger(n)) {
    return send(`Usage: <code>/page kcse 2</code>. Stored: ${Object.keys(docs).map((k) => `<code>${esc(k)}</code>`).join(", ") || "nothing yet"}.`);
  }
  const d = docs[slot];
  const data = await readDocument(store.db, d.path);
  const count = await pageCount(data);
  if (!count) return send(`<b>${esc(d.name)}</b> isn't a PDF, so it has no pages to pick from.`);
  if (n < 1 || n > count) return send(`<b>${esc(d.name)}</b> has ${count} page(s). Send <code>/page ${esc(slot)} N</code> with N from 1 to ${count}.`);
  const { page } = await extractPage(data, n);
  const name = d.name.replace(/\.pdf$/i, "") + ` (page ${n}).pdf`;
  const path = await storeDocument(store.db, page, name);
  const fullKey = `${slot}_full`;
  if (docs[fullKey] && docs[fullKey].path !== d.path) await deleteDocument(store.db, docs[fullKey].path);
  docs[fullKey] = { ...d, type: "other", name: `${d.name} (full scan)` };
  docs[slot] = { ...d, path, name, bytes: page.length, uploaded: new Date().toISOString() };
  await store.setSetting("documents", docs);
  await sendDocument(chatId, name, page, `✅ Your ${esc(DOC_TYPES[d.type])} is now just page ${n} of ${count}. Check it's the right page. The full scan is kept under /docs.`);
}

/** "/label transcript kcse": change what a stored document is. */
async function relabelDocument(text: string, chatId: string, store: Store) {
  const send = (t: string) => sendMessage(t, undefined, chatId);
  const [, fromRaw, toRaw] = text.trim().split(/\s+/);
  const from = (fromRaw ?? "").toLowerCase();
  const to = (toRaw ?? "").toLowerCase() as DocType;
  const docs = (await store.getSetting<Record<string, StoredDoc>>("documents")) ?? {};
  if (!docs[from] || !(to in DOC_TYPES)) {
    return send(`Usage: <code>/label transcript kcse</code>. Stored: ${Object.keys(docs).map((k) => `<code>${esc(k)}</code>`).join(", ") || "nothing yet"}. Types: ${Object.keys(DOC_TYPES).map((t) => `<code>${t}</code>`).join(", ")}.`);
  }
  const d = docs[from];
  delete docs[from];
  const key = to === "other" ? `other-${Date.now() % 1e9}` : to;
  if (docs[key]) docs[`${key}_previous`] = { ...docs[key], type: "other", name: `${docs[key].name} (previous ${DOC_TYPES[to]})` };
  docs[key] = { ...d, type: to };
  await store.setSetting("documents", docs);
  return send(`✅ <b>${esc(d.name)}</b> is now your ${esc(DOC_TYPES[to])}.${docs[`${key}_previous`] ? " The one stored there before is kept as 'previous' in /docs." : ""}`);
}
