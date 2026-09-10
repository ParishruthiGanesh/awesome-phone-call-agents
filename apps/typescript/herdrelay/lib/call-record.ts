/** Normalize a CALL-E response into the one shape the rest of the app reads. */
import type { Call } from "@call-e/calle";
import type { CallRecord, TranscriptTurn } from "./types";

export function normalizeCall(call: Call): CallRecord {
  // One caretaker per incident, so the first recipient's latest attempt is the call.
  const recipient = call.recipients[0] ?? null;
  const attempt = recipient?.attempts.at(-1) ?? null;

  const transcript: TranscriptTurn[] = (attempt?.transcriptTurns ?? []).map((turn) => ({
    offsetSeconds: turn.offset_seconds,
    speaker: turn.speaker,
    text: turn.text,
  }));

  return {
    callId: call.id,
    status: call.status,
    attemptStatus: attempt?.status ?? null,
    summary: call.summary ?? recipient?.summary ?? null,
    taskCompleted: call.taskCompleted,
    completionConfidence: call.completionConfidence
      ? { score: call.completionConfidence.score, label: call.completionConfidence.label }
      : null,
    taskEvidence: call.evidence ?? [],
    transcript,
    // Prefer the task-level result and fall back to the recipient-level one, so
    // a run configured with `recipientResultSchema` still renders.
    structuredResult: call.structuredResult ?? recipient?.structuredResult ?? null,
    // The attempt-level code says what happened on the wire (`486`, `603`); the
    // call-level code is a roll-up that mostly restates `status`.
    failureCode: attempt?.failureCode ?? call.failureCode ?? null,
    failureMessage: attempt?.failureMessage ?? call.failureMessage ?? null,
    createdAt: call.createdAt,
    completedAt: call.completedAt,
  };
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "canceled"]);

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Did the person on the other end actually say anything? */
export function hasCaretakerSpeech(call: CallRecord | null): boolean {
  return (call?.transcript ?? []).some((turn) => turn.speaker === "user" && turn.text.trim() !== "");
}

/** `134` becomes `02:14`. */
export function formatOffset(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const whole = Math.floor(seconds);
  const mm = String(Math.floor(whole / 60)).padStart(2, "0");
  const ss = String(whole % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export type CallDiagnosis = { reason: string; hint: string; code: string | null; raw: string | null };

/**
 * Why a call did not produce a conversation, in the operator's language.
 *
 * The provider's own words are kept in `raw` and never rendered as prose:
 * CALL-E reports a blocked call as `DECLINED (Hangup by: user)`, where "user"
 * is the SIP endpoint rather than a person, and printing that sentence would
 * accuse a caretaker of hanging up on a call a carrier filter never let ring.
 */
export function callDiagnosis(call: CallRecord): CallDiagnosis | null {
  const code = call.failureCode;
  const raw = call.failureMessage;
  if (!code && !raw) return null;

  const signal = `${code ?? ""} ${raw ?? ""}`.toLowerCase();
  const base = { code, raw };

  if (/voicemail|machine/.test(signal)) {
    return {
      ...base,
      reason: "The call reached voicemail rather than a person.",
      hint: "HerdRelay leaves no message: an alert nobody has heard is not coordination. Reach the caretaker another way.",
    };
  }
  if (/\b603\b|declined/.test(signal)) {
    return {
      ...base,
      reason: "The receiving phone rejected the call before it rang.",
      hint: "Usually a carrier spam filter, Do Not Disturb, or silence-unknown-callers. Allow the CALL-E number on the caretaker's phone.",
    };
  }
  if (/\b486\b|busy/.test(signal)) {
    return { ...base, reason: "The line was busy.", hint: "The number is fine. A person can try again shortly." };
  }
  if (/\b(408|480)\b|no[_ ]?answer|timeout/.test(signal)) {
    return {
      ...base,
      reason: "The call rang out with no answer.",
      hint: "The number is reachable. Nobody picked up, so nothing about the animal is known.",
    };
  }
  if (/\b(404|484|604)\b|invalid|unallocated|not[_ ]?in[_ ]?service/.test(signal)) {
    return {
      ...base,
      reason: "The carrier could not route the call to that number.",
      hint: "Check HERDRELAY_AUTHORIZED_E164. It must be a dialable E.164 number.",
    };
  }
  return {
    ...base,
    reason: "The call did not connect, and the carrier gave no reason HerdRelay recognises.",
    hint: "The provider's own code is shown above so it can be looked up.",
  };
}
