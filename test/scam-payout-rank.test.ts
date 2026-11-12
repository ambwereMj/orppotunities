import { describe, expect, it } from "vitest";
import { scamCheck } from "../src/pipeline/scam.js";
import { payoutRoute } from "../src/pipeline/payout.js";
import { rank } from "../src/pipeline/rank.js";
import { NOW, ev, extracted, lead } from "./helpers.js";

describe("scam filter", () => {
  const clean = "The scholarship covers tuition and a monthly stipend. Apply through the online portal.";
  it("passes a clean page", () => {
    expect(scamCheck(clean, extracted(), "https://daad.de/x")).toEqual({ flagged: false, reject: false, reasons: [] });
  });
  it.each([
    ["Successful candidates must pay a processing fee of KSh 3,500 to secure the slot.", "fee"],
    ["Send your M-Pesa PIN for verification.", "PIN"],
    ["A registration fee of $50 is required.", "registration"],
    ["Pay an upfront payment to start training.", "upfront"],
    ["We accept bitcoin deposit for the starter kit.", "payment mechanism"],
  ])("rejects: %s", (text, why) => {
    const r = scamCheck(text, extracted(), "https://jobs.example.com/x");
    expect(r.reject).toBe(true);
    expect(r.reasons.join(" ").toLowerCase()).toContain(why.toLowerCase().split(" ")[0]);
  });
  it.each([
    "100% guaranteed admission to top universities!",
    "Earn $500 per day from home typing.",
    "Contact our recruiter on WhatsApp to proceed.",
    "Submit your passport copy before you apply so we can reserve your seat.",
  ])("flags (shown with warning): %s", (text) => {
    const r = scamCheck(text, extracted(), "https://x.example/");
    expect(r.flagged).toBe(true);
  });
  it("flags free-mail contact addresses", () => {
    const r = scamCheck(clean, extracted({ contactEmails: ["scholarships.office@gmail.com"] }), "https://x.example");
    expect(r.flagged).toBe(true);
    expect(r.reasons[0]).toContain("unofficial email");
  });
  it("application fee on a university domain is flagged, elsewhere rejected", () => {
    const x = extracted({ applicationFee: ev<string | null>("USD 50 application fee", "q") });
    expect(scamCheck(clean, x, "https://admissions.uni.ac.uk/apply").reject).toBe(false);
    expect(scamCheck(clean, x, "https://admissions.uni.ac.uk/apply").flagged).toBe(true);
    expect(scamCheck(clean, x, "https://free-scholarships.example.com").reject).toBe(true);
  });
  it("'no application fee' is not a fee", () => {
    expect(scamCheck(clean, extracted({ applicationFee: ev<string | null>("No application fee", "q") }), "https://x.com").flagged).toBe(false);
  });
});

describe("payout routing", () => {
  it("prefers direct M-Pesa", () => expect(payoutRoute(["M-Pesa", "PayPal"]).route).toBe("Direct to M-Pesa"));
  it("PayPal -> M-Pesa", () => expect(payoutRoute(["PayPal"]).route).toContain("PayPal"));
  it("bank wire -> KCB", () => expect(payoutRoute(["bank transfer"]).route).toContain("KCB"));
  it("flags Payoneer-only", () => {
    const r = payoutRoute(["Payoneer"]);
    expect(r.route).toBeNull();
    expect(r.needsNewMethod).toEqual(["Payoneer"]);
  });
  it("notes unknown method", () => expect(payoutRoute([]).note).toContain("not stated"));
  it("mentions alternatives when a working route exists", () => expect(payoutRoute(["PayPal", "Wise"]).note).toContain("Wise"));
});

describe("ranking", () => {
  const ok = { verdict: "eligible" as const, reasons: [] };
  it("scores within 0–100 with a reason", () => {
    const s = rank(lead(), extracted(), ok, null, {}, NOW);
    expect(s.score).toBeGreaterThan(0);
    expect(s.score).toBeLessThanOrEqual(100);
    expect(s.reason).toContain("fully funded");
  });
  it("full funding beats partial", () => {
    const full = rank(lead(), extracted(), ok, null, {}, NOW).score;
    const partial = rank(lead(), extracted({ funding: ev<"partial">("partial", "q") }), ok, null, {}, NOW).score;
    expect(full).toBeGreaterThan(partial);
  });
  it("urgent deadlines score higher", () => {
    const soon = rank(lead(), extracted({ deadline: ev<string | null>("2026-11-15", "q") }), ok, null, {}, NOW);
    const later = rank(lead(), extracted({ deadline: ev<string | null>("2027-06-01", "q") }), ok, null, {}, NOW);
    expect(soon.score).toBeGreaterThan(later.score);
    expect(soon.reason).toMatch(/deadline in \d+d/);
  });
  it("'check' items rank below eligible ones", () => {
    const a = rank(lead(), extracted(), ok, null, {}, NOW).score;
    const b = rank(lead(), extracted(), { verdict: "check", reasons: ["x"] }, null, {}, NOW).score;
    expect(a).toBeGreaterThan(b);
  });
  it("feedback weights shift the score, capped at ±15", () => {
    const base = rank(lead(), extracted(), ok, null, {}, NOW).score;
    const liked = rank(lead(), extracted(), ok, null, { "type:scholarship": 10, "provider:test org": 10 }, NOW).score;
    expect(liked - base).toBeLessThanOrEqual(15);
    expect(liked).toBeGreaterThan(base);
  });
});
