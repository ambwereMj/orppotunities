import type { Profile } from "../src/lib/config.js";
import type { Evidenced, Extracted, Lead } from "../src/types.js";

const e = <T>(value: T, quote: string | null = null): Evidenced<T> => ({ value, quote });

export function extracted(over: Partial<Extracted> = {}): Extracted {
  return {
    title: "Test Opportunity",
    provider: "Test Org",
    officialUrl: "https://example.org/opp",
    deadline: e<string | null>(null),
    eligibleNationalities: e("worldwide", "open to applicants worldwide"),
    studyLevels: e<string[]>(["undergraduate"]),
    fields: e<string[]>(["engineering"]),
    enrollmentRule: e<string | null>(null),
    ageLimit: e<number | null>(null),
    gradeRequirement: e<string | null>(null),
    gpaMandatory: e<boolean | null>(null),
    languageRequirement: e<string | null>(null),
    funding: e<Extracted["funding"]["value"]>("full", "covers tuition and a monthly stipend"),
    fundingDetails: e<string | null>(null),
    pay: e<string | null>(null),
    paymentMethods: e<string[]>([]),
    applicationFee: e<string | null>(null),
    howToApply: e<string | null>(null),
    contactEmails: [],
    remote: null,
    ...over,
  };
}

export const ev = e;

export function lead(over: Partial<Lead> = {}): Lead {
  return { sourceId: "test", type: "scholarship", title: "Engineering Scholarship", url: "https://example.org/opp", aggregator: false, ...over };
}

export const profile: Profile = {
  name: "Test Person",
  nationality: "Kenyan",
  country_of_residence: "Kenya",
  timezone: "Africa/Nairobi",
  date_of_birth: null,
  passport: null,
  languages: ["English"],
  education: [],
  fields: ["computer engineering", "electronic engineering", "software engineering"],
  skills: [],
  projects: [],
  github: null,
  weekly_hours_available: null,
  payout_methods: ["mpesa", "paypal", "bank_card_kcb"],
  academic_grade_for_scholarships: "KCSE B+",
  gpa: null,
};

export const NOW = new Date("2026-11-12T06:00:00+03:00");
