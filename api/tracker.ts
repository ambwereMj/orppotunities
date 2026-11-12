import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Store } from "../src/db/store.js";
import { applyUpdate, loadRows, renderPage, verifyLink } from "../src/web/tracker.js";

/** Private tracker page. Only reachable with a signed, expiring link sent by the bot (/web). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-robots-tag", "noindex, nofollow");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'");
  const { exp, sig } = req.query;
  if (!process.env.TELEGRAM_BOT_TOKEN || !verifyLink(exp, sig)) {
    return res.status(403).send("This link has expired or is invalid. Send /web to your bot for a new one.");
  }
  const q = `exp=${encodeURIComponent(String(exp))}&sig=${encodeURIComponent(String(sig))}`;
  try {
    const store = new Store();
    let flash = "";
    if (req.method === "POST") flash = await applyUpdate(store, (req.body ?? {}) as Record<string, unknown>);
    else if (req.method !== "GET") return res.status(405).end();
    res.setHeader("content-type", "text/html; charset=utf-8");
    return res.status(200).send(renderPage(await loadRows(store), q, flash));
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "tracker failed", err: String(e) }));
    return res.status(500).send("Something went wrong. Try again in a minute.");
  }
}
