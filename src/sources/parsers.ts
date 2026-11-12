import * as cheerio from "cheerio";
import type { Lead, SourceConfig } from "../types.js";
import { inferType } from "../pipeline/prefilter.js";

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
      type: src.aggregator ? inferType(strip(title), src.type) : src.type,
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

/** Link texts that are site navigation, not a specific opportunity. */
const NAV =
  /^(home|about( us)?|contact( us)?|news|blog|events?|faq|faqs|login|log in|sign in|register|search|menu|privacy|terms|cookies?|careers?|jobs|more|read more|learn more|click here|here|back|next|previous|alumni|our (team|story|impact)|who we are|find (a|your) .*|explore( the series)?|quality standards|application guidance|guidance|resources?|resource hub|archive|.*archive|scholarship holders|participating countries|partners?|media|press|downloads?|publications?|annual report|donate|subscribe|newsletter|share|facebook|twitter|linkedin|instagram|youtube)$/i;

/** A link must look like a specific opportunity. */
const OPP_WORD =
  /scholarship|fellowship|internship|intern\b|programme|program\b|call for|award|grant|bursary|vacanc|position|trainee|attachment|graduate|summer|research|apply|application|admission|exchange|competition|hackathon|mentorship|bootcamp/i;

/**
 * Watched official page: links that match the source's keywords AND look like a specific opportunity
 * become leads. Navigation links are ignored. The index page itself is not a lead.
 */
export function parsePage(html: string, pageUrl: string, src: SourceConfig): Lead[] {
  const $ = cheerio.load(html);
  $("nav, header, footer, [role=navigation], .menu, .navbar, .breadcrumb, .breadcrumbs").remove();
  const kws = (src.match ?? []).map((k) => k.toLowerCase());
  const seen = new Set<string>([pageUrl.replace(/\/$/, "")]);
  const leads: Lead[] = [];
  $("a[href]").each((_, a) => {
    const text = $(a).text().replace(/\s+/g, " ").trim();
    const href = $(a).attr("href")!;
    if (!text || text.length < 12 || text.length > 200 || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) return;
    if (NAV.test(text) || /\b(archive|archives|all news|past (winners|recipients|scholars))\b/i.test(text) || /\.(pdf|docx?|xlsx?|zip|jpg|png)$/i.test(href)) return;
    let abs: string;
    try {
      abs = new URL(href, pageUrl).toString();
    } catch {
      return;
    }
    const site = (u: string) => new URL(u).hostname.replace(/^www\d?\./, "").split(".").slice(-2).join(".");
    if (!src.external && site(abs) !== site(pageUrl)) return;
    const hay = `${text} ${href}`.toLowerCase();
    if (kws.length && !kws.some((k) => hay.includes(k))) return;
    if (!OPP_WORD.test(text)) return;
    const key = abs.replace(/[#?].*$/, "").replace(/\/$/, "");
    if (seen.has(key)) return;
    seen.add(key);
    leads.push({ sourceId: src.id, type: src.type, title: text, url: abs, aggregator: false, watched: true });
  });
  return leads.slice(0, 15);
}
