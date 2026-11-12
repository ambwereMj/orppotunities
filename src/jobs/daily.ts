/**
 * Daily finder (06:00 Nairobi): sources -> dedupe -> pre-filter -> verify on official page ->
 * eligibility/scam/payout -> rank -> store -> instant alerts. The 07:00 digest job sends the rest.
 */
import { loadProfile, loadSources, settings } from "../lib/config.js";
import { Budget, BudgetExceeded } from "../lib/ai.js";
import { log } from "../lib/log.js";
import { Store } from "../db/store.js";
import { fetchAll } from "../sources/index.js";
import { dedupeLeads, hash, normalizeUrl } from "../pipeline/dedupe.js";
import { prefilter, roundRobin } from "../pipeline/prefilter.js";
import { pool, processLead } from "../pipeline/process.js";
import { sendMessage } from "../telegram/api.js";
import { sendInstantAlerts } from "./alerts.js";
import type { Opportunity } from "../types.js";

async function main() {
  const profile = loadProfile();
  const sources = loadSources();
  const store = settings.dryRun ? null : new Store();

  if (store && (await store.isPaused())) {
    log.info("agent paused — exiting");
    return;
  }

  const budget = new Budget(store ? await store.aiSpentThisMonth() : 0);
  const weights = store ? await store.weights() : {};

  const { leads, runs } = await fetchAll(sources);
  await store?.recordSourceHealth(runs);
  log.info("fetched", { leads: leads.length, sources: runs.length, failed: runs.filter((r) => !r.ok).length });

  const unique = dedupeLeads(leads);
  const hashOf = (l: { url: string }) => hash(normalizeUrl(l.url));
  const seen = store ? await store.seenHashes(unique.map(hashOf)) : new Set<string>();
  const fresh = unique.filter((l) => !seen.has(hashOf(l)));

  const pre = fresh.map((l) => ({ l, r: prefilter(l) }));
  await store?.markSeen(pre.filter((p) => !p.r.keep).map((p) => ({ url_hash: hashOf(p.l), url: p.l.url, outcome: "prefiltered" })));
  // Round-robin across sources (max 12 each) so one big source cannot use up the whole run.
  const candidates = roundRobin(pre.filter((p) => p.r.keep).map((p) => p.l), 12, settings.maxExtractionsPerRun);
  log.info("candidates", { unique: unique.length, fresh: fresh.length, toVerify: candidates.length });

  const stored: Opportunity[] = [];
  let budgetHit = false;
  await pool(candidates, 4, async (lead) => {
    if (budgetHit) return;
    try {
      const out = await processLead(lead, profile, budget, weights);
      if (out.kind === "stored") {
        stored.push(out.opp);
        if (store) await store.upsertOpportunity(out.opp);
        await store?.markSeen([{ url_hash: hashOf(lead), url: lead.url, outcome: out.opp.eligibility.verdict === "ineligible" ? "ineligible" : "stored", opp_key: out.opp.key }]);
      } else {
        // Errors are not marked seen so they are retried tomorrow.
        if (out.kind !== "error") await store?.markSeen([{ url_hash: hashOf(lead), url: lead.url, outcome: out.kind }]);
        log.debug("lead skipped", { url: lead.url, ...out });
      }
    } catch (e) {
      if (e instanceof BudgetExceeded) budgetHit = true;
      else log.error("lead failed", { url: lead.url, err: String(e) });
    }
  });

  await store?.recordAiCost("daily", budget.spentRun);
  if (budgetHit) {
    await sendMessage(
      `💸 AI budget reached ($${budget.spentThisMonth.toFixed(2)} of $${budget.cap}). Verification stopped for this month; already-found items still get reminders. Raise AI_MONTHLY_CAP_USD to continue.`,
    );
  }

  const shown = stored.filter((o) => o.eligibility.verdict !== "ineligible");
  log.info("done", { stored: stored.length, shown: shown.length, aiUsd: budget.spentRun.toFixed(4), monthUsd: budget.spentThisMonth.toFixed(2) });

  if (settings.dryRun) {
    for (const o of shown.sort((a, b) => b.scored.score - a.scored.score).slice(0, 15)) {
      console.log(`${o.scored.score}\t${o.eligibility.verdict}\t${o.extracted.title}\t${o.extracted.officialUrl}`);
    }
    return;
  }
  await sendInstantAlerts(store!);
}

main().catch(async (e) => {
  log.error("daily job crashed", { err: String(e), stack: (e as Error).stack });
  try {
    await sendMessage(`🚨 Daily finder crashed: <code>${String(e).slice(0, 300).replace(/</g, "&lt;")}</code>`);
  } catch {}
  process.exit(1);
});
