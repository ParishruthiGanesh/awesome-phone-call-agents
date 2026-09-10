/**
 * The workflow: alert, preview, approval, one call, validated result.
 *
 * Every state change goes through this module, and every state change that
 * could make a phone ring is taken under the incident lock. The order inside
 * `placeCall` is deliberate and is the part worth reading twice: validate the
 * approval, resolve the destination, build the client, reserve the number,
 * record that a create is in flight, and only then send. If any of that fails,
 * nothing has been dialed. If the send itself fails, HerdRelay does not know
 * whether a phone rang, so it stops and says so rather than retrying.
 */
import { findAlert } from "./alerts";
import { buildResultSchema, buildTask } from "./calle";
import { calleClient } from "./calle";
import { hasCaretakerSpeech, normalizeCall } from "./call-record";
import { coordinationStatus, incidentPhase } from "./coordination";
import { DryRunProviderFailure, loadScenario, simulateProgress, SIMULATED_DURATION_MS } from "./dry-run";
import { callMode, dryRunScenario, isDryRunScenario } from "./mode";
import type { Operator } from "./operators";
import { buildPreview, NotDialable, previewContext, type PreviewContext } from "./preview";
import { redact } from "./redact";
import { validateResult } from "./result";
import {
  appendTimeline,
  findOpenIncidentForAlert,
  getIncident,
  IncidentConflict,
  newIncidentId,
  releaseDestination,
  reserveDestination,
  saveIncident,
  updateIncident,
  withIncidentLock,
} from "./store";
import type { CallPreview, CallRecord, Incident, TimelineEntry, Env } from "./types";

export class WorkflowError extends Error {
  constructor(message: string, public status: number, public ambiguous = false) {
    super(message);
  }
}

/** An approval goes stale. A forgotten tab must not still be able to dial. */
export const APPROVAL_TTL_MS = 10 * 60_000;

export const AMBIGUOUS_MESSAGE =
  "HerdRelay does not know whether this call was placed. Calling is halted for this incident and for this caretaker. Reconcile it with the CALL-E call ID before anything else; do not start another call.";

// ---------------------------------------------------------------------------
// Preparing
// ---------------------------------------------------------------------------

export async function prepareIncident(alertId: string, requestedScenario?: string): Promise<Incident> {
  const alert = await findAlert(alertId);
  if (!alert) throw new WorkflowError("Unknown alert.", 404);

  const open = await findOpenIncidentForAlert(alertId);
  if (open) {
    throw new WorkflowError(
      `Alert ${alert.animalId} already has an incident in progress (${open.phase}). Open it instead of starting a second one.`,
      409,
    );
  }

  const mode = callMode();
  const incident: Incident = {
    id: newIncidentId(),
    alert,
    createdAt: new Date().toISOString(),
    mode,
    phase: "planned",
    dryRunScenario:
      mode === "dry_run"
        ? isDryRunScenario(requestedScenario)
          ? requestedScenario
          : dryRunScenario()
        : null,
    approval: null,
    callId: null,
    call: null,
    createState: null,
    validated: null,
    coordinationStatus: null,
    humanReviewRequired: true,
    timeline: [
      {
        at: new Date().toISOString(),
        step: "alert_received",
        detail: `Synthetic alert for ${alert.animalId} at ${alert.location}: ${alert.observedRespiratoryRate} breaths/min against a ${alert.baselineRange.min}–${alert.baselineRange.max} baseline.`,
      },
      {
        at: new Date().toISOString(),
        step: "call_prepared",
        detail: "Call task prepared. Nothing has been dialed; approval is required.",
      },
    ],
  };
  return saveIncident(incident);
}

/** The preview as it stands right now, for this incident and this configuration. */
export function previewFor(incident: Incident, env: Env = process.env): CallPreview {
  const context = previewContext(env);
  return buildPreview(incident.id, incident.alert, context);
}

// ---------------------------------------------------------------------------
// Approving
// ---------------------------------------------------------------------------

/**
 * Record that an operator approved one exact call.
 *
 * The fingerprint the browser sends must match the one this process computes
 * now. A mismatch means the preview on screen is not the call that would be
 * placed — a changed caretaker number, a changed mode, an edited brief — and
 * that is a refusal, not a warning.
 */
export async function approveIncident(
  id: string,
  fingerprint: string,
  operator: Operator,
): Promise<{ incident: Incident; preview: CallPreview }> {
  return withIncidentLock(id, async () => {
    const incident = await requireIncident(id);
    if (incident.callId || incident.createState) {
      throw new WorkflowError("This incident already has a call. It cannot be approved again.", 409);
    }
    const preview = previewFor(incident);
    if (preview.fingerprint !== fingerprint) {
      throw new WorkflowError(
        "The call changed since it was previewed. Review the new preview and approve that instead.",
        409,
      );
    }
    const now = Date.now();
    const approved = await saveIncident({
      ...incident,
      phase: "approved",
      mode: preview.mode,
      approval: {
        approvedAt: new Date(now).toISOString(),
        operatorId: operator.id,
        operatorName: operator.name,
        operatorShared: operator.shared,
        previewFingerprint: preview.fingerprint,
        recipientMasked: preview.recipientMasked,
        mode: preview.mode,
        expiresAt: new Date(now + APPROVAL_TTL_MS).toISOString(),
      },
    });
    const withTimeline = await appendTimeline(approved, {
      step: "approved",
      detail:
        preview.mode === "live"
          ? `${operator.name} authorized one real call to ${preview.recipientMasked}.`
          : `${operator.name} approved one simulated call to ${preview.recipientMasked}. Dry run: no phone will ring.`,
    });
    return { incident: withTimeline, preview };
  });
}

// ---------------------------------------------------------------------------
// Calling
// ---------------------------------------------------------------------------

export async function placeCall(id: string, operator: Operator): Promise<Incident> {
  return withIncidentLock(id, async () => {
    const incident = await requireIncident(id);

    // Duplicate protection: an incident that already has a call is finished
    // being started, whatever the browser thinks.
    if (incident.callId) return incident;
    if (incident.createState) throw new WorkflowError(AMBIGUOUS_MESSAGE, 409, true);

    const approval = incident.approval;
    if (!approval) throw new WorkflowError("Approve the exact call before it can be placed.", 403);
    if (approval.operatorId !== operator.id) {
      throw new WorkflowError(
        `This call was approved by ${approval.operatorName}. Only they can place it.`,
        403,
      );
    }
    if (!Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= Date.now()) {
      throw new WorkflowError("The approval has expired. Review the preview and approve it again.", 403);
    }

    let context: PreviewContext;
    try {
      context = previewContext();
    } catch (error) {
      throw new WorkflowError(
        error instanceof NotDialable ? error.message : "The call destination is not configured.",
        503,
      );
    }

    const preview = buildPreview(incident.id, incident.alert, context);
    if (preview.fingerprint !== approval.previewFingerprint) {
      throw new WorkflowError(
        "The call no longer matches what was approved. Approve the current preview instead.",
        409,
      );
    }
    if (context.mode !== approval.mode) {
      throw new WorkflowError("The call mode changed after approval. Approve the current preview instead.", 409);
    }

    return context.mode === "dry_run"
      ? startDryRun(incident, context)
      : startLiveCall(incident, context);
  });
}

async function startDryRun(incident: Incident, context: PreviewContext): Promise<Incident> {
  const phone = context.destination.phone;
  const scenario = isDryRunScenario(incident.dryRunScenario) ? incident.dryRunScenario : dryRunScenario();

  // Reserved even in dry run: the duplicate-protection path is the one thing a
  // rehearsal most needs to rehearse.
  await reserveDestination(phone, incident.id);
  await updateIncident(incident.id, { createState: "creating" });

  let fixture;
  try {
    fixture = await loadScenario(scenario);
  } catch (error) {
    if (error instanceof DryRunProviderFailure) {
      const halted = await updateIncident(incident.id, { createState: "ambiguous", phase: "failed" });
      await appendTimeline(halted!, {
        step: "call_ended",
        detail: `Simulated provider failure. ${AMBIGUOUS_MESSAGE}`,
      });
      throw new WorkflowError(AMBIGUOUS_MESSAGE, 502, true);
    }
    throw error;
  }

  const startedAt = new Date().toISOString();
  const simulated = simulateProgress({ ...fixture.call, createdAt: startedAt }, 0);
  const record: CallRecord = {
    ...normalizeCall(simulated),
    callId: `${fixture.call.id}_${incident.id.slice(0, 8)}`,
    createdAt: startedAt,
  };

  const started = await saveIncident({
    ...incident,
    callId: record.callId,
    call: record,
    createState: "accepted",
    phase: "calling",
  });
  return appendTimeline(started, {
    step: "dialing",
    detail: `Simulated call to ${context.destination.masked} started. Scenario: ${scenario}. No phone is ringing.`,
  });
}

async function startLiveCall(incident: Incident, context: PreviewContext): Promise<Incident> {
  const { phone, region, locale, masked } = context.destination;

  // Build the client first: a missing or misconfigured credential must fail
  // before anything is reserved and long before anything is sent.
  const client = calleClient();

  await reserveDestination(phone, incident.id);
  await updateIncident(incident.id, { createState: "creating" });

  try {
    const call = await client.calls.create(
      {
        task: buildTask(incident.alert, {
          siteName: context.siteName,
          caretakerName: context.caretakerName,
        }),
        recipients: [{ phones: [phone], region, locale }],
        resultSchema: buildResultSchema(),
        metadata: { app: "herdrelay", incident_id: incident.id, alert_id: incident.alert.id },
      },
      { idempotencyKey: `herdrelay:${incident.id}` },
    );
    verifyCall(call, incident, phone);
    const record = normalizeCall(call);
    const started = await saveIncident({
      ...incident,
      callId: record.callId,
      call: record,
      createState: "accepted",
      phase: incidentPhase(record, null),
    });
    return appendTimeline(started, {
      step: "dialing",
      detail: `CALL-E accepted one call to ${masked}. Call ID ${record.callId}.`,
    });
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    // Never repeat the POST, idempotency key or not: a timeout or an
    // unreadable response may already have dialed.
    await updateIncident(incident.id, { createState: "ambiguous", phase: "failed" }).catch(() => undefined);
    throw new WorkflowError(AMBIGUOUS_MESSAGE, 502, true);
  }
}

/** The provider's read must describe precisely the call this incident intended. */
export function verifyCall(
  call: { id: string; status: string; createdAt: string; metadata?: Record<string, unknown>; recipients?: { phones: string[]; region: string | null; attempts: { phone: string }[] }[] },
  incident: Incident,
  phone: string,
  expectedId?: string,
): void {
  const recipient = call.recipients?.[0];
  if (
    typeof call.id !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(call.id) ||
    !["queued", "in_progress", "completed", "failed", "canceled"].includes(call.status) ||
    !Number.isFinite(Date.parse(call.createdAt)) ||
    (expectedId !== undefined && call.id !== expectedId) ||
    call.metadata?.app !== "herdrelay" ||
    call.metadata?.incident_id !== incident.id ||
    call.recipients?.length !== 1 ||
    recipient?.phones.length !== 1 ||
    recipient.phones[0] !== phone ||
    recipient.attempts.some((attempt) => attempt.phone !== phone)
  ) {
    throw new WorkflowError("The provider's call does not match this incident and destination.", 409);
  }
}

// ---------------------------------------------------------------------------
// Polling and finalizing
// ---------------------------------------------------------------------------

export async function refreshIncident(id: string): Promise<Incident> {
  const incident = await requireIncident(id);
  if (!incident.callId || !incident.call) return incident;
  if (isFinished(incident)) return incident;

  const record =
    incident.mode === "dry_run"
      ? await readDryRunCall(incident)
      : await readLiveCall(incident);

  return finalize(incident, record);
}

async function readDryRunCall(incident: Incident): Promise<CallRecord> {
  const scenario = isDryRunScenario(incident.dryRunScenario) ? incident.dryRunScenario : dryRunScenario();
  const fixture = await loadScenario(scenario);
  const startedAt = Date.parse(incident.call!.createdAt);
  const elapsed = Number.isFinite(startedAt) ? Date.now() - startedAt : SIMULATED_DURATION_MS;
  const simulated = simulateProgress({ ...fixture.call, createdAt: incident.call!.createdAt }, elapsed);
  return { ...normalizeCall(simulated), callId: incident.callId!, createdAt: incident.call!.createdAt };
}

async function readLiveCall(incident: Incident): Promise<CallRecord> {
  try {
    const call = await calleClient().calls.get(incident.callId!);
    const context = previewContext();
    verifyCall(call, incident, context.destination.phone, incident.callId!);
    return normalizeCall(call);
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    throw new WorkflowError(
      `Could not read the call from CALL-E. ${redact(error instanceof Error ? error.message : "Unknown error.")}`,
      502,
    );
  }
}

/**
 * Fold one provider read into the incident.
 *
 * Validation runs against both the structured result and the transcript, so an
 * outcome that disagrees with what was actually said is caught here rather than
 * rendered as fact.
 */
export async function finalize(incident: Incident, record: CallRecord): Promise<Incident> {
  const terminal = ["completed", "failed", "canceled"].includes(record.status);
  const validated = terminal
    ? validateResult(record.structuredResult, { hasCaretakerSpeech: hasCaretakerSpeech(record) })
    : null;
  const phase = incidentPhase(record, validated?.result ?? null);

  const next: Incident = {
    ...incident,
    call: record,
    phase,
    validated,
    coordinationStatus: validated ? coordinationStatus(validated.result) : null,
    humanReviewRequired: validated ? validated.result.humanReviewRequired : true,
  };

  const entries: Omit<TimelineEntry, "at">[] = [];
  const wasConnected = incident.timeline.some((entry) => entry.step === "call_connected");
  if (!wasConnected && hasCaretakerSpeech(record)) {
    entries.push({ step: "call_connected", detail: "The caretaker answered and began speaking." });
  }
  if (terminal && !incident.timeline.some((entry) => entry.step === "call_ended")) {
    entries.push({
      step: "call_ended",
      detail: `Call ended with provider status ${record.status}.`,
    });
  }
  if (validated && !incident.timeline.some((entry) => entry.step === "result_validated")) {
    entries.push({
      step: "result_validated",
      detail: validated.adjustments.length
        ? `Result validated with ${validated.adjustments.length} correction${validated.adjustments.length === 1 ? "" : "s"}. Outcome recorded as ${validated.result.outcome}.`
        : `Result validated cleanly. Outcome recorded as ${validated.result.outcome}.`,
    });
  }

  let saved = await saveIncident(next);
  for (const entry of entries) saved = await appendTimeline(saved, entry);

  // The number is only released once the call's fate is known, so an
  // interrupted call keeps blocking a redial until a human resolves it.
  if (terminal) {
    const phone = safeDestinationPhone();
    if (phone) await releaseDestination(phone, incident.id);
  }
  return saved;
}

function safeDestinationPhone(): string | null {
  try {
    return previewContext().destination.phone;
  } catch {
    return null;
  }
}

/**
 * Attach a call an operator found in the CALL-E dashboard to an incident whose
 * create request never came back. Read-only against the provider: it can
 * resolve an unknown, it can never start anything.
 */
export async function reconcileIncident(id: string, callId: string): Promise<Incident> {
  return withIncidentLock(id, async () => {
    const incident = await requireIncident(id);
    if (incident.createState !== "ambiguous") {
      throw new WorkflowError("This incident has no unresolved call to reconcile.", 409);
    }
    if (incident.mode === "dry_run") {
      const resolved = await saveIncident({ ...incident, createState: null, phase: "failed" });
      const phone = safeDestinationPhone();
      if (phone) await releaseDestination(phone, incident.id);
      return appendTimeline(resolved, {
        step: "call_ended",
        detail: "Simulated failure acknowledged. The incident is closed without a call.",
      });
    }
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(callId)) throw new WorkflowError("Invalid CALL-E call ID.", 400);

    const context = previewContext();
    const call = await calleClient().calls.get(callId); // Read only; never creates.
    verifyCall(call, incident, context.destination.phone, callId);
    const record = normalizeCall(call);
    const attached = await saveIncident({
      ...incident,
      callId,
      call: record,
      createState: "accepted",
    });
    return finalize(attached, record);
  });
}

export function isFinished(incident: Incident): boolean {
  return ["completed", "failed", "unanswered", "uncertain"].includes(incident.phase);
}

async function requireIncident(id: string): Promise<Incident> {
  const incident = await getIncident(id);
  if (!incident) throw new WorkflowError("Unknown incident.", 404);
  return incident;
}

/** Map any thrown value onto a safe HTTP response body. */
export function workflowError(error: unknown): { error: string; status: number; ambiguous: boolean } {
  if (error instanceof WorkflowError) {
    return { error: redact(error.message), status: error.status, ambiguous: error.ambiguous };
  }
  if (error instanceof IncidentConflict) {
    return { error: redact(error.message), status: 409, ambiguous: true };
  }
  if (error instanceof NotDialable) {
    return { error: redact(error.message), status: 503, ambiguous: false };
  }
  // Provider exceptions can quote request bodies, and a request body here
  // contains a caretaker's number.
  return {
    error: "The action failed. Check the server configuration and reconcile any interrupted call.",
    status: 500,
    ambiguous: false,
  };
}
