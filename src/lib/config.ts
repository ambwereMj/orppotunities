import { readFileSync, existsSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import type { SourceConfig } from "../types.js";

const EducationSchema = z.object({
  level: z.string(),
  qualification: z.string(),
  institution: z.string(),
  grade: z.string().optional().nullable(),
  start: z.union([z.string(), z.number()]).optional().nullable(),
  end: z.union([z.string(), z.number()]).optional().nullable(),
  current: z.boolean().optional(),
  year_of_study: z.number().optional().nullable(),
});

export const ProfileSchema = z.object({
  name: z.string(),
  nationality: z.string(),
  country_of_residence: z.string(),
  timezone: z.string(),
  date_of_birth: z.string().nullable().optional(),
  passport: z.boolean().nullable().optional(),
  languages: z.array(z.string()),
  education: z.array(EducationSchema),
  fields: z.array(z.string()),
  skills: z.array(z.string()),
  projects: z.array(z.any()).default([]),
  github: z.string().optional().nullable(),
  weekly_hours_available: z.number().nullable().optional(),
  payout_methods: z.array(z.string()),
  academic_grade_for_scholarships: z.string().nullable().optional(),
  gpa: z.string().nullable().optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;

/** Profile comes from profile.yaml locally, or PROFILE_YAML_B64 in the cloud. Never committed. */
export function loadProfile(path = "profile.yaml"): Profile {
  let text: string;
  if (process.env.PROFILE_YAML_B64) {
    text = Buffer.from(process.env.PROFILE_YAML_B64, "base64").toString("utf8");
  } else if (existsSync(path)) {
    text = readFileSync(path, "utf8");
  } else {
    throw new Error("No profile: create profile.yaml (see profile.example.yaml) or set PROFILE_YAML_B64");
  }
  return ProfileSchema.parse(parse(text));
}

const SourceSchema = z.object({
  id: z.string(),
  kind: z.enum(["rss", "remoteok", "remotive", "himalayas", "page"]),
  url: z.string().url(),
  type: z.enum(["scholarship", "internship", "remote_work", "program", "skills"]),
  aggregator: z.boolean().optional(),
  match: z.array(z.string()).optional(),
  external: z.boolean().optional(),
  enabled: z.boolean(),
});

export function loadSources(path = "sources.yaml"): SourceConfig[] {
  const doc = parse(readFileSync(path, "utf8")) as { sources: unknown[] };
  return z.array(SourceSchema).parse(doc.sources).filter((s) => s.enabled);
}

export function env(name: string, required = true): string {
  const v = process.env[name];
  if (!v && required) throw new Error(`Missing environment variable ${name}`);
  return v ?? "";
}

/** AI extraction is used only when a key is present AND the owner approved a budget above $0. */
export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY && Number(process.env.AI_MONTHLY_CAP_USD ?? 0) > 0;

export const settings = {
  /** Free by default: 0 = no AI at all (rule-based extraction). Raise only with the owner's approval. */
  aiMonthlyCapUsd: Number(process.env.AI_MONTHLY_CAP_USD ?? 0),
  /** Score at/above which an instant alert is sent. */
  instantAlertScore: 80,
  urgentDays: 7,
  digestSize: 10,
  extractModel: "claude-haiku-5-5",
  draftModel: "claude-opus-5-5",
  maxExtractionsPerRun: 180,
  dryRun: process.env.DRY_RUN === "1",
};
