import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { answerField, answerSheet, intlPhone, pickOption, type FormField } from "../src/forms/answers.js";
import { chunk, sheetText } from "../src/jobs/forms.js";
import { profile } from "./helpers.js";
import type { Profile } from "../src/lib/config.js";

const prof: Profile = {
  ...profile,
  name: "Test Person",
  date_of_birth: "2004-07-15",
  passport: true,
  languages: ["English", "Kiswahili"],
  contact: { email: "me@example.com", phone: "0712 345 678", github: "https://github.com/test" },
  education: [
    { level: "secondary", qualification: "KCSE", institution: "Example High", grade: "B+" },
    { level: "undergraduate", qualification: "BSc Electronics & Computer Engineering", institution: "Example University (EU)", current: true, year_of_study: 3, expected_graduation: 2029 },
  ],
  technical_skills: { languages: ["Python", "C"], frameworks: ["React", "Django"] },
};

const f = (label: string, kind: FormField["kind"] = "text", extra: Partial<FormField> = {}): FormField => ({ kind, label, ...extra });

describe("answer rules", () => {
  it("fills identity and contact from the profile", () => {
    expect(answerField(f("First name"), prof).value).toBe("Test");
    expect(answerField(f("Surname"), prof).value).toBe("Person");
    expect(answerField(f("Email", "email"), prof).value).toBe("me@example.com");
    expect(answerField(f("Mobile", "tel"), prof).value).toBe("+254 712 345 678");
    expect(answerField(f("Date of birth", "date"), prof).value).toBe("2004-07-15");
    expect(answerField(f("Date of birth"), prof).value).toBe("15/07/2004");
  });
  it("picks matching select options and leaves unmatched ones to you", () => {
    expect(answerField(f("Nationality", "select", { options: ["Select…", "Kenyan", "Nigerian"] }), prof).value).toBe("Kenyan");
    expect(answerField(f("Country of citizenship", "select", { options: ["USA", "Canada"] }), prof).status).toBe("you");
    expect(answerField(f("Year of study", "select", { options: ["1", "2", "3"] }), prof).value).toBe("3");
  });
  it("education from the profile, truthfully", () => {
    expect(answerField(f("University"), prof).value).toBe("Example University");
    expect(answerField(f("Degree programme"), prof).value).toBe("BSc Electronics & Computer Engineering");
    expect(answerField(f("Expected graduation year"), prof).value).toBe("2029");
  });
  it("checkpoints are never filled", () => {
    expect(answerField(f("Cumulative GPA"), prof).status).toBe("stop"); // never guessed
    expect(answerField(f("Passport number"), prof).status).toBe("stop");
    expect(answerField(f("I declare the information is true", "checkbox"), prof).status).toBe("stop");
    expect(answerField(f("Password", "password"), prof).status).toBe("stop");
    expect(answerField(f("Card number"), prof).status).toBe("stop");
  });
  it("essays and personal questions are yours", () => {
    expect(answerField(f("Why this programme?", "textarea", { maxLength: 2000 }), prof).note).toContain("2000");
    expect(answerField(f("Gender", "radio", { options: ["Female", "Male"] }), prof).status).toBe("you");
  });
  it("uploads point to the vault", () => {
    expect(answerField(f("Upload transcript", "file"), prof, ["transcript"]).note).toContain("✅ in your vault");
    expect(answerField(f("Upload transcript", "file"), prof, []).note).toContain("not in your vault");
    expect(answerField(f("Upload your CV", "file"), prof).note).toContain("tailored CV");
  });
  it("helpers", () => {
    expect(intlPhone("0798 765 432")).toBe("+254 798 765 432");
    expect(pickOption(["Yes", "No"], "Yes")).toBe("Yes");
  });
  it("answer sheet splits into Telegram-sized messages and escapes text", () => {
    const answers = answerSheet([f("First name <b>"), f("GPA")], prof);
    const msgs = chunk(sheetText("T & Co", "https://x.example/f", answers, { login: true, captcha: false }));
    expect(msgs.join("\n")).toContain("&lt;b&gt;");
    expect(msgs.join("\n")).toContain("Final submit");
    expect(msgs.join("\n")).toContain("Login");
    const long = chunk(Array.from({ length: 300 }, (_, i) => `line ${i} ${"x".repeat(40)}`));
    expect(long.every((m) => m.length <= 3800)).toBe(true);
  });
});

const hasBrowser = existsSync("/opt/pw-browsers") || !!process.env.PLAYWRIGHT_BROWSERS_PATH;
describe.skipIf(!hasBrowser)("real browser: reads a form and fills a preview without submitting", () => {
  it("reads fields, answers them, fills safe ones, never submits", async () => {
    const { readForm, fillPreview, withBrowser, screenshot } = await import("../src/forms/reader.js");
    const url = "file://" + fileURLToPath(new URL("./fixtures/apply-form.html", import.meta.url));
    await withBrowser(async (browser) => {
      const { read, page } = await readForm(browser, url, { checkRobots: false });
      const labels = read.fields.map((x) => x.label);
      expect(labels).toEqual(expect.arrayContaining(["First name", "Email address", "Nationality", "Cumulative GPA", "Gender"]));
      expect(read.login).toBe(false);
      const answers = answerSheet(read.fields, prof, ["transcript"]);
      const filled = await fillPreview(page, answers);
      expect(filled).toBeGreaterThanOrEqual(8);
      expect(await page.inputValue('[name="first_name"]')).toBe("Test");
      expect(await page.inputValue('[name="nationality"]')).toBe("Kenyan");
      expect(await page.inputValue('[name="gpa"]')).toBe(""); // never guessed
      expect(await page.inputValue('[name="passport_no"]')).toBe(""); // never filled
      expect(await page.isChecked('[name="decl"]')).toBe(false); // declarations are yours
      expect(page.url()).toBe(url); // nothing submitted
      expect((await screenshot(page)).length).toBeGreaterThan(5000);
    });
  }, 60_000);
});
