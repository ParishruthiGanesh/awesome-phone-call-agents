/**
 * The workflow end to end, in dry run.
 *
 * These are the tests that matter most: they exercise the approval gate, the
 * duplicate protection, and the halt-on-unknown path against the same functions
 * the API routes call, with no CALL-E credentials and no phone.
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { anonymousOperator } from "../lib/access";
import {
  APPROVAL_TTL_MS,
  approveIncident,
  isFinished,
  placeCall,
  prepareIncident,
  previewFor,
  refreshIncident,
  reconcileIncident,
  WorkflowError,
} from "../lib/incident";
import { destinationKey, getIncident, listIncidents, readReservation, resetAll, saveIncident } from "../lib/store";
import { DRY_RUN_PHONE, SIMULATED_DURATION_MS } from "../lib/dry-run";
import { IncidentConflict } from "../lib/store";
import type { Incident } from "../lib/types";
import type { Env } from "../lib/types";

const ALERT = "alert_c17_0412";
const OPERATOR = { ...anonymousOperator({} as Env), name: "Marta Nowak" };
const CARETAKER = destinationKey(DRY_RUN_PHONE);

before(async () => {
  process.env.HERDRELAY_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "herdrelay-test-"));
  delete process.env.HERDRELAY_MODE;
});

beforeEach(async () => {
  await resetAll();
});

/** Run a placed dry-run call forward to its terminal state without waiting. */
async function fastForward(incident: Incident): Promise<Incident> {
  const started = new Date(Date.now() - SIMULATED_DURATION_MS - 1_000).toISOString();
  await saveIncident({ ...incident, call: { ...incident.call!, createdAt: started } });
  return refreshIncident(incident.id);
}

async function approvedIncident(scenario = "inspection_confirmed"): Promise<Incident> {
  const prepared = await prepareIncident(ALERT, scenario);
  const preview = previewFor(prepared);
  const { incident } = await approveIncident(prepared.id, preview.fingerprint, OPERATOR);
  return incident;
}

test("preparing an incident places no call and leaves nothing reserved", async () => {
  const incident = await prepareIncident(ALERT);
  assert.equal(incident.phase, "planned");
  assert.equal(incident.callId, null);
  assert.equal(incident.createState, null);
  assert.equal(await readReservation(CARETAKER), null);
  assert.deepEqual(incident.timeline.map((entry) => entry.step), ["alert_received", "call_prepared"]);
});

test("a call cannot be placed without an approval", async () => {
  const incident = await prepareIncident(ALERT);
  await assert.rejects(() => placeCall(incident.id, OPERATOR), (error: WorkflowError) => {
    assert.equal(error.status, 403);
    assert.match(error.message, /Approve the exact call/);
    return true;
  });
  assert.equal((await getIncident(incident.id))?.callId, null);
});

test("an approval carrying the wrong fingerprint is refused", async () => {
  const incident = await prepareIncident(ALERT);
  await assert.rejects(
    () => approveIncident(incident.id, "0".repeat(64), OPERATOR),
    /changed since it was previewed/,
  );
  assert.equal((await getIncident(incident.id))?.approval, null);
});

test("an approval from another operator cannot be spent", async () => {
  const incident = await approvedIncident();
  await assert.rejects(() => placeCall(incident.id, { id: "someone-else", name: "Sam Okonkwo", shared: false }), /Only they can place it/);
});

test("an expired approval will not dial", async () => {
  const incident = await approvedIncident();
  await saveIncident({
    ...incident,
    approval: { ...incident.approval!, expiresAt: new Date(Date.now() - APPROVAL_TTL_MS).toISOString() },
  });
  await assert.rejects(() => placeCall(incident.id, OPERATOR), /approval has expired/);
});

test("the approved call runs to a validated result, and the record holds no phone number", async () => {
  const approved = await approvedIncident();
  const placed = await placeCall(approved.id, OPERATOR);
  assert.equal(placed.phase, "calling");
  assert.equal(await readReservation(CARETAKER), approved.id);

  const finished = await fastForward(placed);
  assert.ok(isFinished(finished));
  assert.equal(finished.phase, "completed");
  assert.equal(finished.validated?.result.outcome, "inspection_confirmed");
  assert.equal(finished.coordinationStatus, "caretaker_inspecting");
  assert.equal(finished.humanReviewRequired, false);

  // Nothing stored anywhere in the incident can be used to redial.
  assert.equal(JSON.stringify(finished).includes(DRY_RUN_PHONE.slice(1)), false);
  assert.equal(JSON.stringify(finished).includes("2025550142"), false);

  // The number is free again only now that the call's fate is known.
  assert.equal(await readReservation(CARETAKER), null);
  assert.deepEqual(
    finished.timeline.map((entry) => entry.step),
    ["alert_received", "call_prepared", "approved", "dialing", "call_connected", "call_ended", "result_validated"],
  );
});

test("the approval and the timeline record which person authorized the call", async () => {
  const incident = await approvedIncident();
  assert.equal(incident.approval?.operatorName, "Marta Nowak");
  assert.equal(incident.approval?.operatorId, OPERATOR.id);
  const approved = incident.timeline.find((entry) => entry.step === "approved");
  assert.match(approved?.detail ?? "", /^Marta Nowak approved/);
});

test("placing the same approved call twice does not place a second call", async () => {
  const approved = await approvedIncident();
  const first = await placeCall(approved.id, OPERATOR);
  const second = await placeCall(approved.id, OPERATOR);
  assert.equal(second.callId, first.callId);
  assert.deepEqual(second.timeline.filter((entry) => entry.step === "dialing").length, 1);
});

test("an alert cannot be given a second incident while its first is live", async () => {
  const approved = await approvedIncident();
  await placeCall(approved.id, OPERATOR);
  await assert.rejects(() => prepareIncident(ALERT), /already has an incident in progress/);
  assert.equal((await listIncidents()).length, 1);
});

test("a finished call frees the caretaker, so the next animal can be called about", async () => {
  // The bug this pins: one messy incident used to hold the only caretaker on
  // the farm forever, blocking every other animal.
  const first = await approvedIncident();
  const finished = await fastForward(await placeCall(first.id, OPERATOR));
  assert.ok(isFinished(finished));
  assert.equal(await readReservation(CARETAKER), null);

  const second = await prepareIncident("alert_d22_0411");
  const preview = previewFor(second);
  await approveIncident(second.id, preview.fingerprint, OPERATOR);
  const placed = await placeCall(second.id, OPERATOR);
  assert.equal(placed.phase, "calling");
});

test("a reservation left behind by a finished incident is debris, and is taken over", async () => {
  const stale = await approvedIncident();
  await fastForward(await placeCall(stale.id, OPERATOR));
  // Simulate the marker surviving the incident that owned it.
  await saveIncident({ ...(await getIncident(stale.id))!, reservationKey: null });
  const revived = await getIncident(stale.id);
  assert.equal(isFinished(revived!), true);

  const next = await prepareIncident("alert_d22_0411");
  const preview = previewFor(next);
  await approveIncident(next.id, preview.fingerprint, OPERATOR);
  await assert.doesNotReject(() => placeCall(next.id, OPERATOR));
});

test("the caretaker is freed even if the configured number changes mid-incident", async () => {
  const incident = await approvedIncident();
  const placed = await placeCall(incident.id, OPERATOR);
  assert.equal(await readReservation(CARETAKER), incident.id);
  // Release must use the key stored at reserve time, not one re-derived now.
  const finished = await fastForward(placed);
  assert.ok(isFinished(finished));
  assert.equal(await readReservation(CARETAKER), null);
});

test("a blocked call names the incident holding the caretaker", async () => {
  const blocker = await approvedIncident("provider_failure");
  await placeCall(blocker.id, OPERATOR).catch(() => undefined);

  const other = await prepareIncident("alert_d22_0411");
  const preview = previewFor(other);
  await approveIncident(other.id, preview.fingerprint, OPERATOR);
  await assert.rejects(() => placeCall(other.id, OPERATOR), (error: IncidentConflict) => {
    assert.match(error.message, /unresolved call for animal C-17/);
    assert.equal(error.blockingIncidentId, blocker.id);
    return true;
  });

  // Resolving the blocker frees the caretaker for the next animal.
  await reconcileIncident(blocker.id, "");
  await assert.doesNotReject(() => placeCall(other.id, OPERATOR));
});

test("a call still in flight holds the caretaker, whatever the animal", async () => {
  const approved = await approvedIncident();
  await placeCall(approved.id, OPERATOR); // in flight, not finished
  // A different alert, the same caretaker: the reservation is on the person.
  const other = await prepareIncident("alert_d22_0411");
  const preview = previewFor(other);
  await approveIncident(other.id, preview.fingerprint, OPERATOR);
  await assert.rejects(() => placeCall(other.id, OPERATOR), /unresolved call for animal C-17/);
});

test("an unknown provider outcome halts calling instead of retrying", async () => {
  const approved = await approvedIncident("provider_failure");
  await assert.rejects(() => placeCall(approved.id, OPERATOR), (error: WorkflowError) => {
    assert.equal(error.ambiguous, true);
    assert.match(error.message, /does not know whether this call was placed/);
    return true;
  });

  const halted = await getIncident(approved.id);
  assert.equal(halted?.createState, "ambiguous");
  assert.equal(halted?.phase, "failed");
  // The reservation is deliberately still held: the number is not free to redial.
  assert.equal(await readReservation(CARETAKER), approved.id);

  // And a retry is refused rather than quietly re-sent.
  await assert.rejects(() => placeCall(approved.id, OPERATOR), /does not know whether this call was placed/);
});

test("reconciling an unknown outcome closes it and frees the caretaker", async () => {
  const approved = await approvedIncident("provider_failure");
  await placeCall(approved.id, OPERATOR).catch(() => undefined);
  const closed = await reconcileIncident(approved.id, "");
  assert.equal(closed.createState, null);
  assert.equal(closed.phase, "failed");
  assert.equal(await readReservation(CARETAKER), null);
});

test("a scenario whose answers contradict the transcript ends uncertain, not confirmed", async () => {
  const approved = await approvedIncident("contradictory");
  const finished = await fastForward(await placeCall(approved.id, OPERATOR));
  assert.equal(finished.phase, "uncertain");
  assert.equal(finished.validated?.result.outcome, "uncertain");
  assert.equal(finished.humanReviewRequired, true);
  assert.ok(finished.validated!.adjustments.length > 0);
});

test("a call nobody answered establishes nothing and says nothing was established", async () => {
  const approved = await approvedIncident("unanswered");
  const finished = await fastForward(await placeCall(approved.id, OPERATOR));
  assert.equal(finished.phase, "unanswered");
  assert.equal(finished.validated?.providerReturnedResult, false);
  assert.equal(finished.validated?.result.inspectionAccepted, null);
  assert.equal(finished.coordinationStatus, "no_coordination_established");
});

test("resetting clears every incident, lock, and reservation", async () => {
  const approved = await approvedIncident();
  await placeCall(approved.id, OPERATOR);
  await resetAll();
  assert.deepEqual(await listIncidents(), []);
  assert.equal(await readReservation(CARETAKER), null);
});
