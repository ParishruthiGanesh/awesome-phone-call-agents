/**
 * The no-call path, and the default one.
 *
 * A dry run plays a hand-authored CALL-E response back through
 * `normalizeCall()` — the same boundary a live call crosses — so the dashboard
 * has exactly one render path and a rehearsal cannot drift away from what a
 * real call would show. No network request is made, no credential is read, and
 * no number is dialed.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Call } from "@call-e/calle";
import type { DryRunScenario } from "./mode";
import { syntheticDestination, type Destination } from "./phone";

const FIXTURES = path.join(process.cwd(), "fixtures");

/** How long a simulated call takes on screen. Real calls run about two minutes. */
export const SIMULATED_DURATION_MS = 14_000;

/** Before this, the call is queued: requested, not yet ringing. */
const QUEUED_MS = 1_800;

/**
 * The number a dry run pretends to dial.
 *
 * It is in the reserved NANP 555-01XX fictional range, which no carrier will
 * route, it is hard-coded here and only here, and it is never passed to the
 * CALL-E client. A live call ignores this entirely and uses the configured
 * caretaker number, which `destination()` requires to be genuinely routable —
 * so this number could not be dialed even if the modes were confused.
 */
export const DRY_RUN_PHONE = "+12025550142";

export function dryRunDestination(): Destination {
  return syntheticDestination(DRY_RUN_PHONE);
}

export class DryRunProviderFailure extends Error {}

type ScenarioFixture = { label: string; call: Call };

async function loadFixtures(): Promise<Record<string, ScenarioFixture>> {
  const raw = JSON.parse(await fs.readFile(path.join(FIXTURES, "dry-run-calls.json"), "utf8"));
  return (raw?.scenarios ?? {}) as Record<string, ScenarioFixture>;
}

export async function scenarioLabels(): Promise<Record<string, string>> {
  const fixtures = await loadFixtures();
  const labels = Object.fromEntries(
    Object.entries(fixtures).map(([name, fixture]) => [name, fixture.label]),
  );
  labels.provider_failure = "Provider error before the call is confirmed";
  return labels;
}

/**
 * The terminal state a scenario ends in.
 *
 * `provider_failure` deliberately has no fixture: it models the create request
 * that never comes back, where HerdRelay does not know whether a phone rang.
 * That case is not a call record, it is the absence of one, and it has to be
 * raised rather than rendered.
 */
export async function loadScenario(scenario: DryRunScenario): Promise<ScenarioFixture> {
  if (scenario === "provider_failure") {
    throw new DryRunProviderFailure(
      "Simulated provider timeout: the call request was sent and no response came back.",
    );
  }
  const fixtures = await loadFixtures();
  const fixture = fixtures[scenario];
  if (!fixture) throw new Error(`Unknown dry-run scenario: ${scenario}`);
  return fixture;
}

/**
 * The state of a simulated call `elapsedMs` after it started.
 *
 * Everything terminal is withheld until the end: no summary, no structured
 * result, no failure code, no completion confidence. A dry run that revealed
 * the outcome early would let the dashboard be built against information a real
 * call does not have yet.
 */
export function simulateProgress(terminal: Call, elapsedMs: number): Call {
  if (elapsedMs >= SIMULATED_DURATION_MS) return terminal;

  const recipient = terminal.recipients[0];
  const attempt = recipient?.attempts.at(-1);
  const turns = attempt?.transcriptTurns ?? [];
  const lastOffset = turns.at(-1)?.offset_seconds ?? 0;

  const queued = elapsedMs < QUEUED_MS;
  const fraction = Math.max(
    0,
    Math.min(1, (elapsedMs - QUEUED_MS) / (SIMULATED_DURATION_MS - QUEUED_MS)),
  );
  const playedUpTo = lastOffset * fraction;
  const played = queued ? [] : turns.filter((turn) => (turn.offset_seconds ?? 0) <= playedUpTo);

  return {
    ...terminal,
    status: queued ? "queued" : "in_progress",
    summary: null,
    structuredResult: null,
    taskCompleted: null,
    completionConfidence: null,
    evidence: [],
    failureCode: null,
    failureMessage: null,
    completedAt: null,
    recipients: recipient
      ? [
          {
            ...recipient,
            status: queued ? "pending" : "in_progress",
            structuredResult: null,
            summary: null,
            attempts: attempt
              ? [
                  {
                    ...attempt,
                    status: queued ? "queued" : "in_progress",
                    completedAt: null,
                    summary: null,
                    failureCode: null,
                    failureMessage: null,
                    transcriptTurns: played,
                  },
                ]
              : [],
          },
        ]
      : [],
  };
}
