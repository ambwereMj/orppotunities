/**
 * Runs every 3 hours: instant alerts, deadline reminders (14/7/3/1 days for saved items),
 * broken-source alerts, and the Sunday-evening weekly summary.
 */
import { aiEnabled, settings } from "../lib/config.js";
import { log } from "../lib/log.js";
import { Store } from "../db/store.js";
import { daysUntil } from "../pipeline/eligibility.js";
import { sendMessage } from "../telegram/api.js";
import { deadlineText, esc, formatOpp, oppButtons } from "../telegram/format.js";

export async function sendInstantAlerts(store: Store) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await store.db
    .from("opportunities")
    .select("*")
    .is("alerted_at", null)
    .is("digested_at", null)
    .eq("status", "found")
    .eq("verdict", "eligible") // "check" items wait for the digest instead of interrupting you
    .or(`score.gte.${settings.instantAlertScore},and(deadline.gte.${today},deadline.lte.${new Date(Date.now() + settings.urgentDays * 86_400_000).toISOString().slice(0, 10)})`);
  if (error) throw new Error(JSON.stringify(error));
  for (const row of data ?? []) {
    const urgent = row.deadline && daysUntil(row.deadline) <= settings.urgentDays;
    await sendMessage(`${urgent ? "⏰ <b>Closing soon</b>" : "🔥 <b>High match</b>"}\n\n${formatOpp(row)}`, oppButtons(row.key, row.official_url));
    await store.markAlerted(row.key);
    await store.markDigested([row.key]);
  }
}

const REMINDER_DAYS = [14, 7, 3, 1];

async function deadlineReminders(store: Store) {
  const rows = await store.deadlinesWithin(14);
  for (const row of rows) {
    const d = daysUntil(row.deadline!);
    // Smallest threshold this item has crossed, sent once.
    const due = REMINDER_DAYS.filter((t) => d <= t).pop();
    if (due === undefined || (await store.reminderSent(row.key, due))) continue;
    await sendMessage(
      `⏰ <b>Reminder: ${d <= 1 ? "due tomorrow or today" : `${d} days left`}</b>\n<b>${esc(row.title)}</b>\nStatus: ${row.status}${row.blocking ? `\nBlocking: ${esc(row.blocking)}` : ""}\n${deadlineText(row)}\n<a href="${esc(row.official_url)}">Official page</a>`,
    );
    await store.recordReminder(row.key, due);
  }
}

async function brokenSourceAlert(store: Store) {
  const today = new Date().toISOString().slice(0, 10);
  if ((await store.getSetting<string>("last_health_alert")) === today) return;
  const broken = await store.brokenSources(3);
  if (broken.length) {
    await sendMessage(`🛠 These sources failed or returned nothing for 3+ days:\n${broken.map((b) => `• ${b}`).join("\n")}\nI'll keep trying; you can switch them off in sources.yaml.`);
  }
  await store.setSetting("last_health_alert", today);
}

async function weeklySummary(store: Store) {
  const now = new Date();
  // Sunday 19:00+ Nairobi (UTC+3).
  const nairobi = new Date(now.getTime() + 3 * 3_600_000);
  if (nairobi.getUTCDay() !== 0 || nairobi.getUTCHours() < 19) return;
  const week = nairobi.toISOString().slice(0, 10);
  if ((await store.getSetting<string>("last_weekly")) === week) return;
  const s = await store.weeklyStats();
  const spent = await store.aiSpentThisMonth();
  await sendMessage(
    [
      "📊 <b>Weekly summary</b>",
      `Found this week: ${s.found_this_week ?? 0}`,
      `Saved: ${s.saved ?? 0} · Preparing: ${s.preparing ?? 0} · Waiting on you: ${s.waiting_on_me ?? 0}`,
      `Submitted: ${s.submitted ?? 0} · Interview: ${s.interview ?? 0} · Results: ${s.result ?? 0}`,
      aiEnabled() ? `AI spend this month: $${spent.toFixed(2)} of $${settings.aiMonthlyCapUsd}` : "Mode: free (no AI, $0)",
    ].join("\n"),
  );
  await store.setSetting("last_weekly", week);
}

export async function runHourly() {
  const store = new Store();
  if (await store.isPaused()) return log.info("paused");
  await sendInstantAlerts(store);
  await deadlineReminders(store);
  await brokenSourceAlert(store);
  await weeklySummary(store);
}
