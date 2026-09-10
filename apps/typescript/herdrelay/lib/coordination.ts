/**
 * What a person should consider doing next.
 *
 * Advisory only. HerdRelay executes none of this: it does not call a vet, does
 * not redial, does not schedule, and does not change the animal's record. The
 * status exists so the operator reads one line instead of re-deriving it from
 * seven fields, and every branch that is not a plain confirmed inspection ends
 * with a human holding the decision.
 */
import type { CallRecord, CaretakerResult, CoordinationStatus, IncidentPhase } from "./types";

export type CoordinationView = {
  status: CoordinationStatus;
  label: string;
  detail: string;
  /** Traffic-light band for the operations console. */
  tone: "green" | "amber" | "red" | "neutral";
};

export function coordinationStatus(result: CaretakerResult): CoordinationStatus {
  if (result.veterinaryFollowupRequested === true || result.outcome === "followup_requested") {
    return "awaiting_human_escalation";
  }
  if (result.outcome === "inspection_confirmed" && result.inspectionAccepted === true) {
    return "caretaker_inspecting";
  }
  if (result.outcome === "unanswered") return "no_coordination_established";
  return "needs_human_recontact";
}

export function coordinationView(result: CaretakerResult): CoordinationView {
  const status = coordinationStatus(result);
  switch (status) {
    case "caretaker_inspecting":
      return {
        status,
        label: "Caretaker inspecting",
        detail:
          result.estimatedArrivalMinutes === null
            ? "The caretaker accepted the inspection but gave no arrival time. Confirm when they arrive."
            : `The caretaker accepted the inspection and expects to reach the animal in about ${result.estimatedArrivalMinutes} minutes.`,
        tone: "green",
      };
    case "awaiting_human_escalation":
      return {
        status,
        label: "Awaiting human escalation",
        detail:
          "The caretaker asked for veterinary or supervisor follow-up. A person at the farm decides whether to make that call. HerdRelay has contacted nobody else.",
        tone: "amber",
      };
    case "needs_human_recontact":
      return {
        status,
        label: "Needs human re-contact",
        detail:
          "Nothing was established firmly enough to rely on. Reach the caretaker directly; HerdRelay will not redial on its own.",
        tone: "red",
      };
    case "no_coordination_established":
      return {
        status,
        label: "No coordination established",
        detail:
          "Nobody was reached, so nothing about the animal is known. The alert is still open and still unverified.",
        tone: "red",
      };
  }
}

/**
 * The incident phase, derived from the provider read and the validated result.
 *
 * `unanswered` is kept apart from `failed` because they mean different things
 * to the operator: a call that rang out reached a phone that works, and a call
 * that failed may never have left the provider.
 */
export function incidentPhase(call: CallRecord | null, result: CaretakerResult | null): IncidentPhase {
  if (!call) return "approved";
  if (call.status === "queued") return "calling";
  if (call.status === "in_progress") return "in_progress";

  if (call.status === "failed" || call.status === "canceled") {
    return looksUnanswered(call) ? "unanswered" : "failed";
  }

  // completed
  if (!result) return "uncertain";
  if (result.outcome === "unanswered") return "unanswered";
  if (result.outcome === "uncertain") return "uncertain";
  return "completed";
}

/** A rung-out call, a busy line, or voicemail: reached a phone, reached no one. */
export function looksUnanswered(call: CallRecord): boolean {
  const signal = `${call.failureCode ?? ""} ${call.failureMessage ?? ""}`.toLowerCase();
  if (/\b(408|480|486)\b|no[_ ]?answer|voicemail|machine|busy|timeout/.test(signal)) return true;
  return false;
}

export const PHASE_LABELS: Record<IncidentPhase, string> = {
  planned: "Planned",
  approved: "Approved",
  calling: "Calling",
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed",
  unanswered: "Unanswered",
  uncertain: "Uncertain",
};

export const PHASE_TONES: Record<IncidentPhase, "green" | "amber" | "red" | "neutral"> = {
  planned: "neutral",
  approved: "amber",
  calling: "amber",
  in_progress: "amber",
  completed: "green",
  failed: "red",
  unanswered: "red",
  uncertain: "red",
};
