import type { Profile } from "../lib/config.js";
import { sentences } from "../pipeline/extract-rules.js";

/**
 * Requirements checklist built from the official page text. Every item keeps the sentence it came from.
 * Status per item: "ready" (we have it), "draft" (we prepare a draft you must finish),
 * "you" (only you can provide it), "missing" (needs info you haven't given — application pauses).
 */
export type ItemStatus = "ready" | "draft" | "you" | "missing";
export interface ChecklistItem {
  id: string;
  label: string;
  status: ItemStatus;
  note: string;
  quote: string | null;
}

const DOCS: { id: string; re: RegExp; label: string }[] = [
  { id: "cv", re: /\b(cv|curriculum vitae|r[ée]sum[ée])\b/i, label: "CV / résumé" },
  { id: "cover_letter", re: /\b(cover letter|motivation letter|letter of motivation|statement of purpose|personal statement|letter of intent)\b/i, label: "Motivation / cover letter" },
  { id: "essay", re: /\b(essays?|short answers?|written responses?|research proposal|study plan)\b/i, label: "Essay / written answers" },
  { id: "recommendation", re: /\b(recommendation|reference) letters?|letters? of (recommendation|reference)|referees?\b/i, label: "Recommendation letters" },
  { id: "transcript", re: /\b(transcripts?|academic records?|mark ?sheets?|grade reports?)\b/i, label: "Academic transcript" },
  { id: "certificates", re: /\b(certificates?|diplomas?|kcse|high school (certificate|results)|secondary school (certificate|results))\b/i, label: "Certificates (KCSE, Moringa, ICDL)" },
  { id: "passport", re: /\b(passport|national id|identity (card|document))\b/i, label: "Passport / ID copy" },
  { id: "language_test", re: /\b(ielts|toefl|duolingo|pte academic|language certificate|proof of english)\b/i, label: "English test / proof of English" },
  { id: "portfolio", re: /\b(portfolio|github|code samples?|work samples?)\b/i, label: "Portfolio / code samples" },
  { id: "admission", re: /\b(admission letter|letter of admission|offer letter|acceptance letter|proof of (admission|enrolment|enrollment))\b/i, label: "Admission / enrolment letter" },
  { id: "gpa", re: /\b(c?gpa|grade point average)\b/i, label: "GPA" },
  { id: "video", re: /\b(video (essay|introduction|statement)|record a video)\b/i, label: "Video" },
  { id: "fee", re: /\b(application|processing|registration) fee\b/i, label: "Application fee" },
];

const REQUIRE_CUE = /\b(submit|upload|attach|provide|include|required|must|need|should send|documents?|application (package|materials))\b/i;

/** Which documents the page asks for, with the sentence each came from. */
export function findRequirements(pageText: string): { id: string; label: string; quote: string }[] {
  const out = new Map<string, { id: string; label: string; quote: string }>();
  for (const s of sentences(pageText)) {
    if (!REQUIRE_CUE.test(s)) continue;
    for (const d of DOCS) if (!out.has(d.id) && d.re.test(s)) out.set(d.id, { id: d.id, label: d.label, quote: s.slice(0, 300) });
  }
  // A CV is needed for practically every application, even when the page doesn't say so.
  if (!out.has("cv")) out.set("cv", { id: "cv", label: "CV / résumé", quote: "" });
  return [...out.values()];
}

/** Count of referees asked for, if stated ("two letters of recommendation"). */
export function refereesNeeded(pageText: string): number | null {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, "1": 1, "2": 2, "3": 3, "4": 4 };
  const m = pageText.match(
    /\b(one|two|three|four|[1-4])\s+(?:\w+\s+)?(?:(?:recommendation|reference)\s+letters?|letters?\s+of\s+(?:recommendation|reference)|(?:academic\s+|professional\s+)?referees?)\b/i,
  );
  if (!m) return null;
  return words[m[1].toLowerCase()] ?? null;
}

const isAcademic = (occ = "") => /lecturer|professor|instructor|teacher|dr\.?\b|tutor|dean|head of department/i.test(occ);

export function buildChecklist(pageText: string, p: Profile, opts: { gpaMandatory?: boolean | null } = {}): ChecklistItem[] {
  const docs = (p as { documents?: string[] }).documents ?? [];
  const has = (d: string) => docs.includes(d);
  return findRequirements(pageText).map(({ id, label, quote }): ChecklistItem => {
    const q = quote || null;
    switch (id) {
      case "cv":
        return { id, label, status: "ready", note: "Tailored CV attached — check every line.", quote: q };
      case "cover_letter":
      case "essay":
        return { id, label, status: "draft", note: "Outline attached with your real facts. Write the personal parts in your own words — many programmes reject AI-written essays.", quote: q };
      case "recommendation": {
        const need = refereesNeeded(pageText);
        const academic = p.referees.filter((r) => isAcademic(r.occupation)).length;
        const note =
          `${need ? `Needs ${need}. ` : ""}You have ${p.referees.length} referee(s), ${academic} academic.` +
          (academic === 0 ? " Most programmes want at least one academic referee — ask a JKUAT lecturer or Moringa instructor." : "") +
          " Request emails below are drafts: nothing is sent until you tap and send them yourself.";
        return { id, label, status: need !== null && p.referees.length < need ? "missing" : "draft", note, quote: q };
      }
      case "gpa":
        return p.gpa
          ? { id, label, status: "ready", note: `GPA on file: ${p.gpa}`, quote: q }
          : opts.gpaMandatory === false
            ? { id, label, status: "ready", note: "Optional — skipped (no GPA on file).", quote: q }
            : { id, label, status: "missing", note: "Your GPA isn't on file and is never guessed. Reply to this message with it if you want to continue.", quote: q };
      case "passport":
        return { id, label, status: "you", note: p.passport ? "You have a passport — upload the scan yourself. Its number is never sent to any AI." : "Passport status unknown.", quote: q };
      case "transcript":
        if (!has("transcript") && (p as { documents_unavailable?: string[] }).documents_unavailable?.includes("transcript")) {
          return {
            id,
            label,
            status: "you",
            note: `You don't have a JKUAT transcript yet. Ask JKUAT's Academic Affairs office (or the student portal) for an official or provisional one${has("kcse_results") ? "; where secondary results are accepted, your KCSE result slip is in your vault" : ""}.`,
            quote: q,
          };
        }
        return {
          id,
          label,
          status: has("transcript") ? "ready" : "you",
          note: has("transcript")
            ? "In your vault."
            : `Get your JKUAT transcript (Academic office / student portal).${has("kcse_results") ? " Where secondary results are accepted, your KCSE result slip is in your vault." : ""}`,
          quote: q,
        };
      case "certificates":
        return {
          id,
          label,
          status: has("certificates") ? "ready" : "you",
          note: has("certificates")
            ? `In your vault (KCSE certificate, Moringa, ICDL${has("kcse_results") ? ", KCSE result slip" : ""}).`
            : "Scan your KCSE certificate and result slip, Moringa and ICDL certificates, and send them to the bot.",
          quote: q,
        };
      case "portfolio":
        return { id, label, status: "draft", note: "Your projects (Applaude, Luxe Condos) are private repos — make a public demo/screenshots or a public repo before linking.", quote: q };
      case "fee":
        return { id, label, status: "you", note: "This page mentions a fee. Never pay anyone except the official institution, and only if you choose to.", quote: q };
      default:
        return { id, label, status: "you", note: "Only you can provide this.", quote: q };
    }
  });
}

const ICON: Record<ItemStatus, string> = { ready: "✅", draft: "📝", you: "👤", missing: "⛔" };
export function checklistText(items: ChecklistItem[], esc: (s: string) => string): string {
  return items.map((i) => `${ICON[i.status]} <b>${esc(i.label)}</b> — ${esc(i.note)}`).join("\n");
}
