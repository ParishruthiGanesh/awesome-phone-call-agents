/**
 * Pure readings of an alert.
 *
 * Kept apart from `lib/alerts.ts`, which touches the filesystem: these two
 * functions are rendered in the browser, and a client component that reaches a
 * `node:fs` import does not build.
 */
import type { LivestockAlert } from "./types";

/** How far outside the animal's normal range the reading sits, as a percentage. */
export function deviationPercent(alert: LivestockAlert): number {
  const { max } = alert.baselineRange;
  if (max <= 0) return 0;
  return Math.round(((alert.observedRespiratoryRate - max) / max) * 100);
}

/**
 * Whether the alert is worth a caretaker's phone ringing.
 *
 * This is a routing judgement about a phone call, not a judgement about the
 * animal: a low-confidence reading inside a plausible activity window is a
 * reason not to wake somebody, and nothing more than that.
 */
export function warrantsCall(alert: LivestockAlert): { warranted: boolean; reason: string } {
  if (alert.observedRespiratoryRate <= alert.baselineRange.max) {
    return {
      warranted: false,
      reason: "The reading is inside the animal's normal range. There is nothing to ask a caretaker about.",
    };
  }
  if (alert.confidence < 0.5) {
    return {
      warranted: false,
      reason: "The monitoring system's confidence is below 50 percent. A call would be asking somebody to chase noise.",
    };
  }
  return { warranted: true, reason: "The reading is outside range with usable confidence." };
}
