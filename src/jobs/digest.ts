/** 07:00 Nairobi daily digest: top items first, each with inline buttons. */
import { settings } from "../lib/config.js";
import { log } from "../lib/log.js";
import { Store } from "../db/store.js";
import { sendMessage } from "../telegram/api.js";
import { formatOpp, oppButtons } from "../telegram/format.js";

async function main() {
  const store = new Store();
  if (await store.isPaused()) return log.info("paused");
  const rows = await store.digestCandidates(settings.digestSize);
  const date = new Date().toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi", weekday: "long", day: "numeric", month: "long" });
  if (!rows.length) {
    await sendMessage(`☀️ <b>${date}</b>\nNo new eligible opportunities today. Use /saved or /deadlines to see what's in progress.`);
    return;
  }
  await sendMessage(`☀️ <b>Good morning — ${date}</b>\n${rows.length} new opportunit${rows.length === 1 ? "y" : "ies"}, best first:`);
  let i = 1;
  for (const row of rows) {
    await sendMessage(formatOpp(row, i++), oppButtons(row.key, row.official_url));
  }
  await store.markDigested(rows.map((r) => r.key));
}

main().catch(async (e) => {
  log.error("digest failed", { err: String(e) });
  try {
    await sendMessage(`🚨 Digest failed: ${String(e).slice(0, 200)}`);
  } catch {}
  process.exit(1);
});
