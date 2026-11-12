import { describe, expect, it } from "vitest";
import { renderPage, trackerLink, verifyLink, applyUpdate } from "../src/web/tracker.js";
import { summary } from "../src/cv/build-cv.js";
import type { OppRow, Store } from "../src/db/store.js";
import { extracted, profile } from "./helpers.js";

const TOKEN = "123:test-token";

describe("tracker private link", () => {
  const now = Date.UTC(2026, 10, 12);
  const link = new URL(trackerLink("https://example.vercel.app", now, TOKEN));
  const exp = link.searchParams.get("exp");
  const sig = link.searchParams.get("sig");

  it("accepts its own link", () => expect(verifyLink(exp, sig, now, TOKEN)).toBe(true));
  it("expires after 7 days", () => expect(verifyLink(exp, sig, now + 8 * 86_400_000, TOKEN)).toBe(false));
  it("rejects a changed expiry (can't extend the link)", () => expect(verifyLink(String(Number(exp) + 86400 * 365), sig, now, TOKEN)).toBe(false));
  it("rejects a forged signature", () => expect(verifyLink(exp, "0".repeat(40), now, TOKEN)).toBe(false));
  it("rejects links signed with another bot token", () => expect(verifyLink(exp, sig, now, "999:other")).toBe(false));
  it("rejects missing parameters", () => expect(verifyLink(undefined, undefined, now, TOKEN)).toBe(false));
});

const row = (over: Partial<OppRow> = {}): OppRow =>
  ({
    key: "k1",
    type: "scholarship",
    title: "Test <script>alert(1)</script> Scholarship",
    provider: "Org",
    official_url: "https://org.example/s",
    source_ids: ["x"],
    deadline: null,
    deadline_quote: null,
    funding: "full",
    score: 70,
    score_reason: "r",
    verdict: "eligible",
    flagged: false,
    extracted: extracted(),
    eligibility: { verdict: "eligible", reasons: [] },
    scam: { flagged: false, reject: false, reasons: [] },
    payout: null,
    status: "saved",
    blocking: null,
    notes: null,
    first_seen: "",
    digested_at: null,
    alerted_at: null,
    ...over,
  }) as OppRow;

describe("tracker page", () => {
  it("escapes titles (no HTML injection from scraped pages)", () => {
    const html = renderPage([row()], "exp=1&sig=a");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("groups by status and shows 'deadline unknown – check'", () => {
    const html = renderPage([row(), row({ key: "k2", status: "found", title: "New one" })], "q");
    expect(html.indexOf("Saved")).toBeLessThan(html.indexOf("New (not decided yet)"));
    expect(html).toContain("deadline unknown – check");
  });
  it("rejects unknown statuses on update", async () => {
    const store = { get: async () => row(), setStatus: async () => {}, addFeedback: async () => {} } as unknown as Store;
    expect(await applyUpdate(store, { key: "k1", status: "hacked" })).toBe("Nothing changed.");
    expect(await applyUpdate(store, { key: "k1", status: "submitted", notes: "sent 12 Nov" })).toContain("Submitted");
  });
});

describe("CV summary uses only profile facts", () => {
  it("states nothing that is not in the profile", () => {
    const s = summary({ ...profile, skills: [], projects: [], technical_skills: {}, education: [] });
    expect(s).toBe(".");
  });
  it("mentions enrollment truthfully when present", () => {
    const s = summary({
      ...profile,
      education: [{ level: "undergraduate", qualification: "BSc X", institution: "Uni (U)", current: true, year_of_study: 3, expected_graduation: 2029 }],
    });
    expect(s).toContain("Year 3 BSc X student at Uni (expected graduation 2029)");
  });
});
