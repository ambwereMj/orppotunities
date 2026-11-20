import { AlignmentType, Document, LevelFormat, Packer, Paragraph, TextRun } from "docx";
import type { Profile } from "../lib/config.js";
import type { OppRow } from "../db/store.js";
import { summary } from "../cv/build-cv.js";

/**
 * Motivation / cover letter OUTLINE — not a finished letter. Facts come only from the profile and
 * the opportunity page; every personal part is a clearly marked prompt for you to write yourself.
 * (Many scholarships disqualify AI-written or plagiarised essays.)
 */
const FONT = "Arial";
const p = (text: string, opts: { bold?: boolean; italic?: boolean; color?: string; after?: number } = {}) =>
  new Paragraph({ spacing: { after: opts.after ?? 120 }, children: [new TextRun({ text, bold: opts.bold, italics: opts.italic, color: opts.color, size: 22, font: FONT })] });
const prompt = (text: string) => p(`[WRITE IN YOUR OWN WORDS: ${text}]`, { italic: true, color: "B3261E" });
const bullet = (text: string) => new Paragraph({ numbering: { reference: "b", level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text, size: 22, font: FONT })] });

export function letterOutline(prof: Profile, row: OppRow): Document {
  const kind = row.type === "remote_work" || row.type === "internship" ? "cover letter" : "motivation letter";
  const projects = prof.projects as { name: string; summary?: string }[];
  const c = prof.contact ?? {};
  const facts = [
    summary(prof),
    ...projects.map((pr) => `${pr.name}: ${(pr.summary ?? "").trim()}`),
    prof.technical_skills?.languages?.length ? `Languages I use: ${prof.technical_skills.languages.join(", ")}.` : "",
    prof.languages.length ? `Spoken languages: ${prof.languages.join(", ")}.` : "",
  ].filter(Boolean);

  const children = [
    p(`OUTLINE — ${kind} for: ${row.title}`, { bold: true, after: 60 }),
    p(`${row.provider ?? ""} · ${row.official_url}`, { italic: true, color: "555555" }),
    p(
      "How to use: keep the structure, delete these notes, and write every red part yourself. Only use the facts listed below — add anything else only if it is true.",
      { italic: true, color: "555555", after: 240 },
    ),
    p(prof.name, { bold: true, after: 0 }),
    p([c.email, c.phone].filter(Boolean).join(" · "), { after: 240 }),
    p("Dear Selection Committee,"),
    p(`I am applying for ${row.title}${row.provider ? ` (${row.provider})` : ""}.`, { after: 60 }),
    prompt("one or two sentences on why THIS opportunity, mentioning something specific from its page"),
    p("Who I am (facts you can use):", { bold: true, after: 60 }),
    ...facts.map(bullet),
    prompt("pick ONE project above and describe a problem you solved, what you did, and what you learned"),
    prompt("how this opportunity connects to your goals in electronics / computer engineering and to Kenya"),
    ...(row.type === "scholarship"
      ? [prompt("your financial need / why funding matters (only if the programme asks), in your own words")]
      : [prompt("when you can start and how many hours you can commit (you haven't told me this yet)")]),
    p("Thank you for considering my application.", { after: 60 }),
    p("Sincerely,", { after: 0 }),
    p(prof.name),
  ];

  return new Document({
    creator: prof.name,
    title: `Outline – ${row.title}`,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    numbering: { config: [{ reference: "b", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }] },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children }],
  });
}

export async function letterOutlineBuffer(prof: Profile, row: OppRow): Promise<Buffer> {
  return Packer.toBuffer(letterOutline(prof, row));
}

/** Draft referee request for this opportunity, as a mailto: link you tap and send yourself. */
export function refereeRequests(prof: Profile, row: OppRow): { name: string; href: string }[] {
  const deadline = row.deadline ? ` The deadline is ${row.deadline}.` : "";
  return prof.referees
    .filter((r) => r.email)
    .map((r) => {
      const first = r.name.split(/\s+/)[0];
      const subject = `Reference request – ${row.title}`;
      const body =
        `Dear ${first},\n\n` +
        `I hope you are well. I am applying for ${row.title}${row.provider ? ` (${row.provider})` : ""} and would be grateful if you could be one of my referees.${deadline}\n\n` +
        `Details: ${row.official_url}\n\n` +
        `I can send you my CV and any forms you need. Please let me know if you are able to help.\n\n` +
        `Thank you,\n${prof.name}${prof.contact?.phone ? `\n${prof.contact.phone}` : ""}`;
      return { name: r.name, href: `mailto:${r.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` };
    });
}
