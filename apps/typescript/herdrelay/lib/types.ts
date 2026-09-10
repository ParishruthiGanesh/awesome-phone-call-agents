/**
 * Domain types for HerdRelay.
 *
 * Everything CALL-E returns is normalized into these shapes at the
 * `lib/call-record.ts` boundary, so no component imports the provider's wire
 * format or its API client.
 */

/** Just the environment variables, as a map. Narrower than `Env`. */
export type Env = Record<string, string | undefined>;

// ---------------------------------------------------------------------------
// The monitoring alert
// ---------------------------------------------------------------------------

export type AlertSeverity = "low" | "moderate" | "high";

/**
 * One abnormal-respiration alert from the barn monitoring system.
 *
 * `synthetic` is on the record rather than in the UI layer on purpose: every
 * screen and every export that shows a measurement has to be able to say, from
 * the data alone, that the measurement was generated for a demonstration.
 * HerdRelay has never been connected to a real camera or collar.
 */
export type LivestockAlert = {
  id: string;
  animalId: string;
  /** Pen or barn location, as the caretaker would be told it on the phone. */
  location: string;
  detectedAt: string;
  sensorId: string;
  /** Breaths per minute observed by the monitoring system. */
  observedRespiratoryRate: number;
  /** The herd's normal range for this animal class, in breaths per minute. */
  baselineRange: { min: number; max: number };
  /** The monitoring system's own confidence in the detection, 0 to 1. */
  confidence: number;
  severity: AlertSeverity;
  /** One or two sentences describing what the monitoring system saw. */
  evidenceSummary: string;
  /** Always true. HerdRelay ships no path that ingests real animal data. */
  synthetic: true;
};

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

/** Mirrors CALL-E's `CallStatus`. */
export type CallStatus = "queued" | "in_progress" | "completed" | "failed" | "canceled";

/** Mirrors CALL-E's `AttemptStatus`. */
export type AttemptStatus =
  | "queued"
  | "dialing"
  | "in_progress"
  | "completed"
  | "failed"
  | "canceled";

export type TranscriptTurn = {
  offsetSeconds: number | null;
  speaker: "bot" | "user" | "unknown";
  text: string;
};

/** The provider read, normalized. Never contains an unmasked phone number. */
export type CallRecord = {
  callId: string;
  status: CallStatus;
  attemptStatus: AttemptStatus | null;
  summary: string | null;
  taskCompleted: boolean | null;
  completionConfidence: { score: number; label: string } | null;
  taskEvidence: string[];
  transcript: TranscriptTurn[];
  structuredResult: Record<string, unknown> | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

// ---------------------------------------------------------------------------
// The structured result
// ---------------------------------------------------------------------------

export type VisibleDistress = "yes" | "no" | "unknown";

export type CoordinationOutcome =
  | "inspection_confirmed"
  | "followup_requested"
  | "declined"
  | "unanswered"
  | "uncertain";

/**
 * The strict shape CALL-E is asked to return, and the only shape the result
 * screen reads. Nullable fields stay null when the caretaker did not say:
 * an unstated answer is never rounded to `false`.
 */
export type CaretakerResult = {
  inspectionAccepted: boolean | null;
  estimatedArrivalMinutes: number | null;
  visibleDistress: VisibleDistress;
  veterinaryFollowupRequested: boolean | null;
  caretakerNotes: string | null;
  outcome: CoordinationOutcome;
  humanReviewRequired: boolean;
};

/** Why validation changed, or refused to trust, part of a returned result. */
export type ResultAdjustment = {
  field: string;
  reason: string;
};

/**
 * A provider result after validation.
 *
 * `result` is always a complete `CaretakerResult`, because every failure mode
 * has a safe reading: a missing field, an unparseable field, or two fields that
 * contradict each other all resolve to `uncertain` with human review required.
 * `adjustments` is what validation had to do to get there, and it is rendered,
 * so a downgrade is never silent.
 */
export type ValidatedResult = {
  result: CaretakerResult;
  adjustments: ResultAdjustment[];
  /** False when the provider returned nothing usable at all. */
  providerReturnedResult: boolean;
};

/** What a human should do next. Advisory only; HerdRelay acts on none of it. */
export type CoordinationStatus =
  | "caretaker_inspecting"
  | "awaiting_human_escalation"
  | "needs_human_recontact"
  | "no_coordination_established";

// ---------------------------------------------------------------------------
// The incident
// ---------------------------------------------------------------------------

/**
 * Where an incident is in the workflow. `calling` covers the window between
 * "we asked CALL-E to dial" and "CALL-E told us an attempt exists", which is
 * exactly the window in which a retry would double-dial.
 */
export type IncidentPhase =
  | "planned"
  | "approved"
  | "calling"
  | "in_progress"
  | "completed"
  | "failed"
  | "unanswered"
  | "uncertain";

export type CallMode = "dry_run" | "live";

/**
 * The exact call an operator approved.
 *
 * `previewFingerprint` is a hash of the preview that was on screen. The start
 * endpoint recomputes it and refuses to dial when it differs, so an approval
 * can never be spent on a call whose task, questions, or destination changed
 * after it was shown.
 */
export type Approval = {
  approvedAt: string;
  operatorId: string;
  previewFingerprint: string;
  recipientMasked: string;
  mode: CallMode;
  /** Approvals go stale; a long-forgotten one must not still dial. */
  expiresAt: string;
};

export type TimelineEntry = {
  at: string;
  /** Machine-readable step, used for the timeline rail. */
  step:
    | "alert_received"
    | "call_prepared"
    | "approved"
    | "dialing"
    | "call_connected"
    | "call_ended"
    | "result_validated"
    | "reset";
  detail: string;
};

export type CreateState = "creating" | "accepted" | "ambiguous";

export type Incident = {
  id: string;
  alert: LivestockAlert;
  createdAt: string;
  mode: CallMode;
  phase: IncidentPhase;
  /** The scripted outcome a dry run plays back. Null in live mode. */
  dryRunScenario: string | null;
  approval: Approval | null;
  callId: string | null;
  call: CallRecord | null;
  createState: CreateState | null;
  validated: ValidatedResult | null;
  coordinationStatus: CoordinationStatus | null;
  humanReviewRequired: boolean;
  timeline: TimelineEntry[];
};

// ---------------------------------------------------------------------------
// The approval preview
// ---------------------------------------------------------------------------

/**
 * Everything an operator sees before authorizing, and nothing they do not.
 * This object is what gets hashed into `Approval.previewFingerprint`, so the
 * fields here are precisely the ones an operator is held to have agreed to.
 */
export type CallPreview = {
  incidentId: string;
  mode: CallMode;
  recipientMasked: string;
  caretakerName: string;
  purpose: string;
  disclosure: string;
  questions: string[];
  expectedData: string[];
  limitations: string[];
  /** The verbatim brief CALL-E will be given. Shown in full, never elided. */
  task: string;
  fingerprint: string;
};
