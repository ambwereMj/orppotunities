import * as cheerio from "cheerio";
import type { Lead, SourceConfig } from "../types.js";

/** Pure parsers: raw response text -> leads. Tested against fixtures in test/fixtures. */

const strip = (html = "") => cheerio.load(`<div>${html}</div>`)("div").text().replace(/\s+/g, " ").trim();

export function parseRss(xml: string, src: SourceConfig): Lead[] {
  const $ = cheerio.load(xml, { xml: true });
  const leads: Lead[] = [];
  $("item, entry").each((_, el) => {
    const e = $(el);
    const title = e.children("title").first().text().trim();
    const link =
      e.children("link").first().text().trim() || e.children("link").first().attr("href") || "";
    if (!title || !link) return;
    leads.push({
      sourceId: src.id,
      type: src.type,
      title: strip(title),
      url: link,
      aggregator: !!src.aggregator,
      summary: strip(e.children("description, summary, content\\:encoded").first().text()).slice(0, 1500),
      publishedAt: e.children("pubDate, published, updated").first().text().trim() || undefined,
      tags: e.children("category").map((_, c) => $(c).text().trim()).get(),
    });
  });
  return leads;
}

interface RemoteOkJob {
  position?: string;
  company?: string;
  url?: string;
  apply_url?: string;
  description?: string;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  tags?: string[];
  date?: string;
}

export function parseRemoteOk(json: string, src: SourceConfig): Lead[] {
  const arr = JSON.parse(json) as RemoteOkJob[];
  // First element is a legal notice object, not a job.
  return arr
    .filter((j) => j && j.position && (j.url || j.apply_url))
    .map((j) => ({
      sourceId: src.id,
      type: src.type,
      title: j.position!,
      provider: j.company,
      url: j.url ?? j.apply_url!,
      aggregator: true,
      summary: strip(j.description).slice(0, 1500),
      location: j.location || "unspecified",
      salary: j.salary_min ? `$${j.salary_min}–${j.salary_max ?? "?"}/yr` : undefined,
      publishedAt: j.date,
      tags: j.tags,
    }));
}

interface RemotiveJob {
  title: string;
  company_name: string;
  url: string;
  description?: string;
  candidate_required_location?: string;
  salary?: string;
  publication_date?: string;
  tags?: string[];
}

export function parseRemotive(json: string, src: SourceConfig): Lead[] {
  const { jobs } = JSON.parse(json) as { jobs: RemotiveJob[] };
  return jobs.map((j) => ({
    sourceId: src.id,
    type: src.type,
    title: j.title,
    provider: j.company_name,
    url: j.url,
    aggregator: true,
    summary: strip(j.description).slice(0, 1500),
    location: j.candidate_required_location || "unspecified",
    salary: j.salary || undefined,
    publishedAt: j.publication_date,
    tags: j.tags,
  }));
}

interface HimalayasJob {
  title: string;
  companyName: string;
  applicationLink?: string;
  guid?: string;
  excerpt?: string;
  description?: string;
  locationRestrictions?: string[];
  minSalary?: number;
  maxSalary?: number;
  pubDate?: number;
  categories?: string[];
}

export function parseHimalayas(json: string, src: SourceConfig): Lead[] {
  const { jobs } = JSON.parse(json) as { jobs: HimalayasJob[] };
  return jobs
    .filter((j) => j.applicationLink || j.guid)
    .map((j) => ({
      sourceId: src.id,
      type: src.type,
      title: j.title,
      provider: j.companyName,
      url: (j.applicationLink || j.guid)!,
      aggregator: true,
      summary: strip(j.excerpt || j.description).slice(0, 1500),
      location: j.locationRestrictions?.length ? j.locationRestrictions.join(", ") : "worldwide",
      salary: j.minSalary ? `$${j.minSalary}–${j.maxSalary ?? "?"}` : undefined,
      publishedAt: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : undefined,
      tags: j.categories,
    }));
}

/** Watched official page: every link whose text or href matches a keyword becomes a lead. */
export function parsePage(html: string, pageUrl: string, src: SourceConfig): Lead[] {
  const $ = cheerio.load(html);
  const kws = (src.match ?? []).map((k) => k.toLowerCase());
  const seen = new Set<string>();
  const leads: Lead[] = [];
  $("a[href]").each((_, a) => {
    const text = $(a).text().replace(/\s+/g, " ").trim();
    const href = $(a).attr("href")!;
    if (!text || text.length < 6 || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) return;
    let abs: string;
    try {
      abs = new URL(href, pageUrl).toString();
    } catch {
      return;
    }
    const hay = `${text} ${href}`.toLowerCase();
    if (kws.length && !kws.some((k) => hay.includes(k))) return;
    if (seen.has(abs)) return;
    seen.add(abs);
    leads.push({ sourceId: src.id, type: src.type, title: text.slice(0, 200), url: abs, aggregator: false, watched: true });
  });
  // Always include the watched page itself so a change on it is re-checked.
  if (!seen.has(pageUrl)) {
    leads.unshift({ sourceId: src.id, type: src.type, title: $("title").text().trim() || src.id, url: pageUrl, aggregator: false, watched: true });
  }
  return leads.slice(0, 25);
}
