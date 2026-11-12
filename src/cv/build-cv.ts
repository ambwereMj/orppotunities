/**
 * Builds a CV (.docx) from profile.yaml ONLY — no facts are invented here.
 * Output goes to vault/ (git-ignored). Phase 3 reuses this to make tailored versions.
 *   npm run cv            -> vault/CV.docx (+ PDF if LibreOffice is installed)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  LevelFormat,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
} from "docx";
import { loadProfile, type Profile } from "../lib/config.js";

const FONT = "Arial";
const ACCENT = "1F3A5F";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})/);
  return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : s;
}

const heading = (text: string) =>
  new Paragraph({
    spacing: { before: 220, after: 80 },
    keepNext: true,
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 2 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 22, color: ACCENT, font: FONT })],
  });

/** Bold left text with right-aligned dates on the same line (right tab stop at the text edge). */
const RIGHT_EDGE = 11906 - 1000 - 1000;
const titleLine = (left: string, right: string) =>
  new Paragraph({
    spacing: { before: 100, after: 20 },
    keepNext: true,
    tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_EDGE }],
    children: [
      new TextRun({ text: left, bold: true, size: 21, font: FONT }),
      ...(right ? [new TextRun({ text: `\t${right}`, size: 19, color: "555555", font: FONT })] : []),
    ],
  });

const line = (text: string, opts: { italic?: boolean; after?: number } = {}) =>
  new Paragraph({ spacing: { after: opts.after ?? 20 }, children: [new TextRun({ text, size: 20, italics: opts.italic, font: FONT })] });

const bullet = (text: string) =>
  new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 30 }, children: [new TextRun({ text, size: 20, font: FONT })] });

const labelled = (label: string, value: string) =>
  new Paragraph({
    spacing: { after: 40 },
    children: [new TextRun({ text: `${label}: `, bold: true, size: 20, font: FONT }), new TextRun({ text: value, size: 20, font: FONT })],
  });

export function summary(p: Profile): string {
  const uni = p.education.find((e) => e.current);
  const year = uni?.year_of_study ? `Year ${uni.year_of_study} ` : "";
  const grad = uni?.expected_graduation ? ` (expected graduation ${uni.expected_graduation})` : "";
  const ts = p.technical_skills ?? {};
  const has = (x: string) => [...(ts.languages ?? []), ...(ts.frameworks ?? [])].includes(x);
  const stacks = [
    has("Python") && has("Django") ? "Python/Django" : null,
    has("JavaScript") && has("React") ? `JavaScript/React${has("Next.js") ? "/Next.js" : ""}` : null,
  ].filter(Boolean);
  const moringa = p.education.find((e) => /moringa/i.test(e.institution));
  const parts = [
    uni ? `${year}${uni.qualification} student at ${uni.institution.replace(/ \(.*\)$/, "")}${grad}` : null,
    moringa ? `with software engineering training from ${moringa.institution}` : null,
  ].filter(Boolean);
  let s = parts.join(" ") + ".";
  if (stacks.length) s += ` Builds full-stack web applications with ${stacks.join(" and ")}.`;
  if ((p.projects as { name: string }[]).some((x) => /luxe condos/i.test(x.name))) {
    s += " Built and runs the booking catalogue for my own short-stay rental business.";
  }
  if (p.skills.some((x) => /microcontroller/i.test(x))) s += " Also experienced in microcontroller programming.";
  return s;
}

interface Project {
  name: string;
  repo?: string;
  summary?: string;
  details?: string[];
}

export function buildCv(p: Profile): Document {
  const c = p.contact ?? {};
  const contactBits: (TextRun | ExternalHyperlink)[] = [];
  const sep = () => new TextRun({ text: "   |   ", size: 19, color: "888888", font: FONT });
  for (const [i, v] of [c.phone, c.email, c.location].filter(Boolean).entries()) {
    if (i) contactBits.push(sep());
    contactBits.push(new TextRun({ text: v!, size: 19, font: FONT }));
  }
  if (c.github) {
    contactBits.push(sep());
    contactBits.push(new ExternalHyperlink({ link: c.github, children: [new TextRun({ text: c.github.replace(/^https?:\/\//, ""), size: 19, style: "Hyperlink", font: FONT })] }));
  }

  const children: Paragraph[] = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: p.name.toUpperCase(), bold: true, size: 36, color: ACCENT, font: FONT })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: contactBits }),
    heading("Profile"),
    line(summary(p), { after: 60 }),
  ];

  // Education: current first, then most recent.
  children.push(heading("Education"));
  const order = [...p.education].sort((a, b) => Number(!!b.current) - Number(!!a.current) || String(b.start ?? "").localeCompare(String(a.start ?? "")));
  for (const e of order) {
    const end = e.current ? "Present" : fmtDate(e.end);
    const qual = /^kcse$/i.test(e.qualification) ? "Kenya Certificate of Secondary Education (KCSE)" : e.qualification;
    children.push(titleLine(qual, [fmtDate(e.start), end].filter(Boolean).join(" – ")));
    children.push(line(e.institution, { italic: true }));
    const notes = [
      e.grade ? `Grade: ${e.grade}` : null,
      e.current && e.year_of_study ? `Year ${e.year_of_study} of study` : null,
      e.current && e.expected_graduation ? `Expected graduation: ${e.expected_graduation}` : null,
    ].filter(Boolean);
    if (notes.length) children.push(line(notes.join("  ·  ")));
  }

  // Technical skills
  const ts = p.technical_skills ?? {};
  children.push(heading("Technical Skills"));
  if (ts.languages?.length) children.push(labelled("Languages", ts.languages.join(", ")));
  if (ts.frameworks?.length) children.push(labelled("Frameworks", ts.frameworks.join(", ")));
  if (ts.tools?.length) children.push(labelled("Tools & platforms", ts.tools.join(", ")));
  const hw = p.skills.filter((s) => /microcontroller|embedded|hardware/i.test(s));
  if (hw.length) children.push(labelled("Hardware", hw.map((s) => s[0].toUpperCase() + s.slice(1)).join(", ")));

  // Projects
  const projects = p.projects as Project[];
  if (projects.length) {
    children.push(heading("Projects"));
    for (const pr of projects) {
      children.push(titleLine(pr.name, ""));
      if (pr.summary) children.push(line(pr.summary.trim()));
      for (const d of pr.details ?? []) children.push(bullet(d));
    }
    children.push(line("Source code for these projects is private; available to review on request.", { italic: true, after: 40 }));
  }

  // Other skills & languages
  const soft = p.skills.filter((s) => !/development|microcontroller|literacy/i.test(s));
  children.push(heading("Additional"));
  children.push(labelled("Spoken languages", p.languages.join(", ")));
  if (soft.length) children.push(labelled("Strengths", soft.map((s) => s[0].toUpperCase() + s.slice(1)).join(", ")));

  // Referees
  if (p.referees.length) {
    children.push(heading("Referees"));
    for (const r of p.referees) {
      children.push(new Paragraph({ spacing: { before: 60, after: 0 }, keepNext: true, children: [new TextRun({ text: r.name, bold: true, size: 20, font: FONT })] }));
      children.push(line([r.occupation, r.email, r.phone].filter(Boolean).join("  ·  ")));
    }
  }

  return new Document({
    creator: p.name,
    title: `${p.name} — CV`,
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }],
        },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } },
        children,
      },
    ],
  });
}

async function main() {
  const p = loadProfile();
  mkdirSync("vault", { recursive: true });
  const out = process.argv[2] ?? "vault/CV.docx";
  writeFileSync(out, await Packer.toBuffer(buildCv(p)));
  console.log(`wrote ${out}`);
  try {
    execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", out.replace(/\/[^/]+$/, ""), out], { stdio: "ignore" });
    console.log(`wrote ${out.replace(/\.docx$/, ".pdf")}`);
  } catch {
    console.log("PDF skipped (LibreOffice not installed)");
  }
}

if (process.argv[1]?.endsWith("build-cv.ts")) main();
