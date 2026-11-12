import { createHash } from "node:crypto";
import type { Lead } from "../types.js";

const TRACKING = /^(utm_|fbclid|gclid|ref$|source$|mc_)/i;

export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    url.hostname = url.hostname.replace(/^www\./, "").toLowerCase();
    [...url.searchParams.keys()].forEach((k) => TRACKING.test(k) && url.searchParams.delete(k));
    url.searchParams.sort();
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
    let s = url.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s.replace(/^http:/, "https:");
  } catch {
    return u.trim();
  }
}

const STOP = new Set([
  "the", "a", "an", "for", "of", "in", "and", "to", "at", "on", "fully", "funded", "scholarship", "scholarships",
  "program", "programme", "apply", "now", "open", "call", "applications", "application", "deadline",
]);

/** Title fingerprint: lowercase words, years and stopwords removed, sorted — survives aggregator re-wording. */
export function titleFingerprint(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w) && !/^(19|20)\d\d$/.test(w))
    .sort()
    .join(" ");
}

export function jaccard(a: string, b: string): number {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((w) => B.has(w) && inter++);
  return inter / (A.size + B.size - inter);
}

export const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

/** Key used to store/dedupe an opportunity once its official URL is known. */
export function oppKey(officialUrl: string): string {
  return hash(normalizeUrl(officialUrl));
}

/**
 * Remove duplicate leads (same URL, or near-identical titles from different sources).
 * Prefers non-aggregator leads, since they already point at the official page.
 */
export function dedupeLeads(leads: Lead[], threshold = 0.8): Lead[] {
  const sorted = [...leads].sort((a, b) => Number(a.aggregator) - Number(b.aggregator));
  const kept: { lead: Lead; url: string; fp: string }[] = [];
  for (const lead of sorted) {
    const url = normalizeUrl(lead.url);
    const fp = titleFingerprint(lead.title);
    const dup = kept.some(
      (k) => k.url === url || (fp.split(" ").length >= 3 && jaccard(k.fp, fp) >= threshold),
    );
    if (!dup) kept.push({ lead, url, fp });
  }
  return kept.map((k) => k.lead);
}
