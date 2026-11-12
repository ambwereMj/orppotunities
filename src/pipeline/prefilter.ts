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
  remote_work:
    /developer|engineer|software|frontend|front-end|backend|back-end|full[- ]?stack|web|javascript|typescript|react|node|python|django|flask|qa|test|annotat|ai train|data label|technical writ|tutor|embedded|firmware|iot/i,
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
const OTHER_FIELD =
  /\b(law|legal|medicine|medical|nursing|dental|pharmacy|journalis|media|film|music|arts?|art|poetry|writing contest|creative writing|theolog|divinity|fashion|dyslexia|teacher|teaching|education|agricultur|veterinar|public health|social work|humanities|history|literature|sports?|football|tourism|hospitality|nutrition|midwif|psycholog|law school|mba|business school|accounting|finance|marketing)\b/i;
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
  if ((lead.type === "scholarship" || lead.type === "program") && OTHER_FIELD.test(lead.title) && !TECH_HINT.test(lead.title)) {
    return { keep: false, reason: "another field" };
  }
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
