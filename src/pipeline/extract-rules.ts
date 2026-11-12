import type { Evidenced, Extracted, Funding, Lead } from "../types.js";

/**
 * Free, rule-based extraction (no AI, $0). Every fact is taken from a sentence of the official
 * page and that sentence is stored as its quote. When a rule finds nothing, the fact stays
 * unknown — it is never guessed.
 */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?;])\s+(?=[A-Z0-9"“(])|\s+•\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 600);
}

const monthIndex = (m: string) => MONTHS.findIndex((x) => x.startsWith(m.toLowerCase().slice(0, 3)));
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m, d));
  if (dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
};

/** All full dates (day, month, year) found in a string, as ISO strings. Month-only dates are ignored. */
export function findDates(s: string): string[] {
  const out: string[] = [];
  const push = (v: string | null) => v && out.push(v);
  for (const m of s.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON}\\.?,?\\s+(20\\d\\d)\\b`, "gi")))
    push(iso(+m[3], monthIndex(m[2]), +m[1]));
  for (const m of s.matchAll(new RegExp(`\\b${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d\\d)\\b`, "gi")))
    push(iso(+m[3], monthIndex(m[1]), +m[2]));
  for (const m of s.matchAll(/\b(20\d\d)-(\d{2})-(\d{2})\b/g)) push(iso(+m[1], +m[2] - 1, +m[3]));
  // dd/mm/yyyy (day-first, as used in Kenya/UK/EU)
  for (const m of s.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d\d)\b/g)) push(iso(+m[3], +m[2] - 1, +m[1]));
  return out;
}

const first = (ss: string[], re: RegExp) => ss.find((s) => re.test(s)) ?? null;
const none = <T>(value: T): Evidenced<T> => ({ value, quote: null });

const DEADLINE_CUE = /deadline|closing date|closes? on|close on|apply by|applications? (are )?(due|close)|last (date|day)|submit[^.]{0,40}\bby\b|no later than|until\b/i;

export function extractDeadline(ss: string[], now = new Date()): Evidenced<string | null> {
  const today = now.toISOString().slice(0, 10);
  for (const s of ss.filter((x) => DEADLINE_CUE.test(x))) {
    const dates = findDates(s).filter((d) => d >= today).sort();
    if (dates.length) return { value: dates[0], quote: s };
  }
  // A past deadline is still useful: it marks the item expired.
  for (const s of ss.filter((x) => DEADLINE_CUE.test(x))) {
    const dates = findDates(s).sort();
    if (dates.length) return { value: dates[dates.length - 1], quote: s };
  }
  return none(null);
}

const NAT_CUE = /(open to|eligible|eligibility|applicants? (from|must be)|citizens? of|nationals? of|residents? of|candidates from|who can apply|nationalit)/i;

export function extractNationality(ss: string[], lead: Lead): Evidenced<string> {
  const s = first(ss, NAT_CUE);
  if (s) {
    const l = s.toLowerCase();
    if (/all (countries|nationalities)|worldwide|any (country|nationality)|anywhere|international (students|applicants)|regardless of nationality/.test(l))
      return { value: "worldwide", quote: s };
    if (/kenya/.test(l)) return { value: "Kenya", quote: s };
    if (/east africa/.test(l)) return { value: "East Africa", quote: s };
    if (/africa/.test(l)) return { value: "African countries", quote: s };
    if (/developing countr|low[- ]?(and|&)?[- ]?middle[- ]income|dac list/.test(l)) return { value: "developing countries", quote: s };
    if (/commonwealth/.test(l)) return { value: "Commonwealth countries", quote: s };
    if (/\b(us|u\.s\.|united states)\b/.test(l) && /only|citizens|residents|authori[sz]ed to work/.test(l)) return { value: "US only", quote: s };
    if (/\b(eu|eea|european union)\b/.test(l) && /only|citizens|residents|nationals/.test(l)) return { value: "EU/EEA only", quote: s };
    return { value: s.slice(0, 200), quote: s }; // eligibility rules decide; unclear -> "check"
  }
  if (lead.location) return { value: lead.location, quote: `Location (job board listing): ${lead.location}` };
  return none("unknown");
}

const LEVELS: [RegExp, string][] = [
  [/undergraduate|bachelor'?s?\b|\bbsc\b|\bbeng\b/i, "undergraduate"],
  [/master'?s?\b|\bmsc\b|\bmeng\b|postgraduate/i, "masters"],
  [/\bph\.?d\b|doctoral/i, "phd"],
  [/exchange (programme|program|semester|students?)/i, "exchange"],
  [/summer (school|programme|program|research|internship)/i, "summer"],
];

export function extractLevels(ss: string[]): Evidenced<string[]> {
  const s = first(ss, /(open to|eligible|for|applicants?|students?)[^.]{0,80}(undergraduate|bachelor|master|ph\.?d|doctoral|postgraduate|exchange|summer)/i) ??
    first(ss, /(undergraduate|bachelor|master'?s|ph\.?d|postgraduate)/i);
  if (!s) return none([]);
  return { value: LEVELS.filter(([re]) => re.test(s)).map(([, v]) => v), quote: s };
}

export function extractFields(ss: string[]): Evidenced<string[]> {
  const s = first(ss, /(fields? of study|disciplines?|subjects?|programmes? in|areas?)[^.]{0,200}/i);
  if (!s) return none([]);
  if (/all (fields|disciplines|subjects)|any (field|discipline|subject)|various fields/i.test(s)) return { value: ["all fields"], quote: s };
  const found = s.match(/engineering|electrical|electronic|computer science|computer|software|information technology|ict|data science|artificial intelligence|robotics|physics|mathematics|stem|business|law|medicine|agriculture|economics|arts|humanities|social sciences|public health|education/gi);
  return found ? { value: [...new Set(found.map((f) => f.toLowerCase()))], quote: s } : none([]);
}

export function extractEnrollment(ss: string[]): Evidenced<string | null> {
  const s = first(ss, /(currently|already) (enrolled|studying|registered)|must not (be )?(enrolled|hold)|first[- ]year|incoming (students|freshmen)|newly admitted|high school (graduates|leavers)|secondary school (graduates|leavers)|prior (university|tertiary)|enrolled (in|at) (a|an) (university|degree)/i);
  return s ? { value: s, quote: s } : none(null);
}

export function extractAge(ss: string[]): Evidenced<number | null> {
  for (const s of ss) {
    const m =
      s.match(/(?:under|below|younger than|not (?:be )?(?:older|more) than|maximum age(?: of| is)?|aged? (?:up to|under|below)?|age limit(?: of| is)?)\s*(\d{2})\b/i) ??
      s.match(/\b(\d{2}) years (?:of age )?or (?:younger|less|under)/i);
    if (m && /age|old|young|years/i.test(s)) return { value: +m[1], quote: s };
  }
  return none(null);
}

export function extractGpa(ss: string[]): { grade: Evidenced<string | null>; mandatory: Evidenced<boolean | null> } {
  const s = first(ss, /\b(c?gpa|grade point average|first[- ]class|second[- ]class|upper second|honou?rs degree)\b/i);
  if (!s) return { grade: none(null), mandatory: none(null) };
  const optional = /optional|if available|not required|preferred/i.test(s);
  const mandatory = !optional && /minimum|at least|required|must have|must hold/i.test(s);
  return { grade: { value: s, quote: s }, mandatory: { value: optional ? false : mandatory ? true : null, quote: s } };
}

export function extractLanguage(ss: string[]): Evidenced<string | null> {
  const s = first(ss, /\b(ielts|toefl|duolingo|pte academic)\b|proficien[a-z]* in (german|french|japanese|korean|chinese|mandarin|russian|turkish|hungarian|spanish|portuguese|arabic|dutch|swedish|italian)|(german|french|japanese|korean|chinese|russian|turkish) language (skills|certificate|proficiency|level)/i);
  return s ? { value: s, quote: s } : none(null);
}

const TUITION = /tuition|fee waiver|full fees|course fees|university fees/i;
const LIVING = /stipend|living (allowance|costs|expenses)|monthly allowance|subsistence|maintenance allowance|accommodation/i;
const EXTRAS = /travel|flight|airfare|visa|health insurance|medical insurance/i;

export function extractFunding(ss: string[], type: Lead["type"]): { funding: Evidenced<Funding>; details: Evidenced<string | null> } {
  const covered = ss.filter((s) => /cover|include|provide|receive|award|benefit|offer|grant|paid|funded/i.test(s) && (TUITION.test(s) || LIVING.test(s) || EXTRAS.test(s)));
  const t = covered.find((s) => TUITION.test(s));
  const l = covered.find((s) => LIVING.test(s));
  const details = covered.slice(0, 3).join(" ");
  const det: Evidenced<string | null> = covered.length ? { value: details.slice(0, 400), quote: covered[0] } : none(null);
  if (type === "remote_work") return { funding: { value: "paid", quote: null }, details: det };
  if (t && l) return { funding: { value: "full", quote: t === l ? t : `${t} … ${l}` }, details: det };
  if (t || l) return { funding: { value: "partial", quote: (t ?? l)! }, details: det };
  const paid = first(ss, /\b(paid (internship|position|role)|salary|per (hour|month)|\/hr|monthly stipend)\b/i);
  if (paid && type !== "scholarship") return { funding: { value: "paid", quote: paid }, details: det };
  return { funding: none("unknown"), details: det };
}

export function extractPay(ss: string[], lead: Lead): Evidenced<string | null> {
  const s = first(ss, /(\$|usd|eur|€|£|ksh|kes)\s?\d[\d,.]*\s*(k\b)?[^.]{0,40}(per|\/|a)\s*(hour|hr|month|year|annum|week)|salary(?: range)?(?: of| is|:)\s*[^.]{0,60}\d/i);
  if (s) return { value: s.slice(0, 200), quote: s };
  if (lead.salary) return { value: lead.salary, quote: `Salary (job board listing): ${lead.salary}` };
  return none(null);
}

const METHODS = ["M-Pesa", "Mpesa", "PayPal", "Payoneer", "Wise", "Deel", "bank transfer", "wire transfer", "direct deposit", "SWIFT", "crypto", "USDT"];
export function extractPaymentMethods(ss: string[]): Evidenced<string[]> {
  const s = first(ss, /(paid|payment|payout|pay you|payments are made|we pay)[^.]{0,100}(m-?pesa|paypal|payoneer|wise|deel|bank|wire|swift|crypto|usdt)/i);
  if (!s) return none([]);
  return { value: METHODS.filter((m) => new RegExp(`\\b${m.replace(/[-]/g, "-?")}\\b`, "i").test(s)), quote: s };
}

export function extractFee(ss: string[]): Evidenced<string | null> {
  const s = first(ss, /(application|processing|registration|admin(istration)?) fee/i);
  if (!s || /no (application )?fee|free of charge|fee(s)? (is|are) waived|without (any )?fee/i.test(s)) return none(null);
  return { value: s.slice(0, 200), quote: s };
}

export function extractHowToApply(ss: string[]): Evidenced<string | null> {
  const s = first(ss, /(to apply|how to apply|apply (online|through|via|at|using)|submit (your|an|the) application|application (portal|form) )/i);
  return s ? { value: s.slice(0, 300), quote: s } : none(null);
}

export function extractRemote(text: string, lead: Lead): boolean | null {
  if (lead.type === "remote_work") return true;
  if (/\b(fully remote|100% remote|remote[- ]first|work from (home|anywhere)|remote position)\b/i.test(text)) return true;
  if (/\b(on[- ]site|in[- ]office|must relocate|in person)\b/i.test(text)) return false;
  return null;
}

/** Heuristic: does the page describe one specific opportunity? */
export function looksLikeOpportunity(text: string): boolean {
  const cues = [/apply|application/i, /deadline|closing date|close/i, /eligib|requirement|criteria|who can/i, /benefit|stipend|salary|tuition|funding|covers/i];
  return cues.filter((c) => c.test(text)).length >= 2;
}

export function extractWithRules(pageText: string, officialUrl: string, lead: Lead, now = new Date()): Extracted | null {
  if (!looksLikeOpportunity(pageText)) return null;
  const ss = sentences(pageText);
  const gpa = extractGpa(ss);
  const { funding, details } = extractFunding(ss, lead.type);
  return {
    title: lead.title,
    provider: lead.provider ?? new URL(officialUrl).hostname.replace(/^www\./, ""),
    officialUrl,
    deadline: extractDeadline(ss, now),
    eligibleNationalities: extractNationality(ss, lead),
    studyLevels: extractLevels(ss),
    fields: extractFields(ss),
    enrollmentRule: extractEnrollment(ss),
    ageLimit: extractAge(ss),
    gradeRequirement: gpa.grade,
    gpaMandatory: gpa.mandatory,
    languageRequirement: extractLanguage(ss),
    funding,
    fundingDetails: details,
    pay: extractPay(ss, lead),
    paymentMethods: extractPaymentMethods(ss),
    applicationFee: extractFee(ss),
    howToApply: extractHowToApply(ss),
    contactEmails: [...new Set(pageText.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [])].slice(0, 5),
    remote: extractRemote(pageText, lead),
  };
}
