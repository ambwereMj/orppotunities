import { chromium, type Browser, type Page, type LaunchOptions } from "playwright";
import { allowed } from "../lib/http.js";
import type { FormField } from "./answers.js";
import type { Answer } from "./answers.js";

/**
 * Opens an application page in a headless browser, reads the form's fields, detects checkpoints
 * (login, CAPTCHA), fills ONLY non-sensitive answers for a preview screenshot, and never submits.
 */
export interface FormRead {
  url: string;
  fields: FormField[];
  login: boolean;
  captcha: boolean;
  followedApplyLink: boolean;
}

const UA = "OpportunityAgent/0.1 (+personal, non-commercial; respects robots.txt)";

/**
 * Runs inside the page: collect visible form controls with their labels.
 * Kept as a plain-JavaScript string so build tools can't inject helpers the browser doesn't have.
 */
const COLLECT_FIELDS = `(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const clean = (s) => (s || "").replace(/\\s+/g, " ").replace(/\\*\\s*$/, "").trim().slice(0, 160);
  const labelOf = (el) => {
    const id = el.getAttribute("id");
    if (id) {
      const l = document.querySelector('label[for="' + CSS.escape(id) + '"]');
      if (l && l.textContent.trim()) return clean(l.textContent);
    }
    const wrap = el.closest("label");
    if (wrap && wrap.textContent.trim()) return clean(wrap.textContent);
    const aria = el.getAttribute("aria-label");
    if (aria) return clean(aria);
    const by = el.getAttribute("aria-labelledby");
    if (by) return clean(by.split(/\\s+/).map((i) => (document.getElementById(i) || {}).textContent || "").join(" "));
    const item = el.closest('[role="listitem"], .form-group, .field, fieldset');
    const head = item && item.querySelector('[role="heading"], legend, .label, h3, h4');
    if (head && head.textContent.trim()) return clean(head.textContent);
    return clean(el.getAttribute("placeholder") || el.getAttribute("name"));
  };
  const out = [];
  const seenRadio = new Set();
  let i = 0;
  for (const el of Array.from(document.querySelectorAll("input, select, textarea"))) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || (tag === "input" ? "text" : tag)).toLowerCase();
    if (["hidden", "submit", "button", "reset", "image", "search"].includes(type)) continue;
    if (type !== "file" && !visible(el)) continue;
    const sel = '[data-oa-field="' + i + '"]';
    el.setAttribute("data-oa-field", String(i++));
    const name = el.getAttribute("name") || undefined;
    const required = el.hasAttribute("required") || el.getAttribute("aria-required") === "true";
    const max = el.getAttribute("maxlength");
    if (type === "radio") {
      const key = name || sel;
      if (seenRadio.has(key)) continue;
      seenRadio.add(key);
      const group = name ? Array.from(document.querySelectorAll('input[type=radio][name="' + CSS.escape(name) + '"]')) : [el];
      const fs = el.closest('fieldset, [role="radiogroup"], [role="listitem"]');
      const lg = fs && fs.querySelector('legend, [role="heading"]');
      out.push({ kind: "radio", label: clean(lg && lg.textContent) || labelOf(el), name, required, options: group.map(labelOf), selector: sel });
      continue;
    }
    const kind = tag === "select" ? "select" : tag === "textarea" ? "textarea"
      : ["text", "email", "tel", "date", "number", "url", "checkbox", "file", "password"].includes(type) ? type : "other";
    const options = tag === "select" ? Array.from(el.options).map((o) => clean(o.textContent)).filter(Boolean) : undefined;
    out.push({ kind, label: labelOf(el), name, required, maxLength: max ? Number(max) : null, options, selector: sel });
  }
  return out;
})()`;

const FIND_APPLY_LINK = `(() => {
  const re = /^(apply( now| online| here)?|start (your )?application|application form|submit (an )?application|register)$/i;
  const links = Array.from(document.querySelectorAll("a[href]"));
  const hit = links.find((a) => re.test((a.textContent || "").replace(/\\s+/g, " ").trim()))
    || links.find((a) => /docs\\.google\\.com\\/forms|forms\\.gle|apply|application/i.test(a.href));
  return hit ? hit.href : null;
})()`;

const RADIO_LABEL = `(el) => ((el.closest("label") || {}).textContent || el.getAttribute("value") || "").trim()`;

async function detect(page: Page) {
  const html = (await page.content()).toLowerCase();
  const captcha = /recaptcha|hcaptcha|turnstile|g-recaptcha|captcha/.test(html);
  const login =
    (await page.locator('input[type="password"]').count()) > 0 ||
    /(sign|log) in to (continue|apply)|create an account to apply|please (sign|log) in/.test(html);
  return { captcha, login };
}

/** Link on an info page that leads to the actual application form. */
async function findApplyLink(page: Page): Promise<string | null> {
  const href = (await page.evaluate(FIND_APPLY_LINK)) as string | null;
  return href && /^https?:/.test(href) ? href : null;
}

export async function withBrowser<T>(fn: (b: Browser) => Promise<T>, launch: LaunchOptions = {}): Promise<T> {
  const browser = await chromium.launch(launch);
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

export async function readForm(browser: Browser, url: string, opts: { checkRobots?: boolean } = {}): Promise<{ read: FormRead; page: Page }> {
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 420, height: 900 }, locale: "en-GB" });
  const page = await ctx.newPage();
  const go = async (u: string) => {
    if (opts.checkRobots !== false && !(await allowed(new URL(u)))) throw new Error(`robots.txt disallows ${u}`);
    await page.goto(u, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  };
  await go(url);
  let fields = (await page.evaluate(COLLECT_FIELDS)) as FormField[];
  let followedApplyLink = false;
  if (fields.filter((f) => f.kind !== "other").length < 2) {
    const next = await findApplyLink(page);
    if (next && next !== url) {
      await go(next);
      fields = (await page.evaluate(COLLECT_FIELDS)) as FormField[];
      followedApplyLink = true;
    }
  }
  const { captcha, login } = await detect(page);
  return { read: { url: page.url(), fields, login, captcha, followedApplyLink }, page };
}

/** Fill the safe answers into the page for a preview. Never clicks anything that submits. */
export async function fillPreview(page: Page, answers: Answer[]): Promise<number> {
  let n = 0;
  for (const a of answers) {
    if (a.status !== "filled" || !a.value || !a.field.selector) continue;
    const loc = page.locator(a.field.selector).first();
    try {
      if (a.field.kind === "select") await loc.selectOption({ label: a.value }, { timeout: 2000 });
      else if (a.field.kind === "radio") {
        const name = a.field.name;
        const radio = name ? page.locator(`input[type=radio][name="${name}"]`) : loc;
        const count = await radio.count();
        for (let i = 0; i < count; i++) {
          const r = radio.nth(i);
          // A string that evaluates to a function is called with the element.
          const label = String((await r.evaluate(RADIO_LABEL as never).catch(() => "")) ?? "");
          if (label.toLowerCase().includes(a.value.toLowerCase())) {
            await r.check({ timeout: 2000 });
            break;
          }
        }
      } else if (["text", "email", "tel", "date", "number", "url"].includes(a.field.kind)) await loc.fill(a.value, { timeout: 2000 });
      else continue;
      n++;
    } catch {
      // A field that won't take input is simply left for you.
    }
  }
  return n;
}

export async function screenshot(page: Page): Promise<Buffer> {
  return page.screenshot({ fullPage: true, type: "jpeg", quality: 60 });
}
