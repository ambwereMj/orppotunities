import type { Lead, OppType } from "../types.js";

/**
 * Cheap keyword pre-filter applied BEFORE the expensive steps (fetching the official page).
 * Conservative: it only drops things that are clearly irrelevant, clearly another field,
 * clearly senior, or clearly geo-locked. Field eligibility is otherwise decided on the official page.
 */

const RELEVANT: Record<OppType, RegExp> = {
  scholarship:
    /scholarship|fellowship|bursary|grant|funded|exchange|summer (school|program)|stipend|study in|masters?|undergraduate|bachelor|award/i,
  internship: /intern|attachment|graduate (trainee|program)|trainee|apprentice|entry[- ]level|junior|engineer|developer|software|ict|technology|young professionals?/i,
  // You're flexible on jobs as long as the qualifications are within reach (checked in preferences.ts).
  remote_work: /\w/,
  program: /summer of code|outreachy|mentorship|fellowship|hackathon|bug bounty|grant|research assistant|travel grant|prize|competition|challenge|accelerator|bootcamp/i,
  skills: /voucher|certification|bootcamp|stipend|scholarship|free (course|training)|program|academy/i,
};

/**
 * Aggregators post every kind of opportunity under one feed, so the type is inferred from the title.
 * Falls back to the source's default type.
 */
export function inferType(title: string, fallback: OppType): OppType {
  const t = title.toLowerCase();
  if (/\b(intern(ship)?s?|industrial attachment|attachment|graduate trainee|apprenticeship)\b/.test(t)) return "internship";
  if (/\b(summer of code|outreachy|hackathon|bug bounty|competition|challenge|prize|accelerator|mentorship program|mlh)\b/.test(t)) return "program";
  if (/\b(scholarships?|bursary|bursaries|fully funded|study in|masters?|undergraduate|phd|exchange program)\b/.test(t)) return "scholarship";
  if (/\b(fellowship)\b/.test(t)) return "program";
  if (/\b(bootcamp|certification|voucher|free (course|training)|academy)\b/.test(t)) return "skills";
  if (/\b(remote|developer|engineer|freelance|part[- ]time|contract)\b.*\b(job|role|position)?\b/.test(t) && fallback === "remote_work") return "remote_work";
  return fallback;
}

/** Titles that clearly name a field other than engineering/tech. */
// Whole words (short ones that would otherwise match inside tech words, e.g. "art" in "artificial").
const OTHER_FIELD_WORDS =
  /\b(law|legal|media|film|music|arts?|poetry|fashion|history|sports?|football|mba|finance|marketing|divinity|dyslexia|writing contest|creative writing|social work|business school)\b/i;
// Word stems: "journalis" matches journalist/journalism, "nurs" nursing/nurses, "health" healthcare…
const OTHER_FIELD_STEMS =
  /\b(journalis|medic|nurs|dental|dentist|pharmac|theolog|teach|educat|agricultur|veterinar|health|psycholog|humanit|literat|touris|hospitality|nutrition|midwif|accountan|accounting|child (development|protection|rights)|child and youth|youth development|early childhood|(person|patient)[- ]cent(red|ered) care|caregiv|palliative)\w*/i;
/** Job titles that state a country restriction, e.g. "(U.S. Based)", "(Remote @ Colombia)". */
const TITLE_GEO_LOCK =
  /\b(u\.?s\.?|usa|uk|canada|eu|europe|latam|india|philippines)[- ]?(based|only|residents?)\b|\(remote\s*[@-]\s*(?!worldwide|anywhere|global|africa|kenya)[a-z ]+\)|\bremote\s*\((?!worldwide|anywhere|global|africa|kenya|emea)[a-z ,]+only\)/i;
/** Things you never want (cheap title check; the full rules are in preferences.ts). */
const NEVER_TITLES: [RegExp, string][] = [
  [/\b(ai|llm) ?(trainer|tutor|rater)\b|\btrain(ing)? (ai|llms?)\b|\b(ai|llm) coding tasks\b|\bdata (annotat|label)|\bannotat(or|ion)\b/i, "AI-training work (you said no)"],
  [/\bboot ?camps?\b/i, "bootcamp (you said no)"],
  [/\b(mooc|online course|free online (course|training)|self-paced)\b/i, "online course (you said no)"],
  [/\b(mba|business school|global management program)\b/i, "business/management programme"],
];

/** Round-up posts listing many opportunities ("20 Scholarships … Currently Open"). */
const ROUNDUP = /^\s*(top\s+)?\d+\+?\s+(\w+\s+){0,3}(scholarships?|opportunities|jobs|internships|fellowships|grants)\b/i;
/** Language-study scholarships (not engineering). */
const LANGUAGE_STUDY = /\b(study|learn)\s+(arabic|french|german|chinese|mandarin|japanese|korean|spanish|portuguese|russian|turkish|italian)\b/i;

const OTHER_FIELD = { test: (s: string) => OTHER_FIELD_WORDS.test(s) || OTHER_FIELD_STEMS.test(s) };
const TECH_HINT = /engineer|electr|computer|software|ict|tech|stem|science|data|ai\b|digital|cyber|robot|embedded|code|coding|developer|innovation/i;

const SENIOR = /\b(senior|sr\.?|staff|principal|lead|head of|director|vp|manager|architect)\b/i;

/** Location strings that clearly exclude someone living in Kenya. */
const GEO_LOCKED =
  /^(us|usa|united states|u\.s\.|canada|uk|united kingdom|eu|europe|emea only|north america|americas|latam|apac|australia|germany|india|philippines)( only)?$/i;
const GEO_OK = /worldwide|anywhere|global|africa|kenya|remote$|emea|unspecified|^$/i;

export function geoLockedLocation(location: string | undefined): boolean {
  if (!location) return false;
  const parts = location.split(/[,/;|]| or /i).map((p) => p.trim()).filter(Boolean);
  if (parts.some((p) => GEO_OK.test(p))) return false;
  return parts.length > 0 && parts.every((p) => GEO_LOCKED.test(p) || /\bonly\b/i.test(p));
}

export interface PrefilterResult {
  keep: boolean;
  reason?: string;
}

export function prefilter(lead: Lead): PrefilterResult {
  const text = `${lead.title} ${lead.summary ?? ""} ${(lead.tags ?? []).join(" ")}`;
  // Watched official pages are already targeted by the page parser.
  if (lead.watched) return { keep: true };
  // Job boards: judge relevance by the job title only (descriptions mention "web", "test"… everywhere).
  const relevanceText = lead.type === "remote_work" ? lead.title : text;
  if (!RELEVANT[lead.type].test(relevanceText)) return { keep: false, reason: "not relevant to type" };
  if (ROUNDUP.test(lead.title)) return { keep: false, reason: "round-up post, not one opportunity" };
  if (LANGUAGE_STUDY.test(lead.title)) return { keep: false, reason: "language-study programme" };
  if ((lead.type === "remote_work" || lead.type === "internship") && TITLE_GEO_LOCK.test(lead.title)) {
    return { keep: false, reason: "title says country-restricted" };
  }
  if (lead.type !== "remote_work" && lead.type !== "internship" && OTHER_FIELD.test(lead.title) && !TECH_HINT.test(lead.title)) {
    return { keep: false, reason: "another field" };
  }
  for (const [re, why] of NEVER_TITLES) if (re.test(lead.title)) return { keep: false, reason: why };
  if ((lead.type === "remote_work" || lead.type === "internship") && SENIOR.test(lead.title)) {
    return { keep: false, reason: "senior role" };
  }
  if (geoLockedLocation(lead.location)) return { keep: false, reason: `location restricted: ${lead.location}` };
  return { keep: true };
}

/**
 * Fair ordering: take leads round-robin across sources, at most `perSource` each, so one big
 * source can't use up the whole run.
 */
export function roundRobin<T extends { sourceId: string }>(leads: T[], perSource: number, max: number): T[] {
  const by = new Map<string, T[]>();
  for (const l of leads) {
    const arr = by.get(l.sourceId) ?? [];
    if (arr.length < perSource) arr.push(l);
    by.set(l.sourceId, arr);
  }
  const queues = [...by.values()];
  const out: T[] = [];
  for (let i = 0; out.length < max && queues.some((q) => i < q.length); i++) {
    for (const q of queues) if (i < q.length && out.length < max) out.push(q[i]);
  }
  return out;
}
