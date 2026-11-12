import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleUpdate } from "../src/telegram/handler.js";

/** Telegram webhook. Telegram sends the secret we registered in a header; anything else is rejected. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers["x-telegram-bot-api-secret-token"] !== secret) return res.status(401).end();
  try {
    await handleUpdate(req.body);
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "telegram handler failed", err: String(e) }));
  }
  // Always 200 so Telegram doesn't retry the same update forever.
  return res.status(200).json({ ok: true });
}
