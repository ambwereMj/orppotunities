import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "../lib/vault.js";
import { env } from "../lib/config.js";

/**
 * Encrypted document vault, fed from Telegram. Files are encrypted (AES-256-GCM) BEFORE they are
 * stored in the private Supabase bucket "vault"; the key (VAULT_PASSPHRASE) lives only in Vercel.
 * Nothing here is ever sent to an AI model.
 */
export const DOC_TYPES = {
  cv: "CV",
  kcse: "KCSE certificate",
  kcse_results: "KCSE result slip",
  leaving_cert: "School leaving certificate",
  transcript: "JKUAT transcript",
  enrolment: "JKUAT enrolment / admission letter",
  moringa: "Moringa certificate",
  icdl: "ICDL certificate",
  passport: "Passport (bio page)",
  national_id: "National ID",
  other: "Other",
} as const;
export type DocType = keyof typeof DOC_TYPES;

/** Map stored document types to the checklist's document ids. */
export function checklistDocs(types: string[]): string[] {
  const out = new Set<string>();
  for (const t of types) {
    if (t === "transcript") out.add("transcript");
    if (t === "kcse" || t === "moringa" || t === "icdl") out.add("certificates");
    if (t === "kcse_results") out.add("kcse_results");
    if (t === "enrolment") out.add("admission");
    if (t === "passport" || t === "national_id") out.add("passport");
  }
  // Certificates are "ready" only once all three exist.
  const certs = ["kcse", "moringa", "icdl"].every((c) => types.includes(c));
  if (!certs) out.delete("certificates");
  return [...out];
}

/** Guess the type from a caption or file name ("transcript.pdf", "KCSE cert"). */
export function guessType(text = ""): DocType | null {
  const t = text.toLowerCase();
  if (/kcse/.test(t) && /results?/.test(t)) return "kcse_results";
  if (/leaving cert/.test(t)) return "leaving_cert";
  if (/kcse|secondary/.test(t)) return "kcse";
  if (/transcript|academic record|semester results/.test(t)) return "transcript";
  if (/admission|enrol?ment|student id|letter of (admission|enrol)/.test(t)) return "enrolment";
  if (/moringa/.test(t)) return "moringa";
  if (/icdl|driving licen[cs]e/.test(t)) return "icdl";
  if (/passport/.test(t)) return "passport";
  if (/national id|\bid card\b|kitambulisho/.test(t)) return "national_id";
  if (/\bcv\b|resume|résumé|curriculum/.test(t)) return "cv";
  return null;
}

const BUCKET = "vault";
const passphrase = () => env("VAULT_PASSPHRASE");

async function ensureBucket(db: SupabaseClient) {
  const { data } = await db.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await db.storage.createBucket(BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw error;
  }
}

export interface StoredDoc {
  type: DocType;
  path: string;
  name: string;
  bytes: number;
  uploaded: string;
}

export async function storeDocument(db: SupabaseClient, data: Buffer, name: string): Promise<string> {
  await ensureBucket(db);
  const path = `docs/${Date.now()}-${name.replace(/[^\w.-]+/g, "_").slice(0, 80)}.enc`;
  const { error } = await db.storage.from(BUCKET).upload(path, encrypt(data, passphrase()), { contentType: "application/octet-stream", upsert: false });
  if (error) throw error;
  return path;
}

export async function readDocument(db: SupabaseClient, path: string): Promise<Buffer> {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) throw error ?? new Error("not found");
  return decrypt(Buffer.from(await data.arrayBuffer()), passphrase());
}

export async function deleteDocument(db: SupabaseClient, path: string) {
  await db.storage.from(BUCKET).remove([path]);
}
