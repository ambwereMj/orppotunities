import { aiEnabled, type Profile } from "../lib/config.js";
import { politeFetch, RobotsDisallowed } from "../lib/http.js";
import { BudgetExceeded, type Budget } from "../lib/ai.js";
import { log } from "../lib/log.js";
import type { Lead, Opportunity } from "../types.js";
import { checkEligibility } from "./eligibility.js";
import { extract } from "./extract.js";
import { extractWithRules, isClosed } from "./extract-rules.js";
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
    if ((first.status === 401 || first.status === 403) && lead.summary) {
      // The site blocks bots from its pages (but publishes this item in its feed). Respect the block:
      // build the item from the feed's own text, clearly labelled, and let the owner open the link.
      return fromFeed(lead, profile, weights);
    }
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

    const x = aiEnabled()
      ? await extract(pageText, officialUrl, { title: lead.title, type: lead.type }, budget)
      : extractWithRules(pageText, officialUrl, lead);
    if (!x) return { kind: "not_opportunity", reason: "not a specific opportunity" };

    const eligibility = checkEligibility(x, lead, profile);
    const closed = isClosed(pageText.slice(0, 3000));
    if (closed) {
      eligibility.verdict = "ineligible";
      eligibility.reasons.push(`page says "${closed}"`);
    }
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

/** Item built from the source's feed text when its page blocks bots. Always "check", never "eligible". */
export function fromFeed(lead: Lead, profile: Profile, weights: Weights): Outcome {
  const text = [`${lead.title}.`, lead.summary, lead.location ? `Location: ${lead.location}.` : "", lead.salary ? `Pay: ${lead.salary}.` : ""]
    .filter(Boolean)
    .join(" ");
  const x = extractWithRules(text, lead.url, lead, new Date(), { fromFeed: true });
  if (!x) return { kind: "not_opportunity", reason: "nothing usable in the feed text" };
  const eligibility = checkEligibility(x, lead, profile);
  if (eligibility.verdict === "eligible") eligibility.verdict = "check";
  eligibility.reasons.push("site blocks automated reading — details are from its feed; open the link to confirm");
  const scam = scamCheck(text, x, lead.url);
  if (scam.reject) {
    eligibility.verdict = "ineligible";
    eligibility.reasons.push(`rejected by scam filter: ${scam.reasons.join("; ")}`);
  }
  const payout = lead.type === "remote_work" ? payoutRoute(x.paymentMethods.value, text) : null;
  const scored = rank(lead, x, eligibility, payout, weights);
  return { kind: "stored", opp: { key: oppKey(lead.url), type: lead.type, lead, extracted: x, eligibility, scam, payout, scored } };
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
