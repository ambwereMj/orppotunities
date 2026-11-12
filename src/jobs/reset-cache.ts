/**
 * Clears the finder's cache so improved rules can re-check everything:
 *  - seen_urls (the "already checked" list)
 *  - opportunities you never touched (status "found", never sent to you, no feedback)
 * Your saved/applied items, feedback, settings and owner registration are never touched.
 * Run from GitHub Actions → Opportunity Agent → Run workflow → reset-cache.
 */
import { Store } from "../db/store.js";
import { log } from "../lib/log.js";

async function main() {
  const { db } = new Store();
  const fb = await db.from("feedback").select("opp_key");
  if (fb.error) throw new Error(JSON.stringify(fb.error));
  const keep = new Set((fb.data ?? []).map((r: { opp_key: string }) => r.opp_key));

  const seen = await db.from("seen_urls").delete().neq("url_hash", "");
  if (seen.error) throw new Error(JSON.stringify(seen.error));

  const cand = await db.from("opportunities").select("key").eq("status", "found").is("digested_at", null).is("alerted_at", null);
  if (cand.error) throw new Error(JSON.stringify(cand.error));
  const keys = (cand.data ?? []).map((r: { key: string }) => r.key).filter((k) => !keep.has(k));
  for (let i = 0; i < keys.length; i += 100) {
    const del = await db.from("opportunities").delete().in("key", keys.slice(i, i + 100));
    if (del.error) throw new Error(JSON.stringify(del.error));
  }
  log.info("cache cleared", { opportunitiesRemoved: keys.length });
}

main().catch((e) => {
  log.error("reset failed", { err: String(e) });
  process.exit(1);
});
