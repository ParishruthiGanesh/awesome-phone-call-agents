/**
 * Call mode.
 *
 * Dry run is not merely the documented default, it is the value of anything
 * that is not exactly the string `live`. An unset variable, a typo, a mode
 * copied from a template, and a mode set by an unrelated process all resolve to
 * "do not dial".
 */
import type { CallMode, Env } from "./types";

export const DRY_RUN_SCENARIOS = [
  "inspection_confirmed",
  "followup_requested",
  "declined",
  "unanswered",
  "voicemail",
  "contradictory",
  "provider_failure",
] as const;

export type DryRunScenario = (typeof DRY_RUN_SCENARIOS)[number];

export function callMode(env: Env = process.env): CallMode {
  return env.HERDRELAY_MODE === "live" ? "live" : "dry_run";
}

export function isDryRun(env: Env = process.env): boolean {
  return callMode(env) === "dry_run";
}

export function dryRunScenario(env: Env = process.env): DryRunScenario {
  const requested = env.HERDRELAY_DRY_RUN_SCENARIO;
  return isDryRunScenario(requested) ? requested : "inspection_confirmed";
}

export function isDryRunScenario(value: unknown): value is DryRunScenario {
  return typeof value === "string" && (DRY_RUN_SCENARIOS as readonly string[]).includes(value);
}

export type LiveReadiness =
  | { ready: true; caretakerName: string; siteName: string }
  | { ready: false; reason: string };

/**
 * Whether a live call could be placed at all, checked before anything is
 * reserved and before any approval is offered.
 *
 * Every branch here fails closed, and none of them reveals the configured
 * number: the operator is told what is missing, not what is set.
 */
export function liveReadiness(env: Env = process.env): LiveReadiness {
  if (callMode(env) !== "live") {
    return { ready: false, reason: "HERDRELAY_MODE is not `live`; HerdRelay will not place calls." };
  }
  if (!env.HERDRELAY_AUTHORIZED_E164) {
    return {
      ready: false,
      reason: "No authorized caretaker number is configured. Set HERDRELAY_AUTHORIZED_E164.",
    };
  }
  if (!env.CALLE_API_KEY) {
    return { ready: false, reason: "CALLE_API_KEY is not set." };
  }
  if ((env.HERDRELAY_AUTH_TOKEN ?? "").length < 32) {
    return {
      ready: false,
      reason: "Live mode requires HERDRELAY_AUTH_TOKEN with at least 32 random characters.",
    };
  }
  const caretakerName = env.HERDRELAY_CARETAKER_NAME?.trim();
  if (!caretakerName) {
    return {
      ready: false,
      reason:
        "Set HERDRELAY_CARETAKER_NAME to the person who has agreed to receive these calls.",
    };
  }
  return { ready: true, caretakerName, siteName: env.HERDRELAY_SITE_NAME?.trim() || "the farm" };
}
