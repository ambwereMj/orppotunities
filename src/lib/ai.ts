import Anthropic from "@anthropic-ai/sdk";
import { settings } from "./config.js";
import { log } from "./log.js";

/** USD per million tokens [input, output]. */
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const [i, o] = PRICES[model] ?? [4, 20];
  return (inputTokens * i + outputTokens * o) / 1_000_000;
}

export class BudgetExceeded extends Error {}

/**
 * Tracks AI spend. `spentThisMonth` is loaded from the database at job start; each call adds to it
 * and the call is refused once the monthly cap would be crossed.
 */
export class Budget {
  spentRun = 0;
  constructor(public spentThisMonth: number, public cap = settings.aiMonthlyCapUsd) {}
  get remaining() {
    return this.cap - this.spentThisMonth;
  }
  assertCanSpend(estimate = 0.01) {
    if (this.spentThisMonth + estimate > this.cap) {
      throw new BudgetExceeded(`AI monthly cap $${this.cap} reached ($${this.spentThisMonth.toFixed(2)} spent)`);
    }
  }
  add(usd: number) {
    this.spentThisMonth += usd;
    this.spentRun += usd;
  }
}

let client: Anthropic | null = null;
export function ai(): Anthropic {
  if (!client) client = new Anthropic({ maxRetries: 3 });
  return client;
}

export function logUsage(model: string, usage: { input_tokens: number; output_tokens: number }, budget: Budget) {
  const usd = costUsd(model, usage.input_tokens, usage.output_tokens);
  budget.add(usd);
  log.debug("ai usage", { model, ...usage, usd });
  return usd;
}
