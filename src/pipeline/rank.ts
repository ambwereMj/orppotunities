import type { EligibilityResult, Extracted, Lead, OppType, PayoutResult, Scored } from "../types.js";
import { daysUntil } from "./eligibility.js";

/** Your confirmed priority order (1 = highest). */
const TYPE_PRIORITY: Record<OppType, number> = {
  scholarship: 1,
  internship: 2,
  remote_work: 3,
  program: 4,
  skills: 5,
};

/** Learned from feedback (Phase 2). Keys like "type:scholarship", "provider:daad", "kw:hackathon". */
export type Weights = Record<string, number>;

export function rank(
  lead: Lead,
  x: Extracted,
  el: EligibilityResult,
  payout: PayoutResult | null,
  weights: Weights = {},
  now = new Date(),
): Scored {
  const parts: Record<string, number> = {};
  const why: string[] = [];

  // Fit (0–30)
  let fit = 30 - (TYPE_PRIORITY[lead.type] - 1) * 4;
  if (el.verdict === "check") fit -= 8;
  const fieldText = x.fields.value.join(" ").toLowerCase();
  if (/electr|computer|software|embedded|ict/.test(fieldText + " " + x.title.toLowerCase())) {
    fit += 4;
    why.push("matches your field");
  }
  parts.fit = Math.max(0, Math.min(30, fit));

  // Value (0–25)
  const f = x.funding.value;
  let value = f === "full" ? 25 : f === "paid" ? 18 : f === "partial" ? 12 : f === "none" ? 3 : 8;
  if (f === "full") why.push("fully funded");
  if (f === "partial") why.push("partial funding");
  if (f === "paid" && payout && !payout.route) value -= 6;
  if (/travel|flight|airfare/i.test(x.fundingDetails.value ?? "")) value = Math.min(25, value + 2);
  parts.value = value;

  // Urgency (0–15)
  let urgency = 5;
  if (x.deadline.value) {
    const d = daysUntil(x.deadline.value, now);
    urgency = d <= 3 ? 15 : d <= 7 ? 13 : d <= 14 ? 11 : d <= 30 ? 9 : d <= 90 ? 6 : 3;
    if (d <= 14) why.push(`deadline in ${d}d`);
  } else if (lead.type === "remote_work") {
    urgency = 10; // job posts close fast without stated deadlines
  }
  parts.urgency = urgency;

  // Effort (0–15, higher = easier)
  const effortBase: Record<OppType, number> = { remote_work: 12, internship: 10, program: 8, skills: 11, scholarship: 6 };
  let effort = effortBase[lead.type];
  const how = (x.howToApply.value ?? "").toLowerCase();
  if (/essay|statement|motivation letter/.test(how)) effort -= 2;
  if (/recommendation|reference letter/.test(how)) effort -= 2;
  if (/interview/.test(how)) effort -= 1;
  parts.effort = Math.max(0, effort);

  // Likelihood (0–15)
  let like = 8;
  const nat = x.eligibleNationalities.value.toLowerCase();
  if (/kenya|east africa/.test(nat)) like += 5;
  else if (/africa|developing|commonwealth/.test(nat)) like += 3;
  else if (/worldwide|international|global/.test(nat)) like -= 1;
  if (el.verdict === "check") like -= 3;
  parts.likelihood = Math.max(0, Math.min(15, like));

  // Feedback adjustment (±15 total)
  let adj = (weights[`type:${lead.type}`] ?? 0) + (weights[`provider:${x.provider.toLowerCase()}`] ?? 0);
  for (const [k, w] of Object.entries(weights)) {
    if (k.startsWith("kw:") && x.title.toLowerCase().includes(k.slice(3))) adj += w;
  }
  adj = Math.max(-15, Math.min(15, adj));
  parts.feedback = adj;
  if (adj >= 5) why.push("similar to things you liked");

  const score = Math.max(0, Math.min(100, Math.round(parts.fit + parts.value + parts.urgency + parts.effort + parts.likelihood + adj)));
  if (el.verdict === "check") why.push("needs a manual check");
  return { score, parts, reason: why.slice(0, 3).join(" · ") || "general match" };
}
