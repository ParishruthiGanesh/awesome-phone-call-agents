import { test } from "node:test";
import assert from "node:assert/strict";
import { coordinationStatus, coordinationView, incidentPhase, looksUnanswered } from "../lib/coordination";
import type { CallRecord, CaretakerResult } from "../lib/types";

const confirmed: CaretakerResult = {
  inspectionAccepted: true,
  estimatedArrivalMinutes: 20,
  visibleDistress: "unknown",
  veterinaryFollowupRequested: false,
  caretakerNotes: null,
  outcome: "inspection_confirmed",
  humanReviewRequired: false,
};

const call: CallRecord = {
  callId: "call_test",
  status: "completed",
  attemptStatus: "completed",
  summary: null,
  taskCompleted: true,
  completionConfidence: null,
  taskEvidence: [],
  transcript: [],
  structuredResult: null,
  failureCode: null,
  failureMessage: null,
  createdAt: "2026-04-12T05:44:00.000Z",
  completedAt: "2026-04-12T05:46:00.000Z",
};

test("a confirmed inspection is the only status that needs nobody", () => {
  assert.equal(coordinationStatus(confirmed), "caretaker_inspecting");
  assert.equal(coordinationView(confirmed).tone, "green");
});

test("a requested follow-up waits for a person, and says nobody has been contacted", () => {
  const requested = { ...confirmed, veterinaryFollowupRequested: true, outcome: "followup_requested" as const };
  assert.equal(coordinationStatus(requested), "awaiting_human_escalation");
  assert.match(coordinationView(requested).detail, /HerdRelay has contacted nobody else/);
});

test("a vet request outranks a confirmed inspection, because it is the part a person must decide", () => {
  assert.equal(
    coordinationStatus({ ...confirmed, veterinaryFollowupRequested: true }),
    "awaiting_human_escalation",
  );
});

test("declined and uncertain both end with a human, and unanswered establishes nothing", () => {
  assert.equal(coordinationStatus({ ...confirmed, inspectionAccepted: false, outcome: "declined" }), "needs_human_recontact");
  assert.equal(coordinationStatus({ ...confirmed, outcome: "uncertain" }), "needs_human_recontact");
  assert.equal(coordinationStatus({ ...confirmed, outcome: "unanswered" }), "no_coordination_established");
  assert.match(coordinationView({ ...confirmed, outcome: "unanswered" }).detail, /still unverified/);
});

test("a confirmed inspection without an arrival time says so instead of implying one", () => {
  assert.match(coordinationView({ ...confirmed, estimatedArrivalMinutes: null }).detail, /gave no arrival time/);
});

test("the phase follows the provider, and no result means uncertain rather than complete", () => {
  assert.equal(incidentPhase(null, null), "approved");
  assert.equal(incidentPhase({ ...call, status: "queued" }, null), "calling");
  assert.equal(incidentPhase({ ...call, status: "in_progress" }, null), "in_progress");
  assert.equal(incidentPhase(call, null), "uncertain");
  assert.equal(incidentPhase(call, confirmed), "completed");
  assert.equal(incidentPhase(call, { ...confirmed, outcome: "uncertain" }), "uncertain");
  assert.equal(incidentPhase(call, { ...confirmed, outcome: "unanswered" }), "unanswered");
});

test("a rung-out or voicemailed call is unanswered, and everything else that fails is failed", () => {
  const failed = { ...call, status: "failed" as const };
  assert.equal(incidentPhase({ ...failed, failureCode: "no_answer" }, null), "unanswered");
  assert.equal(incidentPhase({ ...failed, failureMessage: "VOICEMAIL (machine detected)" }, null), "unanswered");
  assert.equal(incidentPhase({ ...failed, failureCode: "call_failed", failureMessage: "603 DECLINED" }, null), "failed");
  assert.equal(looksUnanswered({ ...failed, failureCode: "486" }), true);
  assert.equal(looksUnanswered(failed), false);
});
