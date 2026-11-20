import type { Profile } from "../lib/config.js";
import { DOC_TYPES, type DocType } from "../vault/docs.js";

/** One field read from a real application form. */
export interface FormField {
  kind: "text" | "email" | "tel" | "date" | "number" | "url" | "textarea" | "select" | "radio" | "checkbox" | "file" | "password" | "other";
  label: string;
  name?: string;
  required?: boolean;
  maxLength?: number | null;
  options?: string[];
  selector?: string;
}

/**
 * filled = we have a true answer from your profile (copy it)
 * you    = only you can answer / upload this
 * stop   = a checkpoint: login, payment, legal declaration, ID numbers, missing mandatory info
 */
export type AnswerStatus = "filled" | "you" | "stop";
export interface Answer {
  field: FormField;
  status: AnswerStatus;
  value?: string;
  note: string;
}

const has = (s: string, re: RegExp) => re.test(s);

/** "0712 345 678" (Kenya) -> "+254 712 345 678". */
export function intlPhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  const d = phone.replace(/\D/g, "");
  if (/^0\d{9}$/.test(d)) return `+254 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  if (/^254\d{9}$/.test(d)) return `+254 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
  return phone;
}

/** Choose the select/radio option matching our value, or undefined if none clearly does. */
export function pickOption(options: string[] | undefined, value: string): string | undefined {
  if (!options?.length) return value;
  const v = value.toLowerCase();
  return (
    options.find((o) => o.trim().toLowerCase() === v) ??
    options.find((o) => o.toLowerCase().includes(v) || (o.length > 3 && v.includes(o.trim().toLowerCase())))
  );
}

const DOC_FOR_UPLOAD: [RegExp, DocType | "pack_cv" | "you"][] = [
  [/\b(cv|resume|r[ée]sum[ée]|curriculum)\b/, "pack_cv"],
  [/kcse.*results?|results? slip|high school results/, "kcse_results"],
  [/transcript|academic record/, "transcript"],
  [/kcse|secondary|high school (certificate|diploma)/, "kcse"],
  [/admission|enrol?ment|proof of (study|registration)/, "enrolment"],
  [/passport/, "passport"],
  [/national id|identity|id (card|copy|document)/, "national_id"],
  [/certificate|diploma/, "moringa"],
  [/recommendation|reference letter|referee/, "you"],
  [/photo|picture|headshot|portrait/, "you"],
  [/motivation|cover letter|statement|essay|proposal/, "you"],
];

export function answerField(f: FormField, p: Profile, storedDocs: DocType[] = []): Answer {
  const t = `${f.label} ${f.name ?? ""}`.toLowerCase().replace(/[_-]+/g, " ");
  const c = p.contact ?? {};
  const uni = p.education.find((e) => e.current);
  const school = p.education.find((e) => e.level === "secondary");
  const ts = p.technical_skills ?? {};
  const [first, ...rest] = p.name.split(/\s+/);
  const last = rest.at(-1) ?? "";
  const ok = (value: string | undefined | null, note = "From your profile."): Answer =>
    value ? { field: f, status: "filled", value: String(value), note } : { field: f, status: "you", note: "Not in your profile — fill this yourself." };
  const you = (note: string): Answer => ({ field: f, status: "you", note });
  const stop = (note: string): Answer => ({ field: f, status: "stop", note });

  // Checkpoints first.
  if (f.kind === "password") return stop("Login / account required — sign in yourself.");
  if (has(t, /card number|cvv|cvc|expiry|billing|payment|pay now|mpesa pin|\bpin\b/)) return stop("Payment — only you decide whether to pay, and only to the official institution.");
  if (has(t, /passport (no|number)|id (no|number)|national id number|identity number|social security|tax (id|pin)|kra pin/))
    return stop("ID/passport number — type it yourself. The agent never stores or sends these numbers.");
  if (f.kind === "checkbox" && has(t, /agree|declar|confirm|certify|terms|consent|accurate|true and correct|privacy/))
    return stop("Declaration — read it and tick it yourself.");
  if (has(t, /\b(c?gpa|grade point)\b/))
    return p.gpa ? ok(p.gpa) : stop("GPA isn't on file and is never guessed. Enter it yourself, or reply to the bot with it.");

  if (f.kind === "file") {
    const hit = DOC_FOR_UPLOAD.find(([re]) => re.test(t));
    if (!hit) return you("Upload — check what this field asks for.");
    if (hit[1] === "pack_cv") return you("Upload the tailored CV from your Apply pack.");
    if (hit[1] === "you") return you("Upload — only you can provide this (photo, letter or essay you wrote).");
    const d = hit[1] as DocType;
    return you(storedDocs.includes(d) ? `Upload your ${DOC_TYPES[d]} (✅ in your vault — /docs).` : `Upload your ${DOC_TYPES[d]} (not in your vault yet — send it to the bot).`);
  }

  // Long answers are always yours.
  if (f.kind === "textarea" || has(t, /\b(why|describe|motivation|tell us|statement|essay|explain|goals?|cover letter|about yourself)\b/)) {
    const limit = f.maxLength ? ` Limit: ${f.maxLength} characters.` : "";
    return you(`Write this in your own words (your Apply pack has an outline).${limit}`);
  }

  // Identity & contact.
  if (has(t, /\b(first|given|fore) ?name\b/)) return ok(first);
  if (has(t, /\b(last|family|sur) ?name\b|\bsurname\b/)) return ok(last);
  if (has(t, /\bmiddle name\b/)) return you("Middle name — not in your profile.");
  if (has(t, /\b(full )?name\b/) && !has(t, /(university|school|institution|referee|reference|company|organi[sz]ation|project|parent|guardian)/)) return ok(p.name);
  if (f.kind === "email" || has(t, /e-?mail/)) {
    if (has(t, /referee|reference|recommender/)) return you("Referee's email — choose which referee (see your profile).");
    return ok(c.email);
  }
  if (f.kind === "tel" || has(t, /phone|mobile|tel\b|whatsapp|cell/)) return ok(intlPhone(c.phone));
  if (has(t, /date of birth|birth ?date|\bdob\b|birthday/)) {
    if (!p.date_of_birth) return you("Date of birth not on file.");
    const [y, m, d] = p.date_of_birth.split("-");
    return ok(f.kind === "date" ? p.date_of_birth : `${d}/${m}/${y}`, "From your profile (DD/MM/YYYY — check the format the form wants).");
  }
  if (has(t, /\b(age)\b/) && p.date_of_birth) {
    const dob = new Date(p.date_of_birth);
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    if (now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate())) age--;
    return ok(String(age));
  }
  if (has(t, /gender|\bsex\b|pronoun|marital|religion|disabilit|ethnic/)) return you("Personal question — answer it yourself.");
  if (has(t, /nationality|citizenship/)) return ok(pickOption(f.options, p.nationality) ?? (f.options ? undefined : p.nationality));
  if (has(t, /country/)) return ok(pickOption(f.options, p.country_of_residence) ?? (f.options ? undefined : p.country_of_residence));
  if (has(t, /\bcity|town|address|county|postal|zip\b/)) return you("Address/city — not in your profile.");
  if (has(t, /passport/) && (f.kind === "radio" || f.kind === "select" || has(t, /do you (have|hold)/)))
    return p.passport === null || p.passport === undefined ? you("Passport status not on file.") : ok(pickOption(f.options, p.passport ? "Yes" : "No"));

  // Education.
  if (has(t, /high school|secondary/)) return ok(school?.institution);
  if (has(t, /kcse|mean grade/)) return ok(school?.grade ?? null);
  if (has(t, /university|institution|college|school/)) return ok(uni?.institution.replace(/ \(.*\)$/, "") ?? null);
  if (has(t, /degree|programme|program of study|course|major|field of study|discipline/)) return ok(uni?.qualification ?? null);
  if (has(t, /year of study|current year|study year|class year|\blevel\b/))
    return ok(uni?.year_of_study ? (pickOption(f.options, String(uni.year_of_study)) ?? (f.options ? undefined : `Year ${uni.year_of_study}`)) : null);
  if (has(t, /graduat/)) return ok(uni?.expected_graduation ? String(uni.expected_graduation) : null);

  // Profiles & skills.
  if (has(t, /github/)) return ok(c.github ?? (p.github ? `https://github.com/${p.github}` : null));
  if (has(t, /portfolio|website|personal (site|page)/)) return ok(c.github ?? null, "Your GitHub profile (your projects are private repos — consider a public demo).");
  if (has(t, /linkedin|twitter|instagram|facebook/)) return you("Not in your profile.");
  if (has(t, /programming|technical skills|tech stack|languages you (use|know)/)) return ok([...(ts.languages ?? []), ...(ts.frameworks ?? [])].join(", ") || null);
  if (has(t, /language/)) return ok(p.languages.join(", "));
  if (has(t, /skills?/)) return ok([...(ts.languages ?? []), ...(ts.frameworks ?? [])].join(", ") || p.skills.join(", "));
  if (has(t, /hours|availability|start date|when can you start/))
    return p.weekly_hours_available ? ok(String(p.weekly_hours_available)) : you("Availability isn't in your profile yet.");
  if (has(t, /referee|reference|recommender/)) return you(`Referee — you have: ${p.referees.map((r) => r.name).join(", ") || "none on file"}.`);
  if (has(t, /how did you hear|where did you (hear|find)|referral/)) return you("Answer yourself.");

  return you("Not in your profile — fill this yourself.");
}

export function answerSheet(fields: FormField[], p: Profile, storedDocs: DocType[] = []): Answer[] {
  return fields.map((f) => answerField(f, p, storedDocs));
}
