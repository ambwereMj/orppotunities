/** Regression tests from the first live run (12 Nov 2026). */
import { describe, expect, it } from "vitest";
import { inferType, prefilter, roundRobin } from "../src/pipeline/prefilter.js";
import { parsePage, parseRss } from "../src/sources/parsers.js";
import { checkEligibility } from "../src/pipeline/eligibility.js";
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
