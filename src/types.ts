export type OppType = "scholarship" | "internship" | "remote_work" | "program" | "skills";

export interface SourceConfig {
  id: string;
  kind: "rss" | "remoteok" | "remotive" | "himalayas" | "page";
  url: string;
  type: OppType;
  aggregator?: boolean;
  match?: string[];
  /** Watched pages: also follow links to other sites (default: same site only). */
  external?: boolean;
  enabled: boolean;
}

/** A raw lead as produced by a source plugin, before verification. */
export interface Lead {
  sourceId: string;
  type: OppType;
  title: string;
  url: string;
  aggregator: boolean;
  /** Lead came from a watched official page (already targeted by `match`). */
  watched?: boolean;
  summary?: string;
  provider?: string;
  /** Structured fields some APIs give us directly (job boards). */
  location?: string;
  salary?: string;
  publishedAt?: string;
  tags?: string[];
}

/** A fact extracted from the official page, with the exact text it came from. */
export interface Evidenced<T> {
  value: T;
  quote: string | null;
}

export type Funding = "full" | "partial" | "none" | "paid" | "unknown";

export interface Extracted {
  title: string;
  provider: string;
  officialUrl: string;
  deadline: Evidenced<string | null>; // ISO date or null => "deadline unknown – check"
  eligibleNationalities: Evidenced<string>; // e.g. "worldwide", "African countries", "US only"
  studyLevels: Evidenced<string[]>; // e.g. ["undergraduate","masters"]
  fields: Evidenced<string[]>;
  enrollmentRule: Evidenced<string | null>; // e.g. "must not be enrolled in a degree"
  ageLimit: Evidenced<number | null>;
  gradeRequirement: Evidenced<string | null>;
  gpaMandatory: Evidenced<boolean | null>;
  languageRequirement: Evidenced<string | null>;
  funding: Evidenced<Funding>;
  fundingDetails: Evidenced<string | null>; // tuition, stipend, travel, visa, insurance…
  pay: Evidenced<string | null>;
  paymentMethods: Evidenced<string[]>; // what the payer says they pay through
  applicationFee: Evidenced<string | null>;
  howToApply: Evidenced<string | null>;
  contactEmails: string[];
  remote: boolean | null;
}

export type Verdict = "eligible" | "check" | "ineligible";

export interface EligibilityResult {
  verdict: Verdict;
  reasons: string[];
}

export interface ScamResult {
  flagged: boolean;
  reject: boolean;
  reasons: string[];
}

export interface PayoutResult {
  route: string | null;
  needsNewMethod: string[];
  note: string;
}

export interface Scored {
  score: number;
  reason: string;
  parts: Record<string, number>;
}

export interface Opportunity {
  key: string; // dedupe key
  type: OppType;
  lead: Lead;
  extracted: Extracted;
  eligibility: EligibilityResult;
  scam: ScamResult;
  payout: PayoutResult | null;
  scored: Scored;
}
