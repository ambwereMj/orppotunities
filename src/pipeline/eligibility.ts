import type { Profile } from "../lib/config.js";
import type { EligibilityResult, Extracted, Lead, Verdict } from "../types.js";
import { geoLockedLocation } from "./prefilter.js";

const OPEN_NATIONALITY =
  /worldwide|international|all (countries|nationalities)|any (country|nationality)|global|open to all|africa|kenya|developing countr|commonwealth|sub-saharan|east africa|low[- ]?(and|&)?[- ]?middle[- ]income|lmic|dac list|non-eu|non-eea|third[- ]countr/i;
const RESTRICTED_NATIONALITY =
  /\b(us|u\.s\.|united states|american|canadian|canada|uk|british|eu|eea|european union|european|german|australian|indian|nigerian|ghanaian|south african|ugandan|tanzanian|asean|latin america)\b.*\b(only|citizens?|residents?|nationals?)\b|\bonly\b/i;

const LATER_LEVEL = /master|msc|meng|postgrad|graduate degree|phd|doctora/i;
const NOW_LEVEL = /undergrad|bachelor|bsc|beng|exchange|summer|research intern|short course|non-degree|any level|all levels|students?/i;

const BARS_CURRENT_ENROLLMENT =
  /(must not|should not|cannot|can't|not) (be )?(currently |already )?(enrolled|registered|studying)|not (already )?(hold|holding|pursuing) (a|an)? ?(bachelor|undergraduate|university)|no (prior|previous) (university|tertiary)|without (any )?(prior|previous) university/i;
const NEW_ENTRANT_ONLY =
  /(first[- ]year|1st[- ]year|incoming|prospective|new(ly admitted)? (students|undergraduates|entrants)|high school (graduates|leavers)|secondary school (graduates|leavers)|kcse (graduates|leavers|candidates)|completed (high|secondary) school (in|within))/i;

/** Programme tied to a region/country group that excludes Kenya (e.g. Chevening ASEAN, SIDS). */
const OTHER_REGION =
  /\b(asean|sids|small island|caribbean|pacific islands?|latin america|south asia|central asia|middle east|mena|balkans?|eastern partnership|western europe|north america)\b/i;
const OTHER_NATIONALS =
  /\bfor (nigerian|ghanaian|indian|pakistani|bangladeshi|indonesian|filipino|vietnamese|egyptian|ethiopian|ugandan|tanzanian|rwandan|south african|zimbabwean|zambian|malawian|cameroonian|american|canadian|british|european) (students|nationals|citizens|youth|women|graduates)\b/i;

/** Requires an already-completed bachelor's degree (Master's level etc.). */
const NEEDS_DEGREE =
  /hold (a|an) (first|undergraduate|bachelor'?s|honours) degree|(have|has) (completed|obtained|earned) (a|an|their|your) (first|undergraduate|bachelor'?s) degree|bachelor'?s degree (is )?(required|by)|recent graduates?|graduated (in|within|between)/i;

const NON_ENGLISH_LANG = /\b(german|french|japanese|korean|chinese|mandarin|russian|turkish|hungarian|spanish|portuguese|arabic|dutch|swedish|italian)\b/i;

function ageOn(dob: string, date = new Date()): number {
  const d = new Date(dob);
  let a = date.getFullYear() - d.getFullYear();
  if (date < new Date(date.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a;
}

export function daysUntil(isoDate: string, now = new Date()): number {
  const d = new Date(isoDate + "T23:59:59+03:00"); // deadlines read in Nairobi time
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

export function checkEligibility(x: Extracted, lead: Lead, p: Profile, now = new Date()): EligibilityResult {
  const reasons: string[] = [];
  let verdict: Verdict = "eligible";
  const worst = (v: Verdict, why: string) => {
    reasons.push(why);
    if (v === "ineligible" || (v === "check" && verdict === "eligible")) verdict = v;
  };

  // Expired
  if (x.deadline.value && daysUntil(x.deadline.value, now) < 0) worst("ineligible", `expired (deadline ${x.deadline.value})`);

  // Nationality / location
  const nat = x.eligibleNationalities.value;
  if (nat === "unknown") {
    worst("check", "nationality eligibility not stated");
  } else if (OPEN_NATIONALITY.test(nat)) {
    // ok
  } else if (RESTRICTED_NATIONALITY.test(nat)) {
    worst("ineligible", `restricted to: ${nat}`);
  } else {
    worst("check", `nationality rule unclear: ${nat}`);
  }
  const regionText = `${x.title} ${lead.title} ${nat}`;
  if (OTHER_REGION.test(regionText) && !/africa|kenya|worldwide|all countries/i.test(regionText)) {
    worst("ineligible", `programme for another region (${regionText.match(OTHER_REGION)![0]})`);
  }
  if (OTHER_NATIONALS.test(regionText)) worst("ineligible", `for other nationals: ${regionText.match(OTHER_NATIONALS)![0]}`);
  if ((lead.type === "remote_work" || lead.type === "internship") && geoLockedLocation(lead.location)) {
    worst("ineligible", `location restricted: ${lead.location}`);
  }
  if (lead.type === "remote_work" && x.remote === false && !/kenya|nairobi/i.test(`${nat} ${lead.location ?? ""}`)) {
    worst("ineligible", "not remote and not in Kenya");
  }

  // Study level (scholarships/programs)
  if (lead.type === "scholarship" || lead.type === "program") {
    const levels = x.studyLevels.value.join(" ");
    if (levels && LATER_LEVEL.test(levels) && !NOW_LEVEL.test(levels)) {
      worst("ineligible", "Master's/PhD — needs a completed bachelor's (saved for later)");
    }
  }

  // Enrollment rules — truthfully: currently enrolled at university since Sept 2024.
  const rule = x.enrollmentRule.value ?? "";
  const degreeText = `${rule} ${x.gradeRequirement.value ?? ""} ${x.studyLevels.quote ?? ""}`;
  if (lead.type !== "remote_work" && NEEDS_DEGREE.test(degreeText)) {
    worst("ineligible", "needs a completed bachelor's degree (saved for later)");
  } else if (BARS_CURRENT_ENROLLMENT.test(rule)) worst("ineligible", `bars current university students: "${rule}"`);
  else if (NEW_ENTRANT_ONLY.test(rule)) worst("check", `new entrants only? You're a current JKUAT student: "${rule}"`);

  // Field
  const fields = x.fields.value.join(" ").toLowerCase();
  if (fields && !/all|any|various|multiple|open/.test(fields)) {
    const match = p.fields.some((f) => fields.includes(f.toLowerCase().split(" ")[0])) || /engineer|stem|technolog|comput|electr|ict|software|science/.test(fields);
    if (!match) worst("ineligible", `field mismatch: ${x.fields.value.join(", ")}`);
  }

  // Age
  if (x.ageLimit.value) {
    if (!p.date_of_birth) worst("check", `age limit ${x.ageLimit.value} — your date of birth isn't on file`);
    else if (ageOn(p.date_of_birth, now) > x.ageLimit.value) worst("ineligible", `over age limit ${x.ageLimit.value}`);
  }

  // Grades
  if (x.gpaMandatory.value === true && !p.gpa) {
    worst("check", "GPA is mandatory — application will pause and ask you");
  }
  if (x.gradeRequirement.value && /gpa|cgpa|first class|second class|honou?rs/i.test(x.gradeRequirement.value)) {
    worst("check", `grade requirement: ${x.gradeRequirement.value}`);
  }

  // Language
  const lang = x.languageRequirement.value ?? "";
  if (lang && NON_ENGLISH_LANG.test(lang) && !p.languages.some((l) => lang.toLowerCase().includes(l.toLowerCase()))) {
    worst("check", `language requirement: ${lang}`);
  } else if (/ielts|toefl|duolingo|pte/i.test(lang)) {
    worst("check", `English test: ${lang} (ask about English-medium waiver)`);
  }

  return { verdict, reasons };
}
