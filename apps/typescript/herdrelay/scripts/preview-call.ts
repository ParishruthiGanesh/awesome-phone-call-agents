/**
 * Print the exact call, and only with `--authorize`, place it.
 *
 * The default path is read-only in every mode: it builds the preview, prints
 * the masked destination, the disclosure, the five questions and the verbatim
 * brief, and exits. Nothing is reserved and nothing is sent.
 *
 * With `--authorize`, and only in live mode with an authorized caretaker
 * number configured, it places one real CALL-E call and polls it to
 * completion. That is a real phone ringing for a real person: run it only when
 * that person is expecting it.
 *
 *   npm run call:preview -- --alert=alert_c17_0412
 *   npm run call:authorize -- --alert=alert_c17_0412
 */
import { anonymousOperator } from "../lib/access";
import { loadAlerts } from "../lib/alerts";
import {
  approveIncident,
  isFinished,
  placeCall,
  prepareIncident,
  previewFor,
  refreshIncident,
  WorkflowError,
} from "../lib/incident";
import { callMode, liveReadiness } from "../lib/mode";
import { redact } from "../lib/redact";
import type { Incident } from "../lib/types";

/** The CLI acts as one named local operator, so its approvals are attributable too. */
const OPERATOR = { ...anonymousOperator(), name: "Command line operator" };

function flag(name: string, fallback: string): string {
  const match = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
}

const AUTHORIZE = process.argv.includes("--authorize");
const POLL_TIMEOUT_MS = 6 * 60_000;

async function main(): Promise<void> {
  const alerts = await loadAlerts();
  const alertId = flag("alert", alerts[0]?.id ?? "");
  const alert = alerts.find((candidate) => candidate.id === alertId);
  if (!alert) throw new Error(`Unknown alert ${alertId}. Known: ${alerts.map((a) => a.id).join(", ")}`);

  const mode = callMode();
  const incident = await prepareIncident(alert.id);
  const preview = await previewFor(incident);

  console.log(`Mode:        ${mode}`);
  console.log(`Alert:       ${alert.animalId} at ${alert.location} (SYNTHETIC data)`);
  console.log(`Recipient:   ${preview.recipientMasked}  ${preview.caretakerName}`);
  console.log(`Fingerprint: ${preview.fingerprint}`);
  console.log(`\nDisclosure:\n  ${preview.disclosure}`);
  console.log(`\nQuestions:`);
  preview.questions.forEach((question, index) => console.log(`  ${index + 1}. ${question}`));
  console.log(`\nExpected data:`);
  preview.expectedData.forEach((item) => console.log(`  - ${item}`));
  console.log(`\nLimitations:`);
  preview.limitations.forEach((item) => console.log(`  - ${item}`));
  console.log(`\n--- Verbatim brief ---\n${preview.task}\n`);

  if (!AUTHORIZE) {
    console.log("Preview only. No call was placed and nothing was reserved.");
    console.log("Re-run with --authorize in live mode to place one real call.");
    return;
  }

  if (mode !== "live") {
    throw new Error("--authorize requires HERDRELAY_MODE=live. Use `npm run demo:dry-run` to rehearse.");
  }
  const readiness = liveReadiness();
  if (!readiness.ready) throw new Error(readiness.reason);

  console.log(`AUTHORIZING ONE REAL CALL to ${preview.recipientMasked}.`);
  console.log("This will ring a real phone. It cannot be un-placed.\n");

  const { incident: approved } = await approveIncident(incident.id, preview.fingerprint, OPERATOR);

  let current: Incident;
  try {
    current = await placeCall(approved.id, OPERATOR);
  } catch (error) {
    if (error instanceof WorkflowError && error.ambiguous) {
      console.error(`\n${redact(error.message)}`);
      console.error(`Incident: ${approved.id}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  console.log(`CALL-E call ${current.callId} accepted. Polling…`);
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (!isFinished(current) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    current = await refreshIncident(current.id);
    console.log(`  phase: ${current.phase}`);
  }

  if (!isFinished(current)) {
    console.error("\nPolling timed out. The call may still be running; read it with the incident ID above.");
    process.exitCode = 1;
    return;
  }

  console.log("\n--- Structured result (validated) ---\n");
  console.log(JSON.stringify(current.validated?.result ?? null, null, 2));
  for (const adjustment of current.validated?.adjustments ?? []) {
    console.log(`  note: ${adjustment.field}: ${adjustment.reason}`);
  }
  console.log(`\nCoordination status:   ${current.coordinationStatus ?? "none"}`);
  console.log(`Human review required: ${current.humanReviewRequired}`);
}

main().catch((error: unknown) => {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
