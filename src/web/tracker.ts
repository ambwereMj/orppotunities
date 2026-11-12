import { createHmac, timingSafeEqual } from "node:crypto";
import type { OppRow, Store } from "../db/store.js";
import { env } from "../lib/config.js";
import { daysUntil } from "../pipeline/eligibility.js";

/**
 * Tracker web page. Access is by a signed, expiring link that only the bot sends to the owner
 * (/web in Telegram). No login, no cookies; the link stops working after LINK_DAYS.
 */
export const LINK_DAYS = 7;

export const STATUSES = ["found", "saved", "preparing", "waiting_on_me", "submitted", "interview", "result", "skipped", "not_interested"] as const;
const LABEL: Record<string, string> = {
  found: "New",
  saved: "Saved",
  preparing: "Preparing",
  waiting_on_me: "Waiting on me",
  submitted: "Submitted",
  interview: "Interview",
  result: "Result",
  skipped: "Skipped",
  not_interested: "Not interested",
};

function sign(exp: number, token = env("TELEGRAM_BOT_TOKEN")): string {
  return createHmac("sha256", token).update(`tracker:${exp}`).digest("hex").slice(0, 40);
}

export function trackerLink(baseUrl: string, now = Date.now(), token?: string): string {
  const exp = Math.floor(now / 1000) + LINK_DAYS * 86400;
  return `${baseUrl.replace(/\/$/, "")}/api/tracker?exp=${exp}&sig=${sign(exp, token)}`;
}

export function verifyLink(exp: unknown, sig: unknown, now = Date.now(), token?: string): boolean {
  const e = Number(exp);
  if (!Number.isFinite(e) || e * 1000 < now || typeof sig !== "string") return false;
  const want = sign(e, token);
  return sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function due(row: OppRow): string {
  if (!row.deadline) return `<span class="muted">deadline unknown – check</span>`;
  const d = daysUntil(row.deadline);
  const cls = d < 0 ? "past" : d <= 7 ? "urgent" : "";
  const txt = d < 0 ? "passed" : d === 0 ? "today" : `${d} day${d === 1 ? "" : "s"} left`;
  return `<span class="${cls}">${esc(row.deadline)} · ${txt}</span>`;
}

function card(row: OppRow, q: string): string {
  const options = STATUSES.map((s) => `<option value="${s}"${s === row.status ? " selected" : ""}>${LABEL[s]}</option>`).join("");
  return `<article>
  <h3><a href="${esc(row.official_url)}" target="_blank" rel="noopener noreferrer">${esc(row.title)}</a></h3>
  <p class="meta">${esc(row.provider ?? "")} · ${esc(row.type.replace("_", " "))} · fit ${row.score}/100${row.verdict === "check" ? " · <b>check eligibility</b>" : ""}${row.flagged ? " · ⚠️ flagged" : ""}</p>
  <p>${due(row)}</p>
  ${row.verdict === "check" && row.eligibility?.reasons?.length ? `<p class="muted">Check: ${esc(row.eligibility.reasons.join("; "))}</p>` : ""}
  <form method="post" action="/api/tracker?${q}">
    <input type="hidden" name="key" value="${esc(row.key)}">
    <label>Status <select name="status">${options}</select></label>
    <label>Blocking <input name="blocking" value="${esc(row.blocking ?? "")}" placeholder="What's stopping this?"></label>
    <label>Notes <textarea name="notes" rows="2">${esc(row.notes ?? "")}</textarea></label>
    <button>Save</button>
  </form>
</article>`;
}

export function renderPage(rows: OppRow[], q: string, flash = ""): string {
  const groups: [string, OppRow[]][] = [
    ["Waiting on me", rows.filter((r) => r.status === "waiting_on_me")],
    ["Preparing", rows.filter((r) => r.status === "preparing")],
    ["Saved", rows.filter((r) => r.status === "saved")],
    ["Submitted", rows.filter((r) => r.status === "submitted")],
    ["Interview", rows.filter((r) => r.status === "interview")],
    ["Results", rows.filter((r) => r.status === "result")],
    ["New (not decided yet)", rows.filter((r) => r.status === "found")],
  ];
  const body = groups
    .filter(([, list]) => list.length)
    .map(([name, list]) => `<section><h2>${name} <span class="count">${list.length}</span></h2>${list.map((r) => card(r, q)).join("")}</section>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>Opportunity tracker</title>
<style>
:root{--fg:#1b1f24;--muted:#5b6470;--line:#e3e6ea;--accent:#1f3a5f;--bg:#f6f7f9}
@media (prefers-color-scheme:dark){:root{--fg:#e8eaed;--muted:#9aa3ad;--line:#2b3138;--accent:#8fb4e3;--bg:#14171a}}
*{box-sizing:border-box}body{margin:0;font:16px/1.45 system-ui,-apple-system,sans-serif;color:var(--fg);background:var(--bg)}
main{max-width:720px;margin:0 auto;padding:16px}h1{font-size:1.4rem;margin:.2em 0 .6em}
h2{font-size:1.05rem;margin:1.4em 0 .5em;color:var(--accent)}.count{color:var(--muted);font-weight:400}
article{background:color-mix(in srgb,var(--bg) 70%,#fff 30%);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:0 0 10px}
@media (prefers-color-scheme:dark){article{background:#1b1f24}}
h3{font-size:1rem;margin:0 0 4px}h3 a{color:inherit}p{margin:4px 0}.meta,.muted{color:var(--muted);font-size:.9rem}
.urgent{color:#b3261e;font-weight:600}.past{color:var(--muted);text-decoration:line-through}
form{display:grid;gap:6px;margin-top:8px}label{display:grid;gap:2px;font-size:.85rem;color:var(--muted)}
select,input,textarea{font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--fg)}
button{font:inherit;padding:9px;border:0;border-radius:8px;background:var(--accent);color:#fff;font-weight:600}
.flash{background:#e6f4ea;color:#1e4620;padding:8px 12px;border-radius:8px}
</style></head><body><main>
<h1>Opportunity tracker</h1>
${flash ? `<p class="flash">${esc(flash)}</p>` : ""}
${body || "<p>Nothing tracked yet. Use Save or Apply on items in Telegram.</p>"}
<p class="muted">This private link expires ${LINK_DAYS} days after it was sent. Send /web to the bot for a new one.</p>
</main></body></html>`;
}

export async function loadRows(store: Store): Promise<OppRow[]> {
  const tracked = await store.byStatus(["saved", "preparing", "waiting_on_me", "submitted", "interview", "result"], 100);
  const { data, error } = await store.db
    .from("opportunities")
    .select("*")
    .eq("status", "found")
    .in("verdict", ["eligible", "check"])
    .order("score", { ascending: false })
    .limit(25);
  if (error) throw new Error(JSON.stringify(error));
  return [...tracked, ...((data ?? []) as OppRow[])];
}

export async function applyUpdate(store: Store, form: Record<string, unknown>): Promise<string> {
  const key = String(form.key ?? "");
  const status = String(form.status ?? "");
  if (!key || !(STATUSES as readonly string[]).includes(status)) return "Nothing changed.";
  const row = await store.get(key);
  if (!row) return "Item not found.";
  const clip = (v: unknown) => (String(v ?? "").trim().slice(0, 2000) || null);
  await store.setStatus(key, status, { blocking: clip(form.blocking), notes: clip(form.notes) });
  if (status !== row.status) await store.addFeedback(key, `status:${status}`);
  return `Saved: ${row.title} → ${LABEL[status]}`;
}
