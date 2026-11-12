import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePage, parseRemoteOk, parseRemotive, parseRss } from "../src/sources/parsers.js";
import { findOfficialLink, htmlToText } from "../src/pipeline/resolve.js";
import { parseRobots, robotsAllows } from "../src/lib/http.js";
import type { SourceConfig } from "../src/types.js";

const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const src = (over: Partial<SourceConfig>): SourceConfig => ({ id: "s", kind: "rss", url: "https://x.example/", type: "scholarship", enabled: true, ...over });

describe("parsers", () => {
  it("parses RSS items and strips HTML from summaries", () => {
    const leads = parseRss(fx("aggregator.rss"), src({ aggregator: true }));
    expect(leads).toHaveLength(2);
    expect(leads[0].title).toContain("DAAD RISE");
    expect(leads[0].summary).toBe("Research internships in Germany for engineering undergraduates worldwide. Stipend provided.");
    expect(leads[0].aggregator).toBe(true);
    expect(leads[0].tags).toEqual(["Internships"]);
  });

  it("parses RemoteOK and skips the legal-notice element", () => {
    const leads = parseRemoteOk(fx("remoteok.json"), src({ kind: "remoteok", type: "remote_work" }));
    expect(leads.map((l) => l.title)).toEqual(["Junior Frontend Developer", "Senior Backend Engineer"]);
    expect(leads[0].salary).toBe("$20000–30000/yr");
    expect(leads[0].location).toBe("Worldwide");
  });

  it("parses Remotive", () => {
    const leads = parseRemotive(fx("remotive.json"), src({ kind: "remotive", type: "remote_work" }));
    expect(leads[0].location).toBe("USA");
    expect(leads[1].provider).toBe("LabelCo");
  });

  it("extracts only matching links from a watched page, resolving relative URLs", () => {
    const leads = parsePage(fx("page.html"), "https://employer.example/careers", src({ kind: "page", type: "internship", match: ["graduate", "intern", "attachment"] }));
    const urls = leads.map((l) => l.url);
    expect(urls).toContain("https://employer.example/careers/graduate-engineer-trainee-2027");
    expect(urls).toContain("https://other.example/internship-attachment");
    expect(urls.some((u) => u.includes("finance-officer"))).toBe(false);
    expect(urls.some((u) => u.startsWith("mailto"))).toBe(false);
    expect(leads.every((l) => l.watched)).toBe(true);
  });
});

describe("official link resolution", () => {
  it("picks the official site and ignores social/share and same-site links", () => {
    expect(findOfficialLink(fx("aggregator-article.html"), "https://aggregator.example/daad-rise-2027/")).toBe(
      "https://www.daad.de/rise/en/rise-germany/",
    );
  });
  it("returns null when there is no credible official link", () => {
    const html = `<article><a href="https://facebook.com/x">fb</a><a href="/other">x</a></article>`;
    expect(findOfficialLink(html, "https://aggregator.example/a")).toBeNull();
  });
  it("htmlToText drops scripts and navigation", () => {
    const t = htmlToText(`<body><nav>Menu</nav><script>evil()</script><main><p>Deadline: 1 March</p></main></body>`);
    expect(t).toBe("Deadline: 1 March");
  });
});

describe("robots.txt", () => {
  const rules = parseRobots(`User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\nDisallow: /*?search=\n`);
  it("applies only the * group", () => {
    expect(rules).toEqual(["/admin", "/*?search="]);
  });
  it("blocks disallowed paths including wildcards", () => {
    expect(robotsAllows(rules, "/admin/x")).toBe(false);
    expect(robotsAllows(rules, "/jobs?search=dev")).toBe(false);
    expect(robotsAllows(rules, "/jobs/1")).toBe(true);
  });
});
