import type { OppRow } from "../db/store.js";
import type { InlineButton } from "./api.js";
import { daysUntil } from "../pipeline/eligibility.js";

export const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const TYPE_LABEL: Record<string, string> = {
  scholarship: "🎓 Scholarship",
  internship: "🛠 Internship",
  remote_work: "💻 Remote work",
  program: "🏆 Program",
  skills: "📚 Skills program",
};

const FUNDING_LABEL: Record<string, string> = {
  full: "Fully funded",
  partial: "Partial funding (not full)",
  paid: "Paid",
  none: "Unfunded",
  unknown: "Funding not stated – check",
};

export function deadlineText(row: Pick<OppRow, "deadline">, now = new Date()): string {
  if (!row.deadline) return "deadline unknown – check";
  const d = daysUntil(row.deadline, now);
  return `${row.deadline} (${d === 0 ? "today" : d === 1 ? "1 day left" : `${d} days left`})`;
}

export function formatOpp(row: OppRow, index?: number): string {
  const x = row.extracted;
  const lines: string[] = [];
  lines.push(`${index !== undefined ? `<b>${index}.</b> ` : ""}<b>${esc(row.title)}</b>`);
  lines.push(`${TYPE_LABEL[row.type] ?? row.type} · ${esc(row.provider ?? "Unknown provider")}`);
  const pay = row.type === "remote_work" || row.funding === "paid" ? x.pay.value ?? FUNDING_LABEL[row.funding ?? "unknown"] : FUNDING_LABEL[row.funding ?? "unknown"];
  lines.push(`💰 ${esc(pay)}${x.fundingDetails.value ? ` — ${esc(x.fundingDetails.value.slice(0, 160))}` : ""}`);
  if (row.payout) {
    lines.push(`🏦 ${esc(row.payout.route ?? row.payout.note)}`);
  }
  lines.push(`⏰ ${esc(deadlineText(row))}`);
  lines.push(`⭐ Fit ${row.score}/100 — ${esc(row.score_reason)}`);
  if (row.verdict === "check") lines.push(`🔎 Check: ${esc(row.eligibility.reasons.join("; "))}`);
  if (row.flagged) lines.push(`⚠️ Flagged: ${esc(row.scam.reasons.join("; "))}`);
  lines.push(`🔗 <a href="${esc(row.official_url)}">Official page</a>`);
  return lines.join("\n");
}

export function oppButtons(key: string, url: string): InlineButton[][] {
  return [
    [
      { text: "✅ Apply", callback_data: `apply:${key}` },
      { text: "💾 Save", callback_data: `save:${key}` },
    ],
    [
      { text: "⏭ Skip", callback_data: `skip:${key}` },
      { text: "🚫 Not interested", callback_data: `ni:${key}` },
    ],
    [{ text: "🔗 Open official page", url }],
  ];
}

/** Explain where each fact came from (shown on request). */
export function formatEvidence(row: OppRow): string {
  const x = row.extracted;
  const facts: [string, { value: unknown; quote: string | null }][] = [
    ["Deadline", x.deadline],
    ["Who can apply", x.eligibleNationalities],
    ["Levels", x.studyLevels],
    ["Funding", x.funding],
    ["Funding details", x.fundingDetails],
    ["Enrollment rule", x.enrollmentRule],
    ["Age limit", x.ageLimit],
    ["How to apply", x.howToApply],
  ];
  return [
    `<b>Sources for: ${esc(row.title)}</b>`,
    ...facts
      .filter(([, f]) => f.quote)
      .map(([k, f]) => `• <b>${k}:</b> ${esc(String(Array.isArray(f.value) ? f.value.join(", ") : f.value))}\n  <i>“${esc(f.quote!.slice(0, 300))}”</i>`),
  ].join("\n");
}
