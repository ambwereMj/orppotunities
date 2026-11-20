/**
 * Form helper (GitHub Actions, every 20 min; exits at once when nothing is queued).
 * For each queued item: open the real application form in a headless browser, read every field,
 * match your answers, fill a PREVIEW (never submitted), and send an answer sheet + screenshot.
 *   npm run forms -- --check   prints has_work=true|false (used by the workflow)
 */
import { appendFileSync } from "node:fs";
import { Store } from "../db/store.js";
import { log } from "../lib/log.js";
import { loadLatestProfile } from "../lib/profile-sync.js";
import { answerSheet, type Answer } from "../forms/answers.js";
import { fillPreview, readForm, screenshot, withBrowser } from "../forms/reader.js";
import { NO_BOTS } from "../apply/pack.js";
import { askQuestion, ownerChatId, sendMessage } from "../telegram/api.js";
import { esc } from "../telegram/format.js";
import { env } from "../lib/config.js";
import type { DocType, StoredDoc } from "../vault/docs.js";

export interface FormRequest {
  key: string;
  url?: string;
  requested: string;
}

export function sheetText(title: string, url: string, answers: Answer[], flags: { login: boolean; captcha: boolean }): string[] {
  const filled = answers.filter((a) => a.status === "filled");
  const yours = answers.filter((a) => a.status === "you");
  const stops = answers.filter((a) => a.status === "stop");
  const label = (a: Answer) => esc(a.field.label || a.field.name || a.field.kind) + (a.field.required ? " *" : "");
  const parts: string[] = [
    `🧩 <b>Form answers — ${esc(title)}</b>\n<a href="${esc(url)}">Open the form</a> · * = required. Tap a grey value to copy it.`,
  ];
  if (flags.login || flags.captcha || stops.length) {
    parts.push(
      [
        "⛔ <b>Stop points — only you:</b>",
        flags.login ? "• Login / account needed — sign in yourself, then the fields below apply." : "",
        flags.captcha ? "• CAPTCHA — solve it yourself." : "",
        ...stops.map((a) => `• ${label(a)} — ${esc(a.note)}`),
        "• <b>Final submit</b> — always yours.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (filled.length) parts.push(["✅ <b>From your profile:</b>", ...filled.map((a) => `• ${label(a)}: <code>${esc(a.value!)}</code>`)].join("\n"));
  if (yours.length) parts.push(["👤 <b>You fill / upload:</b>", ...yours.map((a) => `• ${label(a)} — ${esc(a.note)}`)].join("\n"));
  return parts;
}

/** Split long answer sheets into Telegram-sized messages (limit 4096). */
export function chunk(parts: string[], max = 3800): string[] {
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    for (const line of p.split("\n")) {
      if ((cur + "\n" + line).length > max) {
        out.push(cur);
        cur = "";
      }
      cur = cur ? `${cur}\n${line}` : line;
    }
    cur += "\n";
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function sendPhoto(chatId: string, data: Buffer, caption: string) {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption);
  form.append("photo", new Blob([new Uint8Array(data)]), "form-preview.jpg");
  const r = await fetch(`https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/sendPhoto`, { method: "POST", body: form });
  if (!r.ok) {
    // Very tall screenshots are rejected as photos: send as a document instead.
    const f2 = new FormData();
    f2.append("chat_id", chatId);
    f2.append("caption", caption);
    f2.append("document", new Blob([new Uint8Array(data)]), "form-preview.jpg");
    await fetch(`https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/sendDocument`, { method: "POST", body: f2 });
  }
}

async function main() {
  const store = new Store();
  const queue = (await store.getSetting<FormRequest[]>("form_queue")) ?? [];
  if (process.argv.includes("--check")) {
    const line = `has_work=${queue.length > 0 && !(await store.isPaused())}`;
    console.log(line);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
    return;
  }
  if (!queue.length || (await store.isPaused())) return;
  const chatId = await ownerChatId();
  if (!chatId) return;
  const prof = await loadLatestProfile(store);
  const docs = (await store.getSetting<Record<string, StoredDoc>>("documents")) ?? {};
  const stored = Object.values(docs).map((d) => d.type) as DocType[];

  await withBrowser(async (browser) => {
    for (const req of queue) {
      const row = await store.get(req.key);
      if (!row) continue;
      const url = req.url ?? row.official_url;
      try {
        if (NO_BOTS.test(new URL(url).hostname)) {
          await sendMessage(`🤚 <b>${esc(row.title)}</b>: this site doesn't allow bots, so I won't open its form. Use your Apply pack and fill it by hand.`, undefined, chatId);
          continue;
        }
        const { read, page } = await readForm(browser, url);
        const usable = read.fields.filter((f) => f.kind !== "other");
        if (!usable.length) {
          const id = await askQuestion(
            chatId,
            `🧩 <b>${esc(row.title)}</b>: I couldn't find a form at <a href="${esc(read.url)}">this page</a>${read.login ? " (it needs you to sign in first)" : ""}. If you have the direct link to the application form, reply to this message with it and I'll read that.`,
          );
          if (id) await store.setSetting(`question:${id}`, { key: row.key, item: "form_url" });
          continue;
        }
        const answers = answerSheet(usable, prof, stored);
        const filled = await fillPreview(page, answers);
        for (const msg of chunk(sheetText(row.title, read.url, answers, read))) await sendMessage(msg, undefined, chatId);
        await sendPhoto(chatId, await screenshot(page), `Preview: ${filled} field(s) filled from your profile on a test copy. Nothing was submitted.`);
        const stops = answers.filter((a) => a.status === "stop").length + (read.login ? 1 : 0) + (read.captcha ? 1 : 0);
        await store.setStatus(row.key, "waiting_on_me", { blocking: `Form ready to fill${stops ? ` — ${stops} stop point(s)` : ""}; final submit is yours` });
        await page.context().close();
      } catch (e) {
        log.error("form helper failed", { key: req.key, err: String(e) });
        await sendMessage(`⚠️ I couldn't open the form for <b>${esc(row.title)}</b> (${esc(String(e).slice(0, 120))}). Use your Apply pack and the official page.`, undefined, chatId);
      }
    }
  });
  // Remove only what was processed (new requests may have arrived meanwhile).
  const latest = (await store.getSetting<FormRequest[]>("form_queue")) ?? [];
  await store.setSetting("form_queue", latest.filter((r) => !queue.some((q) => q.key === r.key && q.requested === r.requested)));
}

if (process.argv[1]?.endsWith("forms.ts")) {
  main().catch((e) => {
    log.error("forms job crashed", { err: String(e) });
    process.exit(1);
  });
}
