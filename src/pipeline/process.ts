import type { Profile } from "../lib/config.js";
import { politeFetch, RobotsDisallowed } from "../lib/http.js";
import { BudgetExceeded, type Budget } from "../lib/ai.js";
import { log } from "../lib/log.js";
import type { Lead, Opportunity } from "../types.js";
import { checkEligibility } from "./eligibility.js";
import { extract } from "./extract.js";
import { oppKey } from "./dedupe.js";
import { payoutRoute } from "./payout.js";
import { rank, type Weights } from "./rank.js";
import { findOfficialLink, htmlToText } from "./resolve.js";
import { scamCheck } from "./scam.js";

export type Outcome =
  | { kind: "stored"; opp: Opportunity }
  | { kind: "not_opportunity" | "error"; reason: string };

/** Lead -> official page -> verified facts -> eligibility -> scam -> payout -> score. */
export async function processLead(lead: Lead, profile: Profile, budget: Budget, weights: Weights): Promise<Outcome> {
  try {
    let officialUrl = lead.url;
    let html: string;
    let resolved = !lead.aggregator;

    const first = await politeFetch(lead.url);
    if (first.status >= 400) return { kind: "error", reason: `HTTP ${first.status}` };
    html = first.text;

    if (lead.aggregator) {
      const link = findOfficialLink(first.text, first.url);
      if (link) {
        try {
          const off = await politeFetch(link);
          if (off.status < 400) {
            officialUrl = off.url;
            html = off.text;
            resolved = true;
          }
        } catch (e) {
          log.warn("official page fetch failed", { link, err: String(e) });
        }
      }
    }

    const pageText = htmlToText(html);
    if (pageText.length < 200) return { kind: "not_opportunity", reason: "page has too little text" };

    const x = await extract(pageText, officialUrl, { title: lead.title, type: lead.type }, budget);
    if (!x) return { kind: "not_opportunity", reason: "not a specific opportunity" };

    const eligibility = checkEligibility(x, lead, profile);
    if (!resolved) {
      eligibility.reasons.push("couldn't find the official page — link is the listing site");
      if (eligibility.verdict === "eligible") eligibility.verdict = "check";
    }
    const scam = scamCheck(`${pageText}\n${lead.summary ?? ""}`, x, officialUrl);
    if (scam.reject) {
      eligibility.verdict = "ineligible";
      eligibility.reasons.push(`rejected by scam filter: ${scam.reasons.join("; ")}`);
    }
    const paid = lead.type === "remote_work" || x.funding.value === "paid";
    const payout = paid ? payoutRoute(x.paymentMethods.value, `${x.pay.value ?? ""} ${pageText.slice(0, 20000)}`) : null;
    const scored = rank(lead, x, eligibility, payout, weights);

    return {
      kind: "stored",
      opp: { key: oppKey(officialUrl), type: lead.type, lead, extracted: x, eligibility, scam, payout, scored },
    };
  } catch (e) {
    if (e instanceof BudgetExceeded) throw e;
    if (e instanceof RobotsDisallowed) return { kind: "error", reason: "robots.txt disallows" };
    return { kind: "error", reason: String(e).slice(0, 300) };
  }
}

/** Run `fn` over items with at most `n` in flight. */
export async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}
