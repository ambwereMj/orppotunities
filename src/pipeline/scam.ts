import type { Extracted, ScamResult } from "../types.js";

/**
 * Scam / risk rules. `reject` = never shown. `flagged` = shown with a ⚠️ and the reasons.
 * Runs on the official page text plus extracted facts.
 */

interface Rule {
  re: RegExp;
  reason: string;
  reject: boolean;
}

const RULES: Rule[] = [
  { re: /\b(m-?pesa|mobile money|atm|bank)\s*pin\b/i, reason: "asks for a PIN", reject: true },
  {
    re: /(pay|send|deposit)\b[^.]{0,40}\b(processing|registration|application|admin(istration)?|visa processing|training|kit|onboarding|placement|activation)\s*fee/i,
    reason: "asks you to pay a fee",
    reject: true,
  },
  {
    re: /(processing|registration|activation|placement|onboarding|training)\s*fee\s*(of|:)?\s*(ksh|kes|usd|\$|€|£)\s*\d/i,
    reason: "charges a processing/registration fee",
    reject: true,
  },
  { re: /(upfront|advance) (payment|fee)|pay (before|to) (start|begin|secure)/i, reason: "asks for upfront payment", reject: true },
  { re: /(100\s*%|guaranteed)\s*(acceptance|admission|approval|visa|placement|job)|guarantee(d)? (you )?(a )?(scholarship|job|admission)/i, reason: "promises guaranteed acceptance", reject: false },
  { re: /no (interview|experience|qualifications?) (needed|required)[^.]{0,60}(\$|usd|ksh)\s?\d{3,}/i, reason: "high pay with no requirements", reject: false },
  { re: /earn (up to )?(\$|usd|ksh|kes)\s?\d[\d,]{2,}\s*(per|a|\/)\s*(day|week)/i, reason: "unrealistic pay claim", reject: false },
  { re: /(send|share|submit|provide)[^.]{0,40}(passport (copy|number)|bank (account )?details|national id (copy|number)|card number)[^.]{0,40}(before|to (apply|register|be considered))/i, reason: "asks for passport/bank details early", reject: false },
  { re: /(contact|message|reach|text|apply)[^.]{0,30}(on|via|through) (whatsapp|telegram|signal|hangouts)|whatsapp (only|us)|interview (will be )?(conducted )?(on|via) (telegram|whatsapp|signal|hangouts)/i, reason: "chat-app-only recruiter", reject: false },
  { re: /(gift card|crypto(currency)? (payment|deposit)|bitcoin deposit|check (deposit|cashing))/i, reason: "unusual payment mechanism", reject: true },
];

const FREE_MAIL = /@(gmail|yahoo|hotmail|outlook|live|aol|proton(mail)?|ymail|mail|gmx|icloud|zoho)\.(com|me|net)$/i;

export function scamCheck(pageText: string, x: Extracted | null, officialUrl: string): ScamResult {
  const reasons: string[] = [];
  let reject = false;
  for (const r of RULES) {
    if (r.re.test(pageText)) {
      reasons.push(r.reason);
      reject ||= r.reject;
    }
  }
  if (x?.applicationFee.value && !/no (application )?fee|free|waived|none/i.test(x.applicationFee.value)) {
    // Fee on an official university/government domain is a flag (normal admission fee); elsewhere reject.
    const host = new URL(officialUrl).hostname;
    const institutional = /\.(edu|ac|gov|go|int)(\.[a-z]{2})?$|\.edu\.[a-z]{2}$/.test(host);
    reasons.push(`application fee: ${x.applicationFee.value}`);
    if (!institutional) reject = true;
  }
  const freeMails = (x?.contactEmails ?? []).filter((e) => FREE_MAIL.test(e));
  if (freeMails.length) reasons.push(`unofficial email domain: ${freeMails.join(", ")}`);
  return { flagged: reasons.length > 0, reject, reasons: [...new Set(reasons)] };
}
