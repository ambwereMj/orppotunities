/** Your preferences (20 Nov 2026), tested on items you actually tapped. */
import { describe, expect, it } from "vitest";
import { applyPreferences, yearsRequired } from "../src/pipeline/preferences.js";
import { prefilter } from "../src/pipeline/prefilter.js";
import type { Funding, OppType } from "../src/types.js";
import { ev, extracted, lead } from "./helpers.js";

const el = () => ({ verdict: "check" as const, reasons: [] as string[] });
const judge = (type: OppType, title: string, opts: { funding?: Funding; fields?: string[]; summary?: string; page?: string } = {}) =>
  applyPreferences(
    lead({ type, title, summary: opts.summary }),
    extracted({ title, funding: ev<Funding>(opts.funding ?? "unknown", opts.funding && opts.funding !== "unknown" ? "q" : null), fields: ev(opts.fields ?? [], opts.fields?.length ? "q" : null) }),
    el(),
    opts.page ?? "",
  );

describe("scholarships: fully funded + electrical/computer engineering only", () => {
  it("drops partial awards (NL Scholarship €5,000, Padua, NUS Commonwealth)", () => {
    expect(judge("scholarship", "NL Scholarship (formerly Holland Scholarship) at Erasmus University", { funding: "partial" }).drop).toBe("not fully funded");
    expect(judge("scholarship", "Padua International Excellence Scholarships", { funding: "partial" }).drop).toBe("not fully funded");
  });
  it("drops scholarships whose funding isn't stated as full", () => {
    expect(judge("scholarship", "University of Waikato Vice-Chancellor's International Excellence Scholarship").drop).toBe("funding not stated as full");
  });
  it("keeps a listed-as-fully-funded one, with a note to confirm", () => {
    const r = judge("scholarship", "Mastercard Foundation Scholars Program 2027 (Fully Funded) in Engineering");
    expect(r.drop).toBeNull();
    expect(r.notes.join(" ")).toContain("confirm");
  });
  it("keeps confirmed full funding and boosts engineering", () => {
    const r = judge("scholarship", "HKUST Future Leaders Award for International Students", { funding: "full", fields: ["engineering", "computer science"] });
    expect(r.drop).toBeNull();
    expect(r.boost).toBeGreaterThan(0);
  });
  it("drops business/management and other fields", () => {
    expect(judge("scholarship", "Oxford Saïd Future Leaders Scholarships 2027 (MBA)", { funding: "full" }).drop).toContain("business");
    expect(judge("scholarship", "Law Excellence Scholarship", { funding: "full", fields: ["law"] }).drop).toContain("field not related");
  });
  it("all-fields scholarships stay", () => {
    expect(judge("scholarship", "Commonwealth Scholarship", { funding: "full", fields: ["all fields"] }).drop).toBeNull();
  });
});

describe("jobs: anything within reach", () => {
  it("keeps developer and non-tech roles you could do", () => {
    expect(judge("remote_work", "Front End Developer", { funding: "paid" }).drop).toBeNull();
    expect(judge("remote_work", "Customer Support Specialist", { funding: "paid" }).drop).toBeNull();
  });
  it("drops AI-training work you said no to", () => {
    expect(judge("remote_work", "AI Trainer", { funding: "paid" }).drop).toContain("AI-training");
    expect(judge("remote_work", "Software Engineer AI Coding Tasks", { funding: "paid" }).drop).toContain("AI-training");
    expect(judge("remote_work", "Software Engineer AI Tooling", { funding: "paid" }).drop).toBeNull();
    expect(prefilter(lead({ type: "remote_work", title: "AI Trainer", location: "Worldwide" })).keep).toBe(false);
  });
  it("drops senior roles and 3+ years experience; notes 1–2 years", () => {
    expect(judge("remote_work", "Senior Backend Engineer", { funding: "paid" }).drop).toBe("senior role");
    expect(judge("remote_work", "Backend Engineer", { funding: "paid", page: "Requirements: 5+ years of professional experience with Go." }).drop).toContain("5+ years");
    const r = judge("remote_work", "Backend Engineer", { funding: "paid", page: "At least 2 years of experience preferred." });
    expect(r.drop).toBeNull();
    expect(r.notes[0]).toContain("2 year");
  });
  it("reads experience requirements", () => {
    expect(yearsRequired("3-5 years of relevant work experience")).toBe(3);
    expect(yearsRequired("We have 10 years of history.")).toBeNull();
  });
});

describe("live run 20 Nov: jobs that slipped through", () => {
  it.each([
    ["Customer Success Engineer, Singapore", "based in Singapore"],
    ["Analista de Testes e QA Júnior", "not in English"],
    ["Legal Engineering Counsel", "licence"],
    ["Expert Talent Pool Physical AI", "AI-training"],
  ])("%s", (title, why) => expect(judge("remote_work", title, { funding: "paid" }).drop).toContain(why));
  it("location limited to another country", () => {
    const r = applyPreferences(lead({ type: "remote_work", title: "Partner Marketing Specialist", location: "Spain" }), extracted({ title: "Partner Marketing Specialist", funding: ev<Funding>("paid", "q") }), el());
    expect(r.drop).toContain("Spain");
  });
  it("Kenya / worldwide / Africa stay", () => {
    for (const loc of ["Worldwide", "Kenya", "Africa", "EMEA", "unspecified"]) {
      expect(applyPreferences(lead({ type: "remote_work", title: "Support Engineer", location: loc }), extracted({ title: "Support Engineer", funding: ev<Funding>("paid", "q") }), el()).drop).toBeNull();
    }
  });
});

describe("other opportunities: travel or growth, never bootcamps/online courses", () => {
  it("drops bootcamps and online courses", () => {
    expect(judge("skills", "The Microsoft Datacenter Academy Skilling Bootcamp for Africans").drop).toContain("bootcamp");
    expect(judge("program", "Free Online Course in Cloud Computing").drop).toContain("online course");
    expect(prefilter(lead({ aggregator: true, type: "skills", title: "ALX Software Engineering Bootcamp" })).keep).toBe(false);
  });
  it("keeps programmes that build you", () => {
    expect(judge("program", "The Global Citizen Prize: Cisco Youth Leadership Award 2027").drop).toBeNull();
    expect(judge("program", "QNX Global Hackathon (hackathon)").drop).toBeNull();
  });
  it("boosts programmes that fund travel", () => {
    const r = judge("program", "Youth Tech Summit 2027", { page: "Flights and accommodation are fully covered for selected delegates attending in person in Geneva." });
    expect(r.drop).toBeNull();
    expect(r.notes).toContain("Funds travel.");
  });
  it("drops things that neither fund travel nor build you", () => {
    expect(judge("program", "Webinar: Introduction to Climate Policy").drop).toContain("travel or build");
  });
  it("drops unpaid training (skills) programmes", () => {
    expect(judge("skills", "Digital Skills Programme").drop).toContain("without pay");
  });
});

describe("round-ups are not single opportunities", () => {
  it.each(["Top 5+ Training Scholarships for International Students", "12 new and updated scholarships: 16 November 2026"])("%s", (title) =>
    expect(prefilter(lead({ aggregator: true, title })).keep).toBe(false),
  );
});
