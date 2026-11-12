import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../lib/config.js";
import type { Opportunity } from "../types.js";
import type { Weights } from "../pipeline/rank.js";

export interface OppRow {
  key: string;
  type: string;
  title: string;
  provider: string | null;
  official_url: string;
  source_ids: string[];
  deadline: string | null;
  deadline_quote: string | null;
  funding: string | null;
  score: number;
  score_reason: string | null;
  verdict: string;
  flagged: boolean;
  extracted: Opportunity["extracted"];
  eligibility: Opportunity["eligibility"];
  scam: Opportunity["scam"];
  payout: Opportunity["payout"];
  status: string;
  blocking: string | null;
  notes: string | null;
  first_seen: string;
  digested_at: string | null;
  alerted_at: string | null;
}

export function toRow(o: Opportunity): Omit<OppRow, "status" | "blocking" | "notes" | "first_seen" | "digested_at" | "alerted_at"> {
  return {
    key: o.key,
    type: o.type,
    title: o.extracted.title || o.lead.title,
    provider: o.extracted.provider || o.lead.provider || null,
    official_url: o.extracted.officialUrl,
    source_ids: [o.lead.sourceId],
    deadline: o.extracted.deadline.value,
    deadline_quote: o.extracted.deadline.quote,
    funding: o.extracted.funding.value,
    score: o.scored.score,
    score_reason: o.scored.reason,
    verdict: o.eligibility.verdict,
    flagged: o.scam.flagged,
    extracted: o.extracted,
    eligibility: o.eligibility,
    scam: o.scam,
    payout: o.payout,
  };
}

/** Thin data layer over Supabase (service-role key; server-side only). */
export class Store {
  db: SupabaseClient;
  constructor(db?: SupabaseClient) {
    this.db = db ?? createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  }

  private ok<T>(r: { data: T; error: unknown }): T {
    if (r.error) throw new Error(JSON.stringify(r.error));
    return r.data;
  }

  async isPaused(): Promise<boolean> {
    const r = await this.db.from("agent_settings").select("value").eq("key", "paused").maybeSingle();
    return this.ok(r)?.value === true;
  }
  async setPaused(p: boolean) {
    this.ok(await this.db.from("agent_settings").upsert({ key: "paused", value: p }));
  }
  async getSetting<T>(key: string): Promise<T | null> {
    const r = await this.db.from("agent_settings").select("value").eq("key", key).maybeSingle();
    return (this.ok(r)?.value as T) ?? null;
  }
  async setSetting(key: string, value: unknown) {
    this.ok(await this.db.from("agent_settings").upsert({ key, value }));
  }

  async seenHashes(hashes: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (let i = 0; i < hashes.length; i += 200) {
      const r = await this.db.from("seen_urls").select("url_hash").in("url_hash", hashes.slice(i, i + 200));
      (this.ok(r) ?? []).forEach((x: { url_hash: string }) => out.add(x.url_hash));
    }
    return out;
  }
  async markSeen(rows: { url_hash: string; url: string; outcome: string; opp_key?: string | null }[]) {
    if (rows.length) this.ok(await this.db.from("seen_urls").upsert(rows, { onConflict: "url_hash", ignoreDuplicates: true }));
  }

  async existingKeys(keys: string[]): Promise<Map<string, OppRow>> {
    const m = new Map<string, OppRow>();
    if (!keys.length) return m;
    const r = await this.db.from("opportunities").select("*").in("key", keys);
    (this.ok(r) ?? []).forEach((x: OppRow) => m.set(x.key, x));
    return m;
  }

  async upsertOpportunity(o: Opportunity) {
    const existing = (await this.existingKeys([o.key])).get(o.key);
    const row = toRow(o);
    if (existing) {
      row.source_ids = [...new Set([...existing.source_ids, ...row.source_ids])];
      this.ok(await this.db.from("opportunities").update({ ...row, last_checked: new Date().toISOString() }).eq("key", o.key));
    } else {
      this.ok(await this.db.from("opportunities").insert(row));
    }
  }

  async get(key: string): Promise<OppRow | null> {
    return this.ok(await this.db.from("opportunities").select("*").eq("key", key).maybeSingle()) as OppRow | null;
  }
  async setStatus(key: string, status: string, extra: Partial<OppRow> = {}) {
    this.ok(await this.db.from("opportunities").update({ status, ...extra }).eq("key", key));
  }

  /** Candidates for the digest: eligible/check, not rejected, not yet sent, deadline not passed. */
  async digestCandidates(limit: number): Promise<OppRow[]> {
    const today = new Date().toISOString().slice(0, 10);
    const r = await this.db
      .from("opportunities")
      .select("*")
      .is("digested_at", null)
      .in("verdict", ["eligible", "check"])
      .eq("status", "found")
      .or(`deadline.is.null,deadline.gte.${today}`)
      .order("score", { ascending: false })
      .limit(limit);
    return this.ok(r) as OppRow[];
  }
  async markDigested(keys: string[]) {
    if (keys.length) this.ok(await this.db.from("opportunities").update({ digested_at: new Date().toISOString() }).in("key", keys));
  }
  async markAlerted(key: string) {
    this.ok(await this.db.from("opportunities").update({ alerted_at: new Date().toISOString() }).eq("key", key));
  }

  async byStatus(statuses: string[], limit = 30): Promise<OppRow[]> {
    const r = await this.db.from("opportunities").select("*").in("status", statuses).order("deadline", { ascending: true, nullsFirst: false }).limit(limit);
    return this.ok(r) as OppRow[];
  }
  async deadlinesWithin(days: number, statuses = ["saved", "preparing", "waiting_on_me"]): Promise<OppRow[]> {
    const today = new Date();
    const end = new Date(today.getTime() + days * 86_400_000);
    const r = await this.db
      .from("opportunities")
      .select("*")
      .in("status", statuses)
      .gte("deadline", today.toISOString().slice(0, 10))
      .lte("deadline", end.toISOString().slice(0, 10))
      .order("deadline");
    return this.ok(r) as OppRow[];
  }

  async reminderSent(key: string, days: number): Promise<boolean> {
    const r = await this.db.from("reminders_sent").select("opp_key").eq("opp_key", key).eq("days", days).maybeSingle();
    return !!this.ok(r);
  }
  async recordReminder(key: string, days: number) {
    this.ok(await this.db.from("reminders_sent").upsert({ opp_key: key, days }));
  }

  async addFeedback(key: string, action: string) {
    this.ok(await this.db.from("feedback").insert({ opp_key: key, action }));
  }
  async weights(): Promise<Weights> {
    const r = this.ok(await this.db.from("weights").select("*")) as { key: string; value: number }[];
    return Object.fromEntries(r.map((w) => [w.key, w.value]));
  }
  async bumpWeight(key: string, delta: number) {
    const cur = (await this.weights())[key] ?? 0;
    const value = Math.max(-10, Math.min(10, cur + delta));
    this.ok(await this.db.from("weights").upsert({ key, value }));
  }

  async recordSourceHealth(runs: { sourceId: string; ok: boolean; count: number; error?: string }[]) {
    const run_date = new Date().toISOString().slice(0, 10);
    const rows = runs.map((r) => ({ source_id: r.sourceId, run_date, ok: r.ok, count: r.count, error: r.error ?? null }));
    if (rows.length) this.ok(await this.db.from("source_health").upsert(rows));
  }
  /** Sources that failed or returned zero results on each of the last `days` runs. */
  async brokenSources(days = 3): Promise<string[]> {
    const since = new Date(Date.now() - (days + 1) * 86_400_000).toISOString().slice(0, 10);
    const r = this.ok(await this.db.from("source_health").select("*").gte("run_date", since)) as {
      source_id: string;
      ok: boolean;
      count: number;
      run_date: string;
    }[];
    const by = new Map<string, { bad: number; total: number }>();
    for (const x of r) {
      const v = by.get(x.source_id) ?? { bad: 0, total: 0 };
      v.total++;
      if (!x.ok || x.count === 0) v.bad++;
      by.set(x.source_id, v);
    }
    return [...by].filter(([, v]) => v.total >= days && v.bad === v.total).map(([k]) => k);
  }

  async aiSpentThisMonth(): Promise<number> {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const r = this.ok(await this.db.from("ai_costs").select("usd").gte("run_at", start.toISOString())) as { usd: number }[];
    return r.reduce((s, x) => s + Number(x.usd), 0);
  }
  async recordAiCost(job: string, usd: number) {
    if (usd > 0) this.ok(await this.db.from("ai_costs").insert({ job, usd }));
  }

  async weeklyStats(): Promise<Record<string, number>> {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const found = this.ok(await this.db.from("opportunities").select("key", { count: "exact", head: false }).gte("first_seen", since)) as unknown[];
    const all = this.ok(await this.db.from("opportunities").select("status").neq("status", "found")) as { status: string }[];
    const counts: Record<string, number> = { found_this_week: found.length };
    for (const r of all) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  }
}
