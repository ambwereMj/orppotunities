import type { Lead } from "../types.js";

/**
 * Cheap keyword pre-filter applied BEFORE any AI call, so money is only spent on plausible leads.
 * Conservative: it only drops things that are clearly irrelevant or clearly geo-locked.
 */

const RELEVANT: Record<Lead["type"], RegExp> = {
  scholarship:
    /scholarship|fellowship|bursary|grant|funded|exchange|summer (school|program)|stipend|study in|masters?|undergraduate|bachelor/i,
  internship: /intern|attachment|graduate (trainee|program)|trainee|apprentice|entry[- ]level|junior|engineer|developer|software|ict|technology/i,
  remote_work:
    /developer|engineer|software|frontend|front-end|backend|back-end|full[- ]?stack|web|javascript|typescript|react|node|python|qa|test|annotat|ai train|data label|technical writ|tutor|embedded|firmware|iot/i,
  program: /summer of code|outreachy|mentorship|fellowship|hackathon|bug bounty|grant|research assistant|travel grant|prize|competition|challenge/i,
  skills: /voucher|certification|bootcamp|stipend|scholarship|free (course|training)|program/i,
};

/** Engineering/tech relevance for scholarships & programs (aggregators post every field). */
const TECH =
  /engineer|electr|computer|comput|software|ict|technology|stem|science|data|ai\b|artificial intelligence|robot|embedded|telecom|information|any (field|discipline)|all (fields|disciplines|subjects)|various fields|multiple fields|undergraduate|bachelor/i;

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
  // Watched official pages are already targeted; keep their links.
  if (lead.watched) return { keep: true };
  if (!RELEVANT[lead.type].test(text)) return { keep: false, reason: "not relevant to type" };
  if ((lead.type === "scholarship" || lead.type === "program") && !TECH.test(text)) {
    return { keep: false, reason: "not an engineering/tech field" };
  }
  if ((lead.type === "remote_work" || lead.type === "internship") && SENIOR.test(lead.title)) {
    return { keep: false, reason: "senior role" };
  }
  if (geoLockedLocation(lead.location)) return { keep: false, reason: `location restricted: ${lead.location}` };
  return { keep: true };
}
