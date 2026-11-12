import { log } from "./log.js";

/**
 * Polite HTTP client: respects robots.txt, rate-limits per host, retries with backoff.
 * Generic user-agent — no personal details are sent to any site.
 */
const UA = "OpportunityAgent/0.1 (+personal, non-commercial; respects robots.txt)";
const MIN_GAP_MS = Number(process.env.HTTP_MIN_GAP_MS ?? 5000);

const lastHit = new Map<string, number>();
const robotsCache = new Map<string, string[]>(); // host -> disallowed path prefixes for *

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function throttle(host: string) {
  const prev = lastHit.get(host) ?? 0;
  const wait = prev + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

/** Parse robots.txt and return Disallow prefixes that apply to user-agent "*". */
export function parseRobots(txt: string): string[] {
  const out: string[] = [];
  let applies = false;
  let sawAgentInGroup = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const key = k.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") {
      if (!sawAgentInGroup) applies = false;
      sawAgentInGroup = true;
      if (val === "*" || /opportunityagent/i.test(val)) applies = true;
    } else {
      sawAgentInGroup = false;
      if (applies && key === "disallow" && val) out.push(val);
    }
  }
  return out;
}

export function robotsAllows(disallow: string[], path: string): boolean {
  return !disallow.some((p) => {
    if (p.includes("*")) {
      const re = new RegExp("^" + p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*"));
      return re.test(path);
    }
    return path.startsWith(p);
  });
}

async function allowed(url: URL): Promise<boolean> {
  if (!robotsCache.has(url.host)) {
    try {
      await throttle(url.host);
      const r = await fetch(`${url.protocol}//${url.host}/robots.txt`, {
        headers: { "user-agent": UA },
        signal: AbortSignal.timeout(15000),
      });
      robotsCache.set(url.host, r.ok ? parseRobots(await r.text()) : []);
    } catch {
      robotsCache.set(url.host, []);
    }
  }
  return robotsAllows(robotsCache.get(url.host)!, url.pathname + url.search);
}

export class RobotsDisallowed extends Error {}

export async function politeFetch(
  urlStr: string,
  opts: { accept?: string; retries?: number; checkRobots?: boolean } = {},
): Promise<{ status: number; url: string; text: string }> {
  const url = new URL(urlStr);
  if (opts.checkRobots !== false && !(await allowed(url))) {
    throw new RobotsDisallowed(`robots.txt disallows ${urlStr}`);
  }
  const retries = opts.retries ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await throttle(url.host);
      const r = await fetch(url, {
        headers: { "user-agent": UA, accept: opts.accept ?? "text/html,application/xhtml+xml,application/json,application/rss+xml,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(30000),
      });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      return { status: r.status, url: r.url || urlStr, text: await r.text() };
    } catch (e) {
      lastErr = e;
      log.warn("fetch retry", { url: urlStr, attempt, err: String(e) });
      await sleep(2000 * 2 ** attempt);
    }
  }
  throw lastErr;
}
