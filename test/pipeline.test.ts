import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { profile } from "./helpers.js";

const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");

const OFFICIAL_PAGE = `<html><body><main>
<h1>DAAD RISE Germany 2027</h1>
<p>RISE Germany offers summer research internships in Germany for undergraduate students from North America, the UK and Ireland.</p>
<p>The application deadline is 15 December 2026. Scholarship holders receive a monthly stipend to help cover costs for food and accommodation.</p>
<p>Fields: biology, chemistry, physics, earth sciences, engineering. Apply online through the RISE portal with a letter of recommendation.</p>
${"<p>More details about the programme and the host universities.</p>".repeat(5)}
</main></body></html>`;

let parsed: Record<string, unknown>;

vi.mock("../src/lib/ai.js", async (orig) => {
  const real = await orig<typeof import("../src/lib/ai.js")>();
  return {
    ...real,
    ai: () => ({
      messages: {
        parse: async () => ({ stop_reason: "end_turn", usage: { input_tokens: 5000, output_tokens: 600 }, parsed_output: parsed }),
      },
    }),
  };
});

beforeEach(() => {
  process.env.HTTP_MIN_GAP_MS = "0";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string) => {
      const u = String(url);
      if (u.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /private", { status: 200 });
      if (u.includes("aggregator.example")) return new Response(fx("aggregator-article.html"), { status: 200 });
      if (u.includes("daad.de")) return new Response(OFFICIAL_PAGE, { status: 200 });
      return new Response("not found", { status: 404 });
    }),
  );
  parsed = {
    is_opportunity: true,
    title: "DAAD RISE Germany 2027",
    provider: "DAAD",
    deadline: { value: "2026-12-15", quote: "The application deadline is 15 December 2026" },
    eligible_nationalities: { value: "North America, UK and Ireland only", quote: "undergraduate students from North America, the UK and Ireland" },
    study_levels: { value: ["undergraduate"], quote: "undergraduate students" },
    fields: { value: ["engineering", "physics"], quote: "Fields: biology, chemistry, physics, earth sciences, engineering" },
    enrollment_rule: { value: null, quote: null },
    age_limit: { value: null, quote: null },
    grade_requirement: { value: null, quote: null },
    gpa_mandatory: { value: null, quote: null },
    language_requirement: { value: null, quote: null },
    funding: { value: "partial", quote: "monthly stipend to help cover costs for food and accommodation" },
    funding_details: { value: "monthly stipend", quote: "monthly stipend" },
    pay: { value: null, quote: null },
    payment_methods: { value: [], quote: null },
    application_fee: { value: null, quote: null },
    how_to_apply: { value: "Apply online through the RISE portal", quote: "Apply online through the RISE portal" },
    contact_emails: [],
    remote: null,
  };
});
afterEach(() => vi.unstubAllGlobals());

describe("processLead end-to-end (network & AI faked)", () => {
  it("resolves aggregator -> official page, verifies facts, rejects region-locked item", async () => {
    const { processLead } = await import("../src/pipeline/process.js");
    const { Budget } = await import("../src/lib/ai.js");
    const budget = new Budget(0, 10);
    const out = await processLead(
      { sourceId: "agg", type: "scholarship", title: "DAAD RISE 2027", url: "https://aggregator.example/daad-rise-2027/", aggregator: true },
      profile,
      budget,
      {},
    );
    expect(out.kind).toBe("stored");
    if (out.kind !== "stored") return;
    expect(out.opp.extracted.officialUrl).toBe("https://www.daad.de/rise/en/rise-germany/");
    expect(out.opp.extracted.deadline.value).toBe("2026-12-15");
    expect(out.opp.eligibility.verdict).toBe("ineligible"); // North America/UK only — correctly excluded
    expect(out.opp.extracted.funding.value).toBe("partial"); // never shown as full
    expect(budget.spentRun).toBeCloseTo(0.0008, 5);
  });

  it("stops spending once the monthly cap is reached", async () => {
    const { processLead } = await import("../src/pipeline/process.js");
    const { Budget, BudgetExceeded } = await import("../src/lib/ai.js");
    await expect(
      processLead({ sourceId: "x", type: "scholarship", title: "t", url: "https://www.daad.de/x", aggregator: false }, profile, new Budget(10, 10), {}),
    ).rejects.toBeInstanceOf(BudgetExceeded);
  });

  it("respects robots.txt", async () => {
    const { processLead } = await import("../src/pipeline/process.js");
    const { Budget } = await import("../src/lib/ai.js");
    const out = await processLead({ sourceId: "x", type: "scholarship", title: "t", url: "https://www.daad.de/private/page", aggregator: false }, profile, new Budget(0), {});
    expect(out).toEqual({ kind: "error", reason: "robots.txt disallows" });
  });
});
