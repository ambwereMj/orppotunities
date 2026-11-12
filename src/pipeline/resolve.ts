import * as cheerio from "cheerio";

/** Domains that are never the "official" source of an opportunity. */
const NOT_OFFICIAL =
  /(facebook|twitter|x\.com|instagram|linkedin|youtube|tiktok|whatsapp|t\.me|telegram|pinterest|reddit|wa\.me|google\.com\/(search|url)|bit\.ly|tinyurl|feedburner|wordpress\.com|gravatar|amazon|doubleclick|addtoany|sharethis|disqus|opportunitydesk|opportunitiesforafricans|scholarship-positions|scholars4dev|afterschoolafrica|opportunitiescircle|scholarshipregion|myjobmag|remoteok|remotive|weworkremotely|himalayas)/i;

const OFFICIAL_TEXT =
  /official (website|link|page|site)|apply (now|here|online)|application (form|portal|link|page)|visit (the )?(official|website|site|programme|program)|for more (information|details)|click here to apply|learn more|more information|register (here|now)|apply for this job|apply/i;

export function htmlToText(html: string, maxChars = 24000): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, footer, header, iframe, form, aside").remove();
  const main = $("main, article, [role=main], .entry-content, .post-content, #content").first();
  const root = main.length ? main : $("body");
  return root.text().replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, maxChars);
}

/**
 * Find the official link on an aggregator article. Scores candidate external links by their
 * anchor text; returns null if nothing credible is found (then the item is marked "check").
 */
export function findOfficialLink(html: string, pageUrl: string): string | null {
  const $ = cheerio.load(html);
  const pageHost = new URL(pageUrl).hostname.replace(/^www\./, "");
  const scope = $("main, article, .entry-content, .post-content, #content").first();
  const root = scope.length ? scope : $("body");
  let best: { url: string; score: number } | null = null;
  root.find("a[href]").each((i, a) => {
    const href = $(a).attr("href")!;
    let abs: URL;
    try {
      abs = new URL(href, pageUrl);
    } catch {
      return;
    }
    if (!/^https?:$/.test(abs.protocol)) return;
    const host = abs.hostname.replace(/^www\./, "");
    if (host === pageHost || NOT_OFFICIAL.test(abs.toString())) return;
    const text = $(a).text().replace(/\s+/g, " ").trim();
    let score = 1;
    if (OFFICIAL_TEXT.test(text)) score += 5;
    if (/\.(gov|edu|ac|int|org)(\.[a-z]{2})?$/.test(host)) score += 2;
    if (/apply|application|scholarship|admission|careers?|jobs?/.test(abs.pathname)) score += 1;
    score -= i / 1000; // prefer earlier links on ties
    if (!best || score > best.score) best = { url: abs.toString(), score };
  });
  const b = best as { url: string; score: number } | null;
  return b && b.score >= 3 ? b.url : null;
}
