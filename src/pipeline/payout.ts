import type { PayoutResult } from "../types.js";

/**
 * Pick the cheapest working payout route from the payer's stated methods to what you have:
 * M-Pesa, PayPal, KCB bank account. Ordered cheapest first.
 */
const ROUTES: { re: RegExp; route: string; needs?: string }[] = [
  { re: /m-?pesa|mobile money/i, route: "Direct to M-Pesa" },
  { re: /kenya(n)? bank|local bank|kcb/i, route: "Local bank transfer to KCB" },
  { re: /paypal/i, route: "PayPal → withdraw to M-Pesa (M-Pesa Global/PayPal link) or KCB" },
  { re: /bank transfer|wire|swift|direct deposit|bank account|iban/i, route: "International (SWIFT) transfer to KCB account — check fees" },
  { re: /deel/i, route: "Deel → withdraw to PayPal or KCB (SWIFT)" },
  { re: /remote\.com|oyster|rippling/i, route: "Employer-of-record payroll → bank transfer to KCB" },
];

const NEEDS: { re: RegExp; method: string }[] = [
  { re: /payoneer/i, method: "Payoneer" },
  { re: /\bwise\b|transferwise/i, method: "Wise" },
  { re: /crypto|usdt|bitcoin|binance/i, method: "Crypto wallet (not recommended)" },
  { re: /venmo|zelle|cash ?app/i, method: "US-only app (Venmo/Zelle/Cash App) — not available in Kenya" },
];

export function payoutRoute(methods: string[], payText = ""): PayoutResult {
  const hay = `${methods.join(" ")} ${payText}`;
  for (const r of ROUTES) if (r.re.test(hay)) {
    const extra = NEEDS.filter((n) => n.re.test(hay)).map((n) => n.method);
    return { route: r.route, needsNewMethod: [], note: extra.length ? `also offers: ${extra.join(", ")}` : "" };
  }
  const needs = NEEDS.filter((n) => n.re.test(hay)).map((n) => n.method);
  if (needs.length) {
    return { route: null, needsNewMethod: needs, note: `pays only via ${needs.join(", ")} — decide whether to open one` };
  }
  return { route: null, needsNewMethod: [], note: "payment method not stated — confirm before starting work" };
}
