/** Regression tests from the first live run (12 Nov 2026). */
import { describe, expect, it } from "vitest";
import { inferType, prefilter, roundRobin } from "../src/pipeline/prefilter.js";
import { parsePage, parseRss } from "../src/sources/parsers.js";
import { checkEligibility } from "../src/pipeline/eligibility.js";
import { applyPreferences } from "../src/pipeline/preferences.js";
import { extractWithRules, looksLikeOpportunity } from "../src/pipeline/extract-rules.js";
import { NOW, ev, extracted, lead, profile } from "./helpers.js";
import type { SourceConfig } from "../src/types.js";

const agg: SourceConfig = { id: "ofa", kind: "rss", url: "https://x.example/feed", type: "scholarship", aggregator: true, enabled: true };

describe("aggregator items get the right type", () => {
  it.each([
    ["Coca-Cola Beverages Africa (CCBA) Kenya Internship Programme 2026/2027 for young Kenyan students", "internship"],
    ["Commonwealth Shared Scholarships 2027 (Fully Funded)", "scholarship"],
    ["Google Summer of Code 2027", "program"],
    ["ALX Software Engineering Bootcamp", "skills"],
  ])("%s -> %s", (title, type) => expect(inferType(title, "scholarship")).toBe(type));

  it("the CCBA internship is no longer thrown away", () => {
    const xml = `<rss><channel><item><title>Coca-Cola Beverages Africa (CCBA) Kenya Internship Programme 2026/2027 for young Kenyan students</title><link>https://x.example/ccba</link></item></channel></rss>`;
    const [l] = parseRss(xml, agg);
    expect(l.type).toBe("internship");
    expect(prefilter(l).keep).toBe(true);
  });

  it("scholarships are kept even when the title names no field", () => {
    expect(prefilter(lead({ aggregator: true, title: "Commonwealth Shared Scholarships 2027" })).keep).toBe(true);
  });
  it("…but clearly other-field ones are dropped", () => {
    expect(prefilter(lead({ aggregator: true, title: "Africa Dyslexia Teacher Fellowship Program 2027", type: "program" })).keep).toBe(false);
    expect(prefilter(lead({ aggregator: true, title: "Law School Scholarship 2027" })).keep).toBe(false);
  });
});

describe("watched pages ignore navigation", () => {
  const html = `<html><body>
    <nav><a href="/scholarships">Scholarships programme overview page</a></nav>
    <main>
      <a href="/find">Find your network</a>
      <a href="/q">Quality standards</a>
      <a href="/guidance">Application guidance</a>
      <a href="/archive">Scholarships Archive - Commission</a>
      <a href="/s/shared">Commonwealth Shared Scholarships 2027</a>
      <a href="/s/rise">RISE Germany summer research internship</a>
      <a href="/doc.pdf">Scholarship application form</a>
    </main></body></html>`;
  const leads = parsePage(html, "https://site.example/", { id: "w", kind: "page", url: "https://site.example/", type: "scholarship", match: ["scholarship", "internship", "rise"], enabled: true });
  it("keeps only specific opportunities", () => {
    expect(leads.map((l) => l.title)).toEqual(["Commonwealth Shared Scholarships 2027", "RISE Germany summer research internship"]);
  });
});

describe("general info pages are not opportunities", () => {
  const generic = "Why choose us? Our scholarship covers tuition. Applicants from many countries apply every year. Eligibility criteria vary.";
  it("rejects 'Why …' / 'Criteria …' titles", () => {
    expect(looksLikeOpportunity(generic, "Why Türkiye Scholarships?")).toBe(false);
    expect(looksLikeOpportunity(generic, "Criteria & Scholarship Programs")).toBe(false);
  });
  it("needs an apply cue", () => {
    expect(looksLikeOpportunity("Deadline 1 March 2027. Stipend provided. Eligibility: students.", "X Scholarship")).toBe(false);
  });
});

describe("eligibility from real cases", () => {
  it("Chevening ASEAN / SIDS are for other regions", () => {
    expect(checkEligibility(extracted({ title: "Chevening ASEAN Scholarships", eligibleNationalities: ev("unknown") }), lead(), profile, NOW).verdict).toBe("ineligible");
    expect(checkEligibility(extracted({ title: "Chevening SIDS Scholarships", eligibleNationalities: ev("unknown") }), lead(), profile, NOW).verdict).toBe("ineligible");
  });
  it("Commonwealth Shared needs a completed first degree", () => {
    const page = "Applicants must, by September 2027, hold a first degree of at least upper second class honours. Apply online. Deadline: 8 December 2026. Tuition and stipend are covered.";
    const x = extractWithRules(page, "https://cscuk.example/shared", lead({ title: "Commonwealth Shared Scholarships" }), NOW)!;
    const r = checkEligibility(x, lead(), profile, NOW);
    expect(r.verdict).toBe("ineligible");
    expect(r.reasons.join(" ")).toContain("completed bachelor");
  });
  it("Africa-wide programmes are still fine", () => {
    expect(checkEligibility(extracted({ title: "Mastercard Foundation Scholars Program", eligibleNationalities: ev("African countries", "q") }), lead(), profile, NOW).verdict).toBe("eligible");
  });
  it("single-nationality schemes (NNPC: 'Be a Nigerian student') are excluded", () => {
    const r = checkEligibility(extracted({ eligibleNationalities: ev("Eligibility requirements Be a Nigerian student registered for full-time undergraduate study", "q") }), lead(), profile, NOW);
    expect(r.verdict).toBe("ineligible");
  });
  it("'citizens of countries other than Australia' is open to Kenyans", () => {
    const r = checkEligibility(extracted({ eligibleNationalities: ev("Citizens of countries other than Australia or New Zealand", "q") }), lead(), profile, NOW);
    expect(r.verdict).not.toBe("ineligible");
  });
  it("jobs needing a qualification you don't have are dropped (your preferences, 20 Nov)", () => {
    for (const title of ["Accountant", "Patient Care Specialist I", "Telehealth Endocrinologist"]) {
      const l = lead({ type: "remote_work", title, location: "Worldwide" });
      expect(applyPreferences(l, extracted({ title, funding: ev<"paid">("paid", "q") }), { verdict: "check", reasons: [] }).drop, title).toBeTruthy();
    }
    const ok = lead({ type: "remote_work", title: "Junior React Developer", location: "Worldwide" });
    expect(applyPreferences(ok, extracted({ title: ok.title, funding: ev<"paid">("paid", "q") }), { verdict: "check", reasons: [] }).drop).toBeNull();
  });
  it("live run 3: 'for young Nigerians' and non-tech 'Web3 Business Development'", () => {
    expect(checkEligibility(extracted({ title: "The AltBank Sultan of Sales Graduate Trainee Programme 2026 for young Nigerians" }), lead(), profile, NOW).verdict).toBe("ineligible");
    // Since 20 Nov you're flexible on jobs: non-tech roles within reach are kept.
    expect(prefilter(lead({ type: "remote_work", title: "Web3 Business Development", location: "Worldwide" })).keep).toBe(true);
    expect(prefilter(lead({ type: "remote_work", title: "Software Engineer", location: "Worldwide" })).keep).toBe(true);
  });
  it("live run 4: journalist/health fellowships dropped, AI ones kept", () => {
    for (const title of ["The RSF Berlin Fellowship 2027 for journalists", "Person-Centred Care Global Advocacy Academy for healthcare workers", "Research Prize on Child Development"]) {
      expect(prefilter(lead({ aggregator: true, title, type: "program" })).keep).toBe(false);
    }
    expect(prefilter(lead({ aggregator: true, title: "Artificial Intelligence Fellowship 2027", type: "program" })).keep).toBe(true);
    expect(prefilter(lead({ aggregator: true, title: "Digital Health Hackathon for software developers", type: "program" })).keep).toBe(true);
  });
  it("live run 5: geo-locked job titles, round-ups, language study, care academy", () => {
    const drop = [
      lead({ type: "remote_work", title: "SimpleTiger: Web Developer: WordPress & HubSpot (U.S. Based, Remote)", location: "unspecified" }),
      lead({ type: "remote_work", title: "OfferUp: Software Development Engineer II (Remote @ Colombia)", location: "unspecified" }),
      lead({ aggregator: true, title: "20 Scholarships, Grants, Fellowships and Other Opportunities Currently Open" }),
      lead({ aggregator: true, title: "Malek Sghiri Scholarship 2027 to Study Arabic in Tunisia" }),
      lead({ aggregator: true, type: "skills", title: "IAS Person-Centred Care Global Advocacy Academy 2027 (Funded)" }),
    ];
    for (const l of drop) expect(prefilter(l).keep, l.title).toBe(false);
    expect(prefilter(lead({ type: "remote_work", title: "P2P Node.js Engineer - Holepunch (100% Remote, Worldwide)", location: "Worldwide" })).keep).toBe(true);
    expect(prefilter(lead({ type: "program", title: "QNX Global Hackathon (hackathon)", location: "Online" })).keep).toBe(true);
  });
  it("for-other-nationals titles are excluded", () => {
    expect(checkEligibility(extracted({ title: "Scholarship for Nigerian students 2027" }), lead(), profile, NOW).verdict).toBe("ineligible");
  });
});

describe("round-robin selection", () => {
  it("shares the run across sources", () => {
    const leads = [
      ...Array.from({ length: 50 }, (_, i) => ({ sourceId: "pages", i })),
      ...Array.from({ length: 50 }, (_, i) => ({ sourceId: "remoteok", i })),
    ];
    const out = roundRobin(leads, 12, 20);
    expect(out.filter((l) => l.sourceId === "remoteok")).toHaveLength(10);
    expect(out.filter((l) => l.sourceId === "pages")).toHaveLength(10);
  });
});
