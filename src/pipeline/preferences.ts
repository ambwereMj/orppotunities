import type { EligibilityResult, Extracted, Lead } from "../types.js";

/**
 * YOUR PREFERENCES (set 20 Nov 2026). These override everything else.
 *
 *  Scholarships  → FULLY FUNDED only, and related to electrical / electronic / computer engineering
 *                  (or open to all fields including engineering).
 *  Jobs / remote → anything whose qualifications are within reach: no senior roles, no licensed
 *                  professions, no "3+ years experience".
 *  Everything else (programmes, fellowships, competitions, hackathons, internships…) → must either
 *                  fund TRAVEL or BUILD you (mentorship, research, leadership, prizes, real projects).
 *  Never         → AI-training / data-annotation work, bootcamps, online unpaid courses.
 */

export interface PreferenceResult {
  drop: string | null; // reason the item is excluded
  notes: string[]; // shown with the item
  boost: number; // added to the score
}

const NEVER: [RegExp, string][] = [
  [/\b(ai|llm|model) ?(trainer|training (jobs?|work|tasks?)|tutor|rater|evaluator)\b|\btrain(ing)? (ai|llms?|models?)\b|\brlhf\b|\b(ai|llm) coding tasks\b|\bdata (annotat|label)|\bannotat(or|ion) (jobs?|work|specialist)\b|\bsearch (quality )?rater\b|\bprompt (writer|engineer(ing)? tasks)\b|\boutlier\.ai\b|\bdataannotation\b/i, "AI-training / annotation work (you said no)"],
  [/\bboot ?camps?\b/i, "bootcamp (you said no)"],
  [/\b(mooc|e-?learning|self-paced|free online (course|training)|online (course|courses|training|certificate|certification|learning programme|learning program))\b|\bonline (and|or) (free|self)/i, "online course (you said no unpaid online courses)"],
];

const PAID = /\b(stipend|salary|paid (internship|role|position|fellowship)|allowance|honorari|per (month|hour|week)|\$\s?\d|usd\s?\d|kes\s?\d|ksh\s?\d|€\s?\d|£\s?\d)/i;
const FULLY_FUNDED_CLAIM = /\b(fully[- ]funded|full scholarships?|full tuition (waiver )?(and|&|\+) (a )?(monthly )?(stipend|living)|covers? (all|full) (costs|expenses))\b/i;
const EE_CE = /\b(electr\w*|computer|comput\w*|software|ict|information (and communication )?technolog\w*|telecom\w*|embedded|robotic\w*|mechatronic\w*|automation|power systems?|data science|artificial intelligence|cyber\w*|stem|engineering|technology)\b/i;
const ALL_FIELDS = /\b(all|any|various|multiple|every) (fields?|disciplines?|subjects?|areas?|programmes?|programs?)\b|\bopen to all\b/i;
const BUSINESS = /\b(mba|business (school|administration)|management (program|programme)|said business|global management|executive education|finance)\b/i;
/** Roles that need a professional qualification you don't have (degree/licence in another field). */
const LICENSED = /\b(nurse|nursing|physician|doctor|surgeon|dentist|pharmacist|pharmac\w*|attorney|lawyer|paralegal|legal counsel|cpa|accountant|bookkeep\w*|actuar\w*|auditor|therapist|psycholog\w*|counsel+or|clinical|patient|medical|endocrinolog\w*|cardiolog\w*|radiolog\w*|veterinar\w*|licensed|registered (nurse|dietitian)|social worker|teacher certification)\b/i;
const SENIOR = /\b(senior|sr\.?|staff|principal|lead|head of|director|vp|vice president|manager|architect|chief)\b/i;
const TRAVEL = /\b(travel|flights?|airfare|air ticket|visa (fees|costs|support)|accommodation|in[- ]person|on[- ]site|onsite|held in|hosted in|conference|summit|exchange|study tour|abroad|relocation|residential)\b/i;
const GROWTH = /\b(fellowships?|mentor\w*|internships?|research|leadership|award|prize|competition|hackathon|challenge|accelerator|incubat\w*|summer (school|program|programme)|exchange|grant|apprentice\w*|residency|open source|scholars? program)\b/i;

/** Years of experience the posting asks for (largest number stated), or null. */
export function yearsRequired(text: string): number | null {
  let max: number | null = null;
  for (const m of text.matchAll(/\b(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years?|yrs?)(?:'|’)?\s+(?:of\s+)?(?:\w+\s+){0,4}?experience\b/gi)) {
    const n = Number(m[1]);
    if (n <= 20) max = Math.max(max ?? 0, n);
  }
  return max;
}

export function applyPreferences(lead: Lead, x: Extracted, el: EligibilityResult, pageText = ""): PreferenceResult {
  const notes: string[] = [];
  let boost = 0;
  const title = `${x.title || lead.title}`;
  const text = `${title} ${lead.summary ?? ""} ${x.fundingDetails.value ?? ""} ${x.howToApply.value ?? ""}`;
  const all = `${text} ${pageText.slice(0, 20000)}`;

  for (const [re, why] of NEVER) if (re.test(`${title} ${lead.summary ?? ""}`)) return { drop: why, notes, boost };

  if (lead.type === "scholarship") {
    // Fully funded only.
    const f = x.funding.value;
    if (f === "partial" || f === "none") return { drop: "not fully funded", notes, boost };
    if (f !== "full") {
      if (FULLY_FUNDED_CLAIM.test(text)) notes.push("Listed as fully funded, but the official page doesn't spell out tuition + living costs — confirm before applying.");
      else return { drop: "funding not stated as full", notes, boost };
    }
    if (BUSINESS.test(title)) return { drop: "business / management programme", notes, boost };
    // Related to electrical / computer engineering.
    const fields = x.fields.value.join(" ");
    if (fields && !ALL_FIELDS.test(fields) && !EE_CE.test(fields)) return { drop: `field not related to electrical/computer engineering (${fields})`, notes, boost };
    if (EE_CE.test(`${title} ${fields}`)) boost += 10;
    else if (!fields) notes.push("Field of study isn't stated — check that electrical / computer engineering is covered.");
    return { drop: null, notes, boost };
  }

  if (lead.type === "remote_work" || (lead.type === "internship" && PAID.test(all) && !GROWTH.test(title))) {
    // Jobs: anything within reach.
    if (SENIOR.test(title)) return { drop: "senior role", notes, boost };
    if (LICENSED.test(title)) return { drop: "needs a professional licence", notes, boost };
    const yrs = yearsRequired(all);
    if (yrs !== null && yrs >= 3) return { drop: `asks for ${yrs}+ years of experience`, notes, boost };
    if (yrs !== null && yrs > 0) notes.push(`Asks for ${yrs} year(s) of experience — your projects and Moringa training may count; check.`);
    if (/\b(junior|entry[- ]level|graduate|intern|trainee|associate)\b/i.test(title)) boost += 6;
    return { drop: null, notes, boost };
  }

  // Programmes, fellowships, competitions, internships, skills: travel or growth.
  const travel = TRAVEL.test(all) && /(funded|covered|paid|provided|sponsored|reimburs|free of charge|at no cost)/i.test(all);
  const growth = GROWTH.test(`${title} ${lead.summary ?? ""}`) || lead.type === "internship";
  if (lead.type === "skills" && !PAID.test(all)) return { drop: "training without pay/stipend", notes, boost };
  if (!travel && !growth) return { drop: "doesn't fund travel or build skills/career", notes, boost };
  if (travel) {
    notes.push("Funds travel.");
    boost += 6;
  }
  if (/\b(prize|award|cash|\$\s?\d)/i.test(text)) boost += 2;
  return { drop: null, notes, boost };
}
