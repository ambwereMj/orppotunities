import { describe, expect, it } from "vitest";
import { parseDevpost, parseJobicy, parsePage } from "../src/sources/parsers.js";
import { prefilter } from "../src/pipeline/prefilter.js";
import type { SourceConfig } from "../src/types.js";

const src = (over: Partial<SourceConfig>): SourceConfig => ({ id: "s", kind: "page", url: "https://x.example/", type: "program", enabled: true, ...over });

describe("single-programme pages (self)", () => {
  const html = `<html><head><title>GSoC</title></head><body><h1>Google Summer of Code</h1><a href="/faq">FAQ</a></body></html>`;
  it("the page itself becomes a lead that is re-checked weekly", () => {
    const leads = parsePage(html, "https://summerofcode.withgoogle.com/", src({ self: true, match: ["apply"] }));
    expect(leads[0]).toMatchObject({ title: "Google Summer of Code", url: "https://summerofcode.withgoogle.com/", recheck: true, watched: true });
  });
  it("without self, a page with no opportunity links gives nothing", () => {
    expect(parsePage(html, "https://summerofcode.withgoogle.com/", src({ match: ["apply"] }))).toEqual([]);
  });
});

describe("Devpost", () => {
  const json = JSON.stringify({
    hackathons: [
      { title: "AI for Good", url: "https://ai4good.devpost.com/", open_state: "open", prize_amount: "$<span data-currency-value>10,000</span>", submission_period_dates: "Nov 01 - Dec 15, 2026", themes: [{ name: "Machine Learning/AI" }], displayed_location: { location: "Online" } },
      { title: "Old one", url: "https://old.devpost.com/", open_state: "ended" },
    ],
  });
  const leads = parseDevpost(json, src({ kind: "devpost" }));
  it("keeps open hackathons with prizes and dates", () => {
    expect(leads).toHaveLength(1);
    expect(leads[0].summary).toContain("Prizes: $10,000");
    expect(leads[0].summary).toContain("Dec 15, 2026");
    expect(leads[0].type).toBe("program");
  });
  it("passes the pre-filter", () => expect(prefilter(leads[0]).keep).toBe(true));
});

describe("Jobicy", () => {
  const json = JSON.stringify({
    jobs: [
      { url: "https://jobicy.com/jobs/1", jobTitle: "Junior Python Developer", companyName: "Acme", jobGeo: "Anywhere", jobExcerpt: "Django", annualSalaryMin: 20000, annualSalaryMax: 30000, salaryCurrency: "USD" },
      { url: "https://jobicy.com/jobs/2", jobTitle: "Python Developer", companyName: "B", jobGeo: "USA" },
    ],
  });
  const leads = parseJobicy(json, src({ kind: "jobicy", type: "remote_work" }));
  it("maps location and salary", () => {
    expect(leads[0]).toMatchObject({ location: "Anywhere", salary: "USD 20000–30000/yr", provider: "Acme" });
  });
  it("worldwide kept, US-only dropped", () => {
    expect(prefilter(leads[0]).keep).toBe(true);
    expect(prefilter(leads[1]).keep).toBe(false);
  });
});
