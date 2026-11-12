/** Hourly entry point: instant alerts, deadline reminders, source health, Sunday summary. */
import { log } from "../lib/log.js";
import { runHourly } from "./alerts.js";

runHourly().catch((e) => {
  log.error("hourly job failed", { err: String(e) });
  process.exit(1);
});
