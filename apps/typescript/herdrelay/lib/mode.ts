/**
 * Call mode.
 *
 * Dry run is not merely the documented default, it is the value of anything
 * that is not exactly the string `live`. An unset variable, a typo, a mode
 * copied from a template, and a mode set by an unrelated process all resolve to
 * "do not dial".
 */
import { configuredDestinationProblem } from "./phone";
import { isSelfService } from "./self-service";
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
 * Every branch fails closed, and none of them reveals the configured number:
 * the operator is told what is missing, not what is set.
 *
 * This answers "can a call be placed", not "can somebody sign in". Requiring a
 * credential here as well would duplicate `lib/access.ts` — which enforces it
 * on every single request, and knows about named accounts and the environment
 * seed that this function cannot see synchronously.
 */
export function liveReadiness(env: Env = process.env): LiveReadiness {
  if (callMode(env) !== "live") {
    return { ready: false, reason: "HERDRELAY_MODE is not `live`; HerdRelay will not place calls." };
  }
  if (!env.CALLE_API_KEY) {
    return { ready: false, reason: "CALLE_API_KEY is not set." };
  }

  const siteName = env.HERDRELAY_SITE_NAME?.trim() || "the farm";

  // In self-service mode the destination and the recipient's name come from the
  // person who will be called, so there is nothing to configure here and
  // demanding it would block the very mode that replaces it.
  if (isSelfService(env)) {
    return { ready: true, caretakerName: "the recipient", siteName };
  }

  const destinationProblem = configuredDestinationProblem(env.HERDRELAY_AUTHORIZED_E164);
  if (destinationProblem) {
    return { ready: false, reason: destinationProblem };
  }
  const caretakerName = env.HERDRELAY_CARETAKER_NAME?.trim();
  if (!caretakerName) {
    return {
      ready: false,
      reason:
        "Set HERDRELAY_CARETAKER_NAME to the person who has agreed to receive these calls.",
    };
  }
  return { ready: true, caretakerName, siteName };
}
