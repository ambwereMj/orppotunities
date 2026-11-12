import { env, settings } from "../lib/config.js";
import { log } from "../lib/log.js";

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

async function call(method: string, body: Record<string, unknown>) {
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

export function sendMessage(text: string, buttons?: InlineButton[][], chatId = env("TELEGRAM_CHAT_ID", !settings.dryRun)) {
  return call("sendMessage", {
    chat_id: chatId,
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
