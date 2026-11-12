import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ai, logUsage, type Budget } from "../lib/ai.js";
import { settings } from "../lib/config.js";
import type { Evidenced, Extracted, Funding } from "../types.js";

/**
 * Extraction: the model reads the OFFICIAL page text and returns each fact together with the
 * exact sentence it came from. `verifyEvidence` then drops any fact whose quote is not literally
 * on the page, so a hallucinated deadline or eligibility rule can never reach you.
 */

const ev = <T extends z.ZodTypeAny>(t: T) => z.object({ value: t, quote: z.string().nullable() });

const ExtractSchema = z.object({
  is_opportunity: z.boolean(),
  title: z.string(),
  provider: z.string(),
  deadline: ev(z.string().nullable()),
  eligible_nationalities: ev(z.string()),
  study_levels: ev(z.array(z.string())),
  fields: ev(z.array(z.string())),
  enrollment_rule: ev(z.string().nullable()),
  age_limit: ev(z.number().nullable()),
  grade_requirement: ev(z.string().nullable()),
  gpa_mandatory: ev(z.boolean().nullable()),
  language_requirement: ev(z.string().nullable()),
  funding: ev(z.enum(["full", "partial", "none", "paid", "unknown"])),
  funding_details: ev(z.string().nullable()),
  pay: ev(z.string().nullable()),
  payment_methods: ev(z.array(z.string())),
  application_fee: ev(z.string().nullable()),
  how_to_apply: ev(z.string().nullable()),
  contact_emails: z.array(z.string()),
  remote: z.boolean().nullable(),
});
export type RawExtract = z.infer<typeof ExtractSchema>;

const SYSTEM = `You extract facts about one opportunity (scholarship, internship, job, program) from the text of its official web page.
Rules:
- Use ONLY the page text given. Never use outside knowledge, never guess, never estimate.
- For every field, "quote" must be a short span copied character-for-character from the page text that states the fact. If the page does not state it, set value to null (or "unknown", or [] for lists) and quote to null.
- deadline: ISO date YYYY-MM-DD only if an explicit date is stated for the CURRENT/next cycle; otherwise null. If only a month is given, null.
- eligible_nationalities: summarise who may apply by nationality/residence, e.g. "worldwide", "African countries", "Kenya", "developing countries", "US residents only", "unknown".
- funding: "full" only if the page states BOTH tuition (or no tuition) AND a living stipend/allowance are covered; "partial" for anything less; "paid" for jobs/paid internships; "none" if unfunded.
- funding_details: list what is covered as stated (tuition, stipend amount, travel, visa, insurance, accommodation).
- payment_methods: payout channels the payer states (e.g. PayPal, Payoneer, Wise, bank transfer, M-Pesa, Deel). Empty if not stated.
- application_fee: any fee the applicant must pay, as stated; null if none mentioned.
- enrollment_rule: any rule about current or previous university enrollment, as stated.
- is_opportunity: false if the page is not a specific opportunity (e.g. a listing index, news, 404).`;

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

export function quoteOnPage(quote: string | null, pageText: string): boolean {
  if (!quote || quote.trim().length < 3) return false;
  return normalize(pageText).includes(normalize(quote));
}

function check<T>(e: { value: T; quote: string | null }, page: string, empty: T): Evidenced<T> {
  const isEmpty = e.value === null || e.value === empty || (Array.isArray(e.value) && e.value.length === 0);
  if (isEmpty) return { value: empty, quote: null };
  return quoteOnPage(e.quote, page) ? { value: e.value, quote: e.quote } : { value: empty, quote: null };
}

/** Drop every fact whose quote is not literally on the page. Pure — unit tested. */
export function verifyEvidence(raw: RawExtract, page: string, officialUrl: string): Extracted {
  let deadline = check(raw.deadline, page, null as string | null);
  if (deadline.value && (!/^\d{4}-\d{2}-\d{2}$/.test(deadline.value) || Number.isNaN(Date.parse(deadline.value)))) {
    deadline = { value: null, quote: null };
  }
  return {
    title: raw.title,
    provider: raw.provider,
    officialUrl,
    deadline,
    eligibleNationalities: check(raw.eligible_nationalities, page, "unknown"),
    studyLevels: check(raw.study_levels, page, [] as string[]),
    fields: check(raw.fields, page, [] as string[]),
    enrollmentRule: check(raw.enrollment_rule, page, null as string | null),
    ageLimit: check(raw.age_limit, page, null as number | null),
    gradeRequirement: check(raw.grade_requirement, page, null as string | null),
    gpaMandatory: check(raw.gpa_mandatory, page, null as boolean | null),
    languageRequirement: check(raw.language_requirement, page, null as string | null),
    funding: check(raw.funding, page, "unknown" as Funding),
    fundingDetails: check(raw.funding_details, page, null as string | null),
    pay: check(raw.pay, page, null as string | null),
    paymentMethods: check(raw.payment_methods, page, [] as string[]),
    applicationFee: check(raw.application_fee, page, null as string | null),
    howToApply: check(raw.how_to_apply, page, null as string | null),
    contactEmails: raw.contact_emails.filter((e) => normalize(page).includes(e.toLowerCase())),
    remote: raw.remote,
  };
}

export async function extract(
  pageText: string,
  officialUrl: string,
  hint: { title: string; type: string },
  budget: Budget,
): Promise<Extracted | null> {
  budget.assertCanSpend(0.01);
  const model = settings.extractModel;
  const res = await ai().messages.parse({
    model,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(ExtractSchema) },
    messages: [
      {
        role: "user",
        content: `Opportunity type hint: ${hint.type}\nListing title: ${hint.title}\nOfficial URL: ${officialUrl}\nToday: ${new Date().toISOString().slice(0, 10)}\n\n<page_text>\n${pageText}\n</page_text>`,
      },
    ],
  });
  logUsage(model, res.usage, budget);
  if (res.stop_reason === "refusal" || !res.parsed_output) return null;
  if (!res.parsed_output.is_opportunity) return null;
  return verifyEvidence(res.parsed_output, pageText, officialUrl);
}
