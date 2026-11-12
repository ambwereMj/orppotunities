import type { VercelRequest, VercelResponse } from "@vercel/node";
import { timingSafeEqual } from "node:crypto";
import { handleUpdate } from "../src/telegram/handler.js";
import { webhookSecret } from "../src/telegram/api.js";

function sameSecret(a: unknown, b: string): boolean {
  if (typeof a !== "string" || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Telegram webhook. Telegram sends the secret we registered in a header; anything else is rejected. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  if (!process.env.TELEGRAM_BOT_TOKEN || !sameSecret(req.headers["x-telegram-bot-api-secret-token"], webhookSecret())) {
    return res.status(401).end();
  }
  try {
    await handleUpdate(req.body);
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "telegram handler failed", err: String(e) }));
  }
  // Always 200 so Telegram doesn't retry the same update forever.
  return res.status(200).json({ ok: true });
}
