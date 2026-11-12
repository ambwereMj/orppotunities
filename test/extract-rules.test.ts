import { describe, expect, it } from "vitest";
import {
  extractAge,
  extractDeadline,
  extractFee,
  extractFunding,
  extractGpa,
  extractNationality,
  extractPaymentMethods,
  extractWithRules,
  findDates,
  sentences,
} from "../src/pipeline/extract-rules.js";
import { checkEligibility } from "../src/pipeline/eligibility.js";
import { quoteOnPage } from "../src/pipeline/extract.js";
import { NOW, lead, profile } from "./helpers.js";

const S = (t: string) => sentences(t);

describe("dates", () => {
  it.each([
    ["15 December 2026", "2026-12-15"],
    ["15th of December, 2026", "2026-12-15"],
    ["December 15, 2026", "2026-12-15"],
    ["Dec 1st 2026", "2026-12-01"],
    ["2026-12-15", "2026-12-15"],
    ["15/12/2026", "2026-12-15"],
  ])("%s", (s, want) => expect(findDates(s)).toContain(want));
  it("ignores month-only and impossible dates", () => {
    expect(findDates("Applications open in December 2026")).toEqual([]);
    expect(findDates("31 February 2027")).toEqual([]);
  });
});

describe("deadline", () => {
  it("takes the date from a deadline sentence and quotes it", () => {
    const d = extractDeadline(S("The programme starts on 1 September 2027. The application deadline is 15 January 2027. Good luck."), NOW);
    expect(d.value).toBe("2027-01-15");
    expect(d.quote).toBe("The application deadline is 15 January 2027.");
  });
  it("never guesses: no deadline sentence -> unknown", () => {
    expect(extractDeadline(S("The programme starts on 1 September 2027."), NOW).value).toBeNull();
  });
  it("keeps a past deadline so the item is marked expired", () => {
    expect(extractDeadline(S("Deadline: 1 March 2026."), NOW).value).toBe("2026-03-01");
  });
});

describe("eligibility facts", () => {
  it("nationality classes", () => {
    expect(extractNationality(S("The scholarship is open to students from all countries."), lead()).value).toBe("worldwide");
    expect(extractNationality(S("Applicants must be citizens of an African country."), lead()).value).toBe("African countries");
    expect(extractNationality(S("Eligible applicants must be US citizens."), lead()).value).toBe("US only");
    expect(extractNationality(S("Nothing relevant here at all."), lead()).value).toBe("unknown");
  });
  it("falls back to the job board's location, labelled as such", () => {
    const n = extractNationality(S("We build tools."), lead({ type: "remote_work", location: "Worldwide" }));
    expect(n.value).toBe("Worldwide");
    expect(n.quote).toContain("job board");
  });
  it("age limit", () => {
    expect(extractAge(S("Applicants must be under 35 years of age.")).value).toBe(35);
    expect(extractAge(S("Candidates should be 30 years or younger.")).value).toBe(30);
    expect(extractAge(S("We have 25 open positions.")).value).toBeNull();
  });
  it("GPA mandatory vs optional", () => {
    expect(extractGpa(S("A minimum CGPA of 3.0 is required.")).mandatory.value).toBe(true);
    expect(extractGpa(S("Include your GPA (optional).")).mandatory.value).toBe(false);
  });
});

describe("funding — 'full' only when tuition AND living costs are stated", () => {
  it("full", () => {
    const f = extractFunding(S("The scholarship covers full tuition fees. Scholars also receive a monthly stipend of EUR 934."), "scholarship");
    expect(f.funding.value).toBe("full");
  });
  it("tuition only is partial", () => {
    expect(extractFunding(S("The award covers tuition fees only."), "scholarship").funding.value).toBe("partial");
  });
  it("'fully funded' slogan alone is NOT full", () => {
    expect(extractFunding(S("Apply for this fully funded opportunity today!"), "scholarship").funding.value).toBe("unknown");
  });
});

describe("money", () => {
  it("payment methods", () => {
    expect(extractPaymentMethods(S("Payments are made via PayPal or Payoneer every two weeks.")).value).toEqual(["PayPal", "Payoneer"]);
  });
  it("fees", () => {
    expect(extractFee(S("There is no application fee.")).value).toBeNull();
    expect(extractFee(S("A non-refundable application fee of USD 50 applies.")).value).toContain("USD 50");
  });
});

describe("full rule-based extraction", () => {
  const page = `Engineering Excellence Scholarship 2027.
  The scholarship is open to students from all countries.
  It is available for undergraduate students in engineering and computer science.
  The scholarship covers full tuition fees. Scholars receive a monthly stipend and a return flight.
  The application deadline is 31 January 2027.
  To apply, submit your application through the online portal with two reference letters.
  Questions: scholarships@uni.example.edu`;

  const x = extractWithRules(page, "https://uni.example.edu/scholarship", lead())!;
  it("extracts the key facts", () => {
    expect(x.deadline.value).toBe("2027-01-31");
    expect(x.eligibleNationalities.value).toBe("worldwide");
    expect(x.studyLevels.value).toContain("undergraduate");
    expect(x.funding.value).toBe("full");
    expect(x.howToApply.value).toContain("online portal");
    expect(x.contactEmails).toEqual(["scholarships@uni.example.edu"]);
  });
  it("every quote is literally on the page", () => {
    for (const f of [x.deadline, x.eligibleNationalities, x.studyLevels, x.fundingDetails, x.howToApply]) {
      expect(quoteOnPage(f.quote, page)).toBe(true);
    }
  });
  it("is judged eligible", () => {
    expect(checkEligibility(x, lead(), profile, NOW).verdict).toBe("eligible");
  });
  it("non-opportunity pages are skipped", () => {
    expect(extractWithRules("Welcome to our news blog. Read our latest stories about campus life.", "https://x.example", lead())).toBeNull();
  });
});
