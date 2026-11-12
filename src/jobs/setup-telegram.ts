/**
 * One-time setup (GitHub Actions → "Opportunity Agent" → Run workflow → setup):
 * points the Telegram bot at the Vercel webhook. Any /start already sent to the bot is delivered
 * to the webhook, which registers the sender as the owner. Never prints the token or chat id.
 */
import { call, webhookSecret } from "../telegram/api.js";
import { log } from "../lib/log.js";

async function main() {
  const base = (process.env.WEBHOOK_BASE_URL ?? "").replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(base)) throw new Error("WEBHOOK_BASE_URL must be https://<host>");
  const r = await call("setWebhook", {
    url: `${base}/api/telegram`,
    secret_token: webhookSecret(),
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  if (!r.ok) throw new Error("setWebhook failed — check TELEGRAM_BOT_TOKEN");
  const info = (await call("getWebhookInfo", {})) as { result?: { url?: string; pending_update_count?: number; last_error_message?: string } };
  log.info("webhook set", {
    url: info.result?.url,
    pending: info.result?.pending_update_count,
    lastError: info.result?.last_error_message ?? null,
  });
}

main().catch((e) => {
  log.error("setup failed", { err: String(e) });
  process.exit(1);
});
