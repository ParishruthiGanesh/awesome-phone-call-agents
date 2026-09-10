/**
 * The whole workflow, headless.
 *
 * Runs alert → preview → approval → call → validated result in one process, so
 * the safety behaviour can be exercised, and every scripted outcome inspected,
 * without a browser and without CALL-E credentials. Refuses to run in live
 * mode: this script approves its own call, and nothing that approves its own
 * call may ever dial a real phone.
 *
 *   npm run demo:dry-run -- --scenario=contradictory --alert=alert_c17_0412
 */
import { anonymousOperator } from "../lib/access";
import { loadAlerts } from "../lib/alerts";
import { scenarioLabels, SIMULATED_DURATION_MS } from "../lib/dry-run";
import {
  approveIncident,
  isFinished,
  placeCall,
  prepareIncident,
  previewFor,
  refreshIncident,
  WorkflowError,
} from "../lib/incident";
import { callMode } from "../lib/mode";
import { redact } from "../lib/redact";
import type { Incident } from "../lib/types";

/** The CLI acts as one named local operator, so its approvals are attributable too. */
const OPERATOR = { ...anonymousOperator(), name: "Command line operator" };

function flag(name: string, fallback: string): string {
  const match = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
}

function line(label: string, value: string): void {
  console.log(`${label.padEnd(26)} ${value}`);
}

async function main(): Promise<void> {
  if (callMode() === "live") {
    throw new Error(
      "This script is dry-run only. It approves its own call, so it refuses to run with HERDRELAY_MODE=live.",
    );
  }

  const scenario = flag("scenario", "inspection_confirmed");
  const labels = await scenarioLabels();
  if (!labels[scenario]) {
    throw new Error(`Unknown scenario ${scenario}. Available: ${Object.keys(labels).join(", ")}`);
  }

  const alerts = await loadAlerts();
  const alertId = flag("alert", alerts[0]?.id ?? "");
  const alert = alerts.find((candidate) => candidate.id === alertId);
  if (!alert) throw new Error(`Unknown alert ${alertId}.`);

  console.log("HerdRelay dry run. No call will be placed.\n");
  line("Scenario", `${scenario} — ${labels[scenario]}`);
  line("Animal", `${alert.animalId} at ${alert.location}`);
  line("Observed rate", `${alert.observedRespiratoryRate} breaths/min (baseline ${alert.baselineRange.min}-${alert.baselineRange.max})`);
  line("Confidence", `${Math.round(alert.confidence * 100)}%`);
  line("Severity", alert.severity);
  line("Data", "SYNTHETIC — generated for this demonstration");

  const prepared = await prepareIncident(alert.id, scenario);
  const preview = await previewFor(prepared);

  console.log("\n--- Call preview (what an operator approves) ---\n");
  line("Mode", preview.mode);
  line("Recipient", `${preview.recipientMasked} (${preview.caretakerName})`);
  line("Fingerprint", preview.fingerprint.slice(0, 32));
  console.log("\nDisclosure:\n  " + preview.disclosure);
  console.log("\nQuestions:");
  preview.questions.forEach((question, index) => console.log(`  ${index + 1}. ${question}`));
  console.log("\nLimitations:");
  preview.limitations.forEach((limit) => console.log(`  - ${limit}`));

  const { incident: approved } = await approveIncident(prepared.id, preview.fingerprint, OPERATOR);
  console.log(`\nApproved at ${approved.approval?.approvedAt}.`);

  let incident: Incident;
  try {
    incident = await placeCall(approved.id, OPERATOR);
  } catch (error) {
    if (error instanceof WorkflowError && error.ambiguous) {
      console.log("\n--- Halted ---\n");
      console.log(redact(error.message));
      return;
    }
    throw error;
  }
  console.log(`Simulated call ${incident.callId} started.\n`);

  const deadline = Date.now() + SIMULATED_DURATION_MS + 5_000;
  while (!isFinished(incident) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    incident = await refreshIncident(incident.id);
    process.stdout.write(`  phase: ${incident.phase.padEnd(12)}\r`);
  }
  console.log(`  phase: ${incident.phase}          \n`);

  console.log("--- Transcript ---\n");
  for (const turn of incident.call?.transcript ?? []) {
    const who = turn.speaker === "user" ? "CARETAKER" : turn.speaker === "bot" ? "HERDRELAY" : "UNKNOWN  ";
    console.log(`  [${String(turn.offsetSeconds ?? 0).padStart(3)}s] ${who}  ${turn.text}`);
  }
  if (!incident.call?.transcript.length) console.log("  (nothing was said on this call)");

  console.log("\n--- Structured result (validated) ---\n");
  console.log(JSON.stringify(incident.validated?.result ?? null, null, 2));

  if (incident.validated?.adjustments.length) {
    console.log("\nValidation notes:");
    for (const adjustment of incident.validated.adjustments) {
      console.log(`  - ${adjustment.field}: ${adjustment.reason}`);
    }
  }

  console.log("");
  line("Coordination status", incident.coordinationStatus ?? "none");
  line("Human review required", String(incident.humanReviewRequired));
  console.log("\nHerdRelay contacted nobody else and decided nothing. A person takes it from here.");
}

main().catch((error: unknown) => {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
