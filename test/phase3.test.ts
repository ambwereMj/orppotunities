import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildChecklist, findRequirements, refereesNeeded } from "../src/apply/requirements.js";
import { tailorProfile } from "../src/apply/tailor.js";
import { letterOutlineBuffer, refereeRequests } from "../src/apply/letter.js";
import { NO_BOTS, preparePack } from "../src/apply/pack.js";
import type { OppRow } from "../src/db/store.js";
import type { Profile } from "../src/lib/config.js";
import { extracted, profile } from "./helpers.js";

const prof: Profile = {
  ...profile,
  name: "Test Person",
  contact: { email: "me@example.com", phone: "0700 000 000" },
  technical_skills: { languages: ["Python", "C", "JavaScript"], frameworks: ["React", "Django", "Flask"] },
  projects: [
    { name: "Alpha", summary: "A booking site", details: ["Next.js frontend", "Supabase database"] },
    { name: "Beta", summary: "Website tester", details: ["Django API with PostgreSQL", "Playwright checks"] },
  ],
  referees: [
    { name: "Ann Lee", occupation: "Accountant", email: "ann@example.com" },
    { name: "Bob Kim", occupation: "Engineer", email: "bob@example.com" },
  ],
};

const row = (over: Partial<OppRow> = {}): OppRow =>
  ({
    key: "k",
    type: "scholarship",
    title: "Engineering Scholarship 2027",
    provider: "Uni",
    official_url: "https://uni.example.edu/s",
    deadline: "2027-01-31",
    extracted: extracted(),
    eligibility: { verdict: "eligible", reasons: [] },
    verdict: "eligible",
    ...over,
  }) as OppRow;

const page = `To apply, upload the following documents: your CV, a motivation letter of up to 800 words, and two letters of recommendation.
Applicants must also submit an academic transcript. A minimum CGPA of 3.0 is required. Copy of passport required.
We look for Python and Django experience; knowledge of PostgreSQL is an advantage.`;

describe("requirements checklist", () => {
  it("finds required documents with the sentence they came from", () => {
    const ids = findRequirements(page).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["cv", "cover_letter", "recommendation", "transcript", "gpa", "passport"]));
    expect(findRequirements(page).find((r) => r.id === "transcript")!.quote).toContain("academic transcript");
  });
  it("reads the number of referees", () => {
    expect(refereesNeeded(page)).toBe(2);
    expect(refereesNeeded("Three reference letters are needed")).toBe(3);
    expect(refereesNeeded("Send your CV.")).toBeNull();
  });
  it("never invents a GPA: missing GPA pauses the application", () => {
    const gpa = buildChecklist(page, prof).find((i) => i.id === "gpa")!;
    expect(gpa.status).toBe("missing");
  });
  it("optional GPA is skipped, not asked", () => {
    expect(buildChecklist(page, prof, { gpaMandatory: false }).find((i) => i.id === "gpa")!.status).toBe("ready");
  });
  it("uses a GPA you gave", () => {
    expect(buildChecklist(page, { ...prof, gpa: "3.4/4" }).find((i) => i.id === "gpa")!.note).toContain("3.4/4");
  });
  it("blocks on referees only when there are too few", () => {
    expect(buildChecklist(page, prof).find((i) => i.id === "recommendation")!.status).toBe("draft");
    expect(buildChecklist("Submit three letters of recommendation.", prof).find((i) => i.id === "recommendation")!.status).toBe("missing");
  });
  it("flags missing academic referee in the note", () => {
    expect(buildChecklist(page, prof).find((i) => i.id === "recommendation")!.note).toContain("academic");
  });
  it("passport: you upload it, number never sent to AI", () => {
    const pp = buildChecklist(page, { ...prof, passport: true }).find((i) => i.id === "passport")!;
    expect(pp.status).toBe("you");
    expect(pp.note).toContain("never sent to any AI");
  });
});

describe("tailoring re-orders only", () => {
  const t = tailorProfile(prof, page);
  it("puts matching skills and projects first", () => {
    expect(t.technical_skills!.languages[0]).toBe("Python");
    expect(t.technical_skills!.frameworks[0]).toBe("Django");
    expect((t.projects as { name: string }[])[0].name).toBe("Beta");
  });
  it("adds nothing and drops nothing", () => {
    expect([...t.technical_skills!.frameworks].sort()).toEqual([...prof.technical_skills!.frameworks].sort());
    expect(t.projects).toHaveLength(prof.projects.length);
    const allDetails = (p: Profile) => (p.projects as { details: string[] }[]).flatMap((x) => x.details).sort();
    expect(allDetails(t)).toEqual(allDetails(prof));
  });
});

async function docxText(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  return (await zip.file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, " ");
}

describe("letter outline", () => {
  it("is an outline with your-own-words prompts, using only real facts", async () => {
    const text = await docxText(await letterOutlineBuffer(prof, row()));
    expect(text).toContain("OUTLINE");
    expect(text).toContain("WRITE IN YOUR OWN WORDS");
    expect(text).toContain("Engineering Scholarship 2027");
    expect(text).toContain("Alpha");
    expect(text).not.toMatch(/passionate since childhood|dream|always wanted/i);
  });
});

describe("referee requests", () => {
  it("are mailto drafts you send yourself", () => {
    const r = refereeRequests(prof, row());
    expect(r).toHaveLength(2);
    expect(r[0].href.startsWith("mailto:ann@example.com?subject=")).toBe(true);
    expect(decodeURIComponent(r[0].href)).toContain("The deadline is 2027-01-31");
    expect(decodeURIComponent(r[0].href)).toContain("Dear Ann,");
  });
});

describe("pack", () => {
  const fetchOk = async () => ({ status: 200, url: "https://uni.example.edu/s", text: `<main><p>${page}</p></main>` });
  it("builds checklist, tailored CV and letter outline", async () => {
    const pack = await preparePack(row(), prof, fetchOk);
    expect(pack.pageFetched).toBe(true);
    expect(pack.files.map((f) => f.name)).toEqual(["Test_Person_CV_Engineering_Scholarship_2027.docx", "Letter_outline_Engineering_Scholarship_2027.docx"]);
    expect(await docxText(pack.files[0].data)).toContain("Beta");
    expect(pack.closed).toBeNull();
  });
  it("notices when the call has closed", async () => {
    const closed = async () => ({ status: 200, url: "u", text: "<main>Applications are closed for this round. Apply next year.</main>" });
    expect((await preparePack(row(), prof, closed)).closed).toMatch(/closed/i);
  });
  it("still works when the page can't be opened", async () => {
    const fail = async () => {
      throw new Error("offline");
    };
    const pack = await preparePack(row(), prof, fail);
    expect(pack.pageFetched).toBe(false);
    expect(pack.files).toHaveLength(2);
  });
  it("never automates bot-forbidding platforms", () => {
    for (const h of ["www.linkedin.com", "upwork.com", "wellfound.com"]) expect(NO_BOTS.test(h)).toBe(true);
    expect(NO_BOTS.test("daad.de")).toBe(false);
  });
});
