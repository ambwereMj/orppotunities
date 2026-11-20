import type { Profile } from "../lib/config.js";

/**
 * Tailoring = re-ordering what is already true, never adding anything.
 * Skills and project bullets that the opportunity page mentions move to the front.
 */
export function pageKeywords(pageText: string): Set<string> {
  return new Set(
    pageText
      .toLowerCase()
      .replace(/[^a-z0-9+#. ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2),
  );
}

function relevance(item: string, kw: Set<string>, pageLower: string): number {
  const l = item.toLowerCase();
  if (pageLower.includes(l)) return 3; // whole phrase on the page (e.g. "Next.js", "Django REST Framework")
  return l.split(/[^a-z0-9+#.]+/).filter((w) => w.length >= 3 && kw.has(w)).length;
}

function sortByRelevance<T>(items: T[], text: (t: T) => string, kw: Set<string>, pageLower: string): T[] {
  return items
    .map((it, i) => ({ it, i, r: relevance(text(it), kw, pageLower) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.it);
}

export function tailorProfile(p: Profile, pageText: string): Profile {
  const kw = pageKeywords(pageText);
  const lower = pageText.toLowerCase();
  const ts = p.technical_skills ?? {};
  const tailoredSkills = Object.fromEntries(Object.entries(ts).map(([k, v]) => [k, sortByRelevance(v, (s) => s, kw, lower)]));
  const projects = (p.projects as { name: string; summary?: string; details?: string[] }[]).map((pr) => ({
    ...pr,
    details: sortByRelevance(pr.details ?? [], (d) => d, kw, lower),
  }));
  const ordered = sortByRelevance(projects, (pr) => `${pr.name} ${pr.summary ?? ""} ${(pr.details ?? []).join(" ")}`, kw, lower);
  return { ...p, technical_skills: tailoredSkills, projects: ordered };
}
