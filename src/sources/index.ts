import type { Lead, SourceConfig } from "../types.js";
import { politeFetch } from "../lib/http.js";
import { log } from "../lib/log.js";
import { parseHimalayas, parsePage, parseRemoteOk, parseRemotive, parseRss } from "./parsers.js";

export interface SourceRun {
  sourceId: string;
  ok: boolean;
  count: number;
  error?: string;
}

export async function fetchSource(src: SourceConfig): Promise<Lead[]> {
  const res = await politeFetch(src.url);
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  switch (src.kind) {
    case "rss":
      return parseRss(res.text, src);
    case "remoteok":
      return parseRemoteOk(res.text, src);
    case "remotive":
      return parseRemotive(res.text, src);
    case "himalayas":
      return parseHimalayas(res.text, src);
    case "page":
      return parsePage(res.text, res.url, src);
  }
}

/** Fetch every enabled source; one broken source never stops the others. */
export async function fetchAll(sources: SourceConfig[]): Promise<{ leads: Lead[]; runs: SourceRun[] }> {
  const leads: Lead[] = [];
  const runs: SourceRun[] = [];
  // Different hosts in parallel (per-host throttling is inside politeFetch).
  const results = await Promise.allSettled(sources.map((s) => fetchSource(s)));
  results.forEach((r, i) => {
    const s = sources[i];
    if (r.status === "fulfilled") {
      leads.push(...r.value);
      runs.push({ sourceId: s.id, ok: true, count: r.value.length });
    } else {
      log.warn("source failed", { source: s.id, err: String(r.reason) });
      runs.push({ sourceId: s.id, ok: false, count: 0, error: String(r.reason).slice(0, 300) });
    }
  });
  return { leads, runs };
}
