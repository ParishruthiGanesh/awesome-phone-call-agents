/**
 * The approval preview.
 *
 * The operator approves an object, not an intention. Everything that determines
 * what the caretaker will hear — the destination, the disclosure, the five
 * questions, the verbatim brief — is in this object, and the object is hashed.
 * `lib/incident.ts` recomputes the hash at dial time and refuses to place a call
 * whose preview no longer matches the one that was approved, so an approval
 * cannot be spent on a call the operator never saw.
 */
import { createHash } from "node:crypto";
import { buildTask, disclosureLine, EXPECTED_DATA, LIMITATIONS, QUESTIONS } from "./calle";
import { dryRunDestination } from "./dry-run";
import { liveReadiness } from "./mode";
import { configuredDestinationProblem, destination, type Destination } from "./phone";
import type { CallMode, CallPreview, LivestockAlert, Env } from "./types";

export type PreviewContext = {
  mode: CallMode;
  destination: Destination;
  caretakerName: string;
  siteName: string;
};

export class NotDialable extends Error {}

/**
 * Resolve who would be called, from the server's configuration only.
 *
 * The browser never sends a phone number, so there is no request an operator
 * could craft that dials somewhere else. In dry run the destination is the
 * reserved fictional number; in live mode it is the one configured caretaker,
 * and every missing piece of that configuration is a refusal.
 */
/** A destination the recipient supplied and consented to, rather than a configured one. */
export function consentedContext(
  resolved: Destination,
  caretakerName: string,
  env: Env = process.env,
): PreviewContext {
  return {
    mode: env.HERDRELAY_MODE === "live" ? "live" : "dry_run",
    destination: resolved,
    caretakerName,
    siteName: env.HERDRELAY_SITE_NAME?.trim() || "Ridgeline Dairy",
  };
}

export function previewContext(env: Env = process.env): PreviewContext {
  if (env.HERDRELAY_MODE !== "live") {
    return {
      mode: "dry_run",
      destination: dryRunDestination(),
      caretakerName: env.HERDRELAY_CARETAKER_NAME?.trim() || "Sam Okonkwo (synthetic caretaker)",
      siteName: env.HERDRELAY_SITE_NAME?.trim() || "Ridgeline Dairy",
    };
  }
  const readiness = liveReadiness(env);
  if (!readiness.ready) throw new NotDialable(readiness.reason);
  return {
    mode: "live",
    // A number that is set but malformed is a configuration error, not an
    // unexpected failure, and the operator has to be told which. Rethrown as
    // NotDialable so it reaches them as advice; the number itself is never
    // echoed back, because a typo'd number is still somebody's number.
    destination: resolveConfiguredDestination(env.HERDRELAY_AUTHORIZED_E164!),
    caretakerName: readiness.caretakerName,
    siteName: readiness.siteName,
  };
}

function resolveConfiguredDestination(configured: string): Destination {
  const problem = configuredDestinationProblem(configured);
  if (problem) throw new NotDialable(problem);
  return destination(configured);
}

export function buildPreview(
  incidentId: string,
  alert: LivestockAlert,
  context: PreviewContext,
): CallPreview {
  const preview: Omit<CallPreview, "fingerprint"> = {
    incidentId,
    mode: context.mode,
    recipientMasked: context.destination.masked,
    caretakerName: context.caretakerName,
    purpose:
      `Ask an authorized caretaker whether they can inspect animal ${alert.animalId} at ${alert.location}, ` +
      `how soon, what they can see, and whether they want a person to arrange veterinary or supervisor follow-up. ` +
      `The call collects observations. It decides nothing.`,
    disclosure: disclosureLine(context.siteName),
    questions: [...QUESTIONS],
    expectedData: [...EXPECTED_DATA],
    limitations: [...LIMITATIONS],
    task: buildTask(alert, { siteName: context.siteName, caretakerName: context.caretakerName }),
  };
  return { ...preview, fingerprint: fingerprintPreview(preview) };
}

/**
 * A stable hash of the approved call.
 *
 * Keys are sorted so that a re-serialization cannot change the fingerprint, and
 * the mode is included so that an approval taken against a dry run can never be
 * redeemed for a real call.
 */
export function fingerprintPreview(preview: Omit<CallPreview, "fingerprint">): string {
  return createHash("sha256").update(canonical(preview)).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
