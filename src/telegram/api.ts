import { createHmac } from "node:crypto";
import { env, settings } from "../lib/config.js";
import { log } from "../lib/log.js";

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

/**
 * Webhook secret derived from the bot token, so there is no extra secret to manage.
 * Telegram echoes it in a header on every update; anything without it is rejected.
 */
export function webhookSecret(token = env("TELEGRAM_BOT_TOKEN")): string {
  return createHmac("sha256", token).update("opportunity-agent-webhook").digest("hex");
}

/** Owner chat id: TELEGRAM_CHAT_ID if set, otherwise the one the bot stored on the owner's /start. */
let cachedChatId: string | null = null;
export async function ownerChatId(): Promise<string | null> {
  if (process.env.TELEGRAM_CHAT_ID) return process.env.TELEGRAM_CHAT_ID;
  if (cachedChatId) return cachedChatId;
  const { Store } = await import("../db/store.js");
  const v = await new Store().getSetting<string>("owner_chat_id");
  cachedChatId = v ? String(v) : null;
  return cachedChatId;
}

export async function call(method: string, body: Record<string, unknown>) {
  if (settings.dryRun) {
    log.info("[dry-run] telegram", { method, text: String(body.text ?? "").slice(0, 400) });
    return { ok: true, result: {} };
  }
  const r = await fetch(`https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as { ok: boolean; description?: string; result?: unknown };
  if (!j.ok) log.error("telegram error", { method, description: j.description });
  return j;
}

export async function sendMessage(text: string, buttons?: InlineButton[][], chatId?: string) {
  const to = chatId ?? (settings.dryRun ? "dry-run" : await ownerChatId());
  if (!to) {
    log.warn("no owner chat yet — send /start to the bot", { preview: text.slice(0, 80) });
    return { ok: false };
  }
  return call("sendMessage", {
    chat_id: to,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

export function answerCallback(id: string, text: string) {
  return call("answerCallbackQuery", { callback_query_id: id, text });
}

export function editButtons(chatId: number | string, messageId: number, buttons: InlineButton[][]) {
  return call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: buttons } });
}
