import { describe, expect, it } from "vitest";
import { dedupeLeads, normalizeUrl, titleFingerprint } from "../src/pipeline/dedupe.js";
import { geoLockedLocation, prefilter } from "../src/pipeline/prefilter.js";
import { checkEligibility } from "../src/pipeline/eligibility.js";
import { quoteOnPage, verifyEvidence, type RawExtract } from "../src/pipeline/extract.js";
import { NOW, ev, extracted, lead, profile } from "./helpers.js";

describe("dedupe", () => {
  it("normalizes tracking params, www and trailing slash", () => {
    expect(normalizeUrl("http://www.Example.org/a/?utm_source=x&b=2#frag")).toBe("https://example.org/a?b=2");
  });
  it("ignores years and filler words in fingerprints", () => {
    expect(titleFingerprint("DAAD Scholarship 2027 for Engineering")).toBe(titleFingerprint("DAAD Engineering Scholarships 2026"));
  });
  it("merges the same opportunity from two aggregators, preferring the official lead", () => {
    const out = dedupeLeads([
      lead({ aggregator: true, title: "Fully Funded MEXT Japan Undergraduate Engineering Scholarship 2027", url: "https://a.example/1" }),
      lead({ aggregator: false, title: "MEXT Japan Undergraduate Engineering Scholarship", url: "https://embassy.example/mext" }),
      lead({ aggregator: true, title: "Erasmus Mundus Robotics Masters", url: "https://b.example/2" }),
    ]);
    expect(out.map((l) => l.url)).toEqual(["https://embassy.example/mext", "https://b.example/2"]);
  });
});

describe("prefilter", () => {
  it("drops non-tech scholarships", () => {
    expect(prefilter(lead({ title: "Poetry Writing Fellowship", aggregator: true })).keep).toBe(false);
  });
  it("keeps engineering scholarships", () => {
    expect(prefilter(lead({ title: "Fully Funded Computer Engineering Scholarship", aggregator: true })).keep).toBe(true);
  });
  it("drops senior and US-only remote roles, keeps worldwide junior roles", () => {
    expect(prefilter(lead({ type: "remote_work", title: "Senior React Developer", location: "Worldwide" })).keep).toBe(false);
    expect(prefilter(lead({ type: "remote_work", title: "React Developer", location: "US only" })).keep).toBe(false);
    expect(prefilter(lead({ type: "remote_work", title: "React Developer", location: "Worldwide" })).keep).toBe(true);
  });
  it("geo-lock detection", () => {
    expect(geoLockedLocation("USA")).toBe(true);
    expect(geoLockedLocation("USA, Canada")).toBe(true);
    expect(geoLockedLocation("USA, Africa")).toBe(false);
    expect(geoLockedLocation("Worldwide")).toBe(false);
    expect(geoLockedLocation(undefined)).toBe(false);
  });
  it("always keeps links from watched official pages", () => {
    expect(prefilter(lead({ title: "Apply here", watched: true })).keep).toBe(true);
  });
});

describe("evidence verification (no invented facts)", () => {
  const page = "Applications close on 15 December 2026. Open to applicants from all countries. The award covers tuition and a monthly stipend of EUR 934.";
  const raw = {
    is_opportunity: true,
    title: "T",
    provider: "P",
    deadline: { value: "2026-12-15", quote: "Applications close on 15 December 2026" },
    eligible_nationalities: { value: "worldwide", quote: "Open to applicants from all countries" },
    study_levels: { value: ["undergraduate"], quote: "undergraduate students only" }, // NOT on page
    fields: { value: [], quote: null },
    enrollment_rule: { value: null, quote: null },
    age_limit: { value: 30, quote: "age 30" }, // NOT on page
    grade_requirement: { value: null, quote: null },
    gpa_mandatory: { value: null, quote: null },
    language_requirement: { value: null, quote: null },
    funding: { value: "full", quote: "covers tuition and a monthly   stipend" }, // whitespace differs
    funding_details: { value: null, quote: null },
    pay: { value: null, quote: null },
    payment_methods: { value: [], quote: null },
    application_fee: { value: null, quote: null },
    how_to_apply: { value: null, quote: null },
    contact_emails: ["fake@scam.example"],
    remote: null,
  } satisfies RawExtract;

  const x = verifyEvidence(raw, page, "https://example.org");
  it("keeps facts whose quote is on the page", () => {
    expect(x.deadline.value).toBe("2026-12-15");
    expect(x.funding.value).toBe("full");
  });
  it("drops facts whose quote is not on the page", () => {
    expect(x.studyLevels.value).toEqual([]);
    expect(x.ageLimit.value).toBeNull();
    expect(x.contactEmails).toEqual([]);
  });
  it("rejects malformed deadlines even with a valid quote", () => {
    const y = verifyEvidence({ ...raw, deadline: { value: "December 2026", quote: "Applications close on 15 December 2026" } }, page, "u");
    expect(y.deadline.value).toBeNull();
  });
  it("quote matching is whitespace/case/dash tolerant but not fuzzy", () => {
    expect(quoteOnPage("OPEN TO  applicants", page)).toBe(true);
    expect(quoteOnPage("open to applicants from Kenya", page)).toBe(false);
    expect(quoteOnPage(null, page)).toBe(false);
  });
});

describe("eligibility", () => {
  it("eligible: worldwide undergraduate engineering", () => {
    expect(checkEligibility(extracted(), lead(), profile, NOW).verdict).toBe("eligible");
  });
  it("ineligible: US citizens only", () => {
    const r = checkEligibility(extracted({ eligibleNationalities: ev("US citizens only", "q") }), lead(), profile, NOW);
    expect(r.verdict).toBe("ineligible");
  });
  it("check: nationality not stated", () => {
    expect(checkEligibility(extracted({ eligibleNationalities: ev("unknown") }), lead(), profile, NOW).verdict).toBe("check");
  });
  it("ineligible: expired", () => {
    const r = checkEligibility(extracted({ deadline: ev<string | null>("2026-11-01", "q") }), lead(), profile, NOW);
    expect(r.verdict).toBe("ineligible");
    expect(r.reasons[0]).toContain("expired");
  });
  it("ineligible: bars current university students (truthful about JKUAT enrollment)", () => {
    const r = checkEligibility(extracted({ enrollmentRule: ev<string | null>("Applicants must not be currently enrolled in a university degree", "q") }), lead(), profile, NOW);
    expect(r.verdict).toBe("ineligible");
  });
  it("check: first-year/new entrants only", () => {
    const r = checkEligibility(extracted({ enrollmentRule: ev<string | null>("Open to first-year students admitted in 2026", "q") }), lead(), profile, NOW);
    expect(r.verdict).toBe("check");
  });
  it("Master's-only scholarships are saved for later, not shown now", () => {
    const r = checkEligibility(extracted({ studyLevels: ev(["masters"], "q") }), lead(), profile, NOW);
    expect(r.verdict).toBe("ineligible");
    expect(r.reasons[0]).toContain("later");
  });
  it("field mismatch", () => {
    expect(checkEligibility(extracted({ fields: ev(["law", "medicine"], "q") }), lead(), profile, NOW).verdict).toBe("ineligible");
  });
  it("age limit without a date of birth -> check, never guessed", () => {
    const r = checkEligibility(extracted({ ageLimit: ev<number | null>(25, "q") }), lead(), profile, NOW);
    expect(r.verdict).toBe("check");
  });
  it("age limit with DOB over limit -> ineligible", () => {
    const r = checkEligibility(extracted({ ageLimit: ev<number | null>(25, "q") }), lead(), { ...profile, date_of_birth: "1990-01-01" }, NOW);
    expect(r.verdict).toBe("ineligible");
  });
  it("mandatory GPA -> check (will pause and ask)", () => {
    const r = checkEligibility(extracted({ gpaMandatory: ev<boolean | null>(true, "q") }), lead({ type: "internship" }), profile, NOW);
    expect(r.verdict).toBe("check");
  });
  it("non-English language requirement -> check", () => {
    const r = checkEligibility(extracted({ languageRequirement: ev<string | null>("German B2 required", "q") }), lead(), profile, NOW);
    expect(r.verdict).toBe("check");
  });
  it("remote job geo-locked to the US -> ineligible", () => {
    const r = checkEligibility(extracted({ funding: ev<"paid">("paid", "q") }), lead({ type: "remote_work", location: "USA" }), profile, NOW);
    expect(r.verdict).toBe("ineligible");
  });
});
