/**
 * Structured-result validation.
 *
 * The provider is asked for a strict object; this module is what decides
 * whether to believe it. Two rules drive everything here:
 *
 *   1. Uncertainty survives. An answer the caretaker did not give stays `null`
 *      or `"unknown"`. Nothing in this file turns "I could not tell" into a
 *      `false`, and nothing turns a missing field into a default.
 *   2. Contradictions fail closed. When the outcome disagrees with the fields
 *      it summarizes, or with the transcript, the result is downgraded to
 *      `uncertain` with human review required, and the reason is recorded so
 *      the downgrade is visible on screen rather than silent.
 */
import type {
  CaretakerResult,
  CoordinationOutcome,
  ResultAdjustment,
  ValidatedResult,
  VisibleDistress,
} from "./types";

const OUTCOMES: CoordinationOutcome[] = [
  "inspection_confirmed",
  "followup_requested",
  "declined",
  "unanswered",
  "uncertain",
];

/** Upper bound on a believable arrival estimate: a day out is not an ETA. */
const MAX_ARRIVAL_MINUTES = 1440;

export type ValidationContext = {
  /**
   * Whether the recipient said anything at all. A structured result is a
   * reading of a conversation; without one there is nothing to have read.
   */
  hasCaretakerSpeech: boolean;
};

/** Accept the wire spelling and the domain spelling; refuse everything else. */
function field(raw: Record<string, unknown>, snake: string, camel: string): unknown {
  return raw[snake] ?? raw[camel];
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T) : null;
}

/** `"yes"`/`"no"` become booleans; everything else, including silence, is null. */
function tristate(value: unknown): boolean | null {
  const parsed = enumValue(value, ["yes", "no", "unclear", "unknown", "true", "false"]);
  if (parsed === "yes" || parsed === "true") return true;
  if (parsed === "no" || parsed === "false") return false;
  if (typeof value === "boolean") return value;
  return null;
}

function arrivalMinutes(value: unknown): number | null {
  const source = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  const digits = source.trim().match(/^\d{1,5}$/);
  if (!digits) return null;
  const minutes = Number(digits[0]);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > MAX_ARRIVAL_MINUTES) return null;
  return minutes;
}

function notes(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // The schema asks for this exact sentence when there is nothing to add.
  if (/^none( given)?\.?$/i.test(trimmed) || /^n\/?a\.?$/i.test(trimmed)) return null;
  return trimmed.slice(0, 600);
}

/**
 * Validate one provider result.
 *
 * Always returns a complete `CaretakerResult`: every failure mode has a safe
 * reading, and refusing to produce one would only push the same decision into
 * the UI, where it would be made with less information.
 */
export function validateResult(
  raw: unknown,
  context: ValidationContext = { hasCaretakerSpeech: false },
): ValidatedResult {
  const adjustments: ResultAdjustment[] = [];
  const note = (field: string, reason: string) => adjustments.push({ field, reason });

  const isObject = !!raw && typeof raw === "object" && !Array.isArray(raw);
  if (!isObject) {
    return {
      providerReturnedResult: false,
      adjustments: [
        {
          field: "structuredResult",
          reason: "The call returned no structured result. Nothing was established.",
        },
      ],
      result: {
        inspectionAccepted: null,
        estimatedArrivalMinutes: null,
        visibleDistress: "unknown",
        veterinaryFollowupRequested: null,
        caretakerNotes: null,
        outcome: context.hasCaretakerSpeech ? "uncertain" : "unanswered",
        humanReviewRequired: true,
      },
    };
  }

  const object = raw as Record<string, unknown>;

  const inspectionAccepted = tristate(field(object, "inspection_accepted", "inspectionAccepted"));
  if (inspectionAccepted === null) {
    note("inspectionAccepted", "The caretaker never clearly accepted or refused the inspection.");
  }

  const rawArrival = field(object, "estimated_arrival_minutes", "estimatedArrivalMinutes");
  let estimatedArrivalMinutes = arrivalMinutes(rawArrival);
  if (estimatedArrivalMinutes === null && rawArrival !== undefined && rawArrival !== null) {
    const spoken = typeof rawArrival === "string" ? rawArrival.trim().toLowerCase() : "";
    if (spoken && spoken !== "unknown") {
      note("estimatedArrivalMinutes", "No usable number of minutes was given, so no estimate is recorded.");
    }
  }

  const visibleDistress =
    enumValue<VisibleDistress>(field(object, "visible_distress", "visibleDistress"), [
      "yes",
      "no",
      "unknown",
    ]) ?? "unknown";
  if (visibleDistress === "unknown" && field(object, "visible_distress", "visibleDistress") !== "unknown") {
    note("visibleDistress", "Visible distress was not reported either way; recorded as unknown.");
  }

  const veterinaryFollowupRequested = tristate(
    field(object, "veterinary_followup_requested", "veterinaryFollowupRequested"),
  );

  const caretakerNotes = notes(field(object, "caretaker_notes", "caretakerNotes"));

  let outcome =
    enumValue<CoordinationOutcome>(field(object, "outcome", "outcome"), OUTCOMES) ?? null;
  if (outcome === null) {
    note("outcome", "The call returned no recognised outcome.");
    outcome = "uncertain";
  }

  let humanReviewRequired = tristate(field(object, "human_review_required", "humanReviewRequired"));
  if (humanReviewRequired === null) {
    note("humanReviewRequired", "The call did not say whether human review is required; assuming it is.");
    humanReviewRequired = true;
  }

  // -------------------------------------------------------------------------
  // Cross-field checks. Each one that fires downgrades the outcome.
  // -------------------------------------------------------------------------

  const downgrade = (fieldName: string, reason: string) => {
    note(fieldName, reason);
    outcome = "uncertain";
  };

  if (outcome === "inspection_confirmed" && inspectionAccepted !== true) {
    downgrade("outcome", "The outcome says the inspection was confirmed, but no acceptance was recorded.");
  }

  if (outcome === "declined" && inspectionAccepted === true) {
    downgrade("outcome", "The outcome says declined, but the caretaker accepted the inspection.");
  }

  if (outcome === "followup_requested" && veterinaryFollowupRequested !== true) {
    downgrade("outcome", "The outcome says follow-up was requested, but no request was recorded.");
  }

  if (inspectionAccepted === false && estimatedArrivalMinutes !== null) {
    note(
      "estimatedArrivalMinutes",
      "An arrival time was returned for a caretaker who is not going; the estimate is dropped.",
    );
    estimatedArrivalMinutes = null;
    outcome = "uncertain";
  }

  if (outcome === "unanswered" && context.hasCaretakerSpeech) {
    downgrade("outcome", "The outcome says nobody answered, but the transcript records the caretaker speaking.");
  }

  if (outcome !== "unanswered" && !context.hasCaretakerSpeech) {
    note(
      "outcome",
      "Nothing the caretaker said was recorded, so no answer can be attributed to them.",
    );
    outcome = "unanswered";
    estimatedArrivalMinutes = null;
  }

  if (outcome === "inspection_confirmed" && estimatedArrivalMinutes === null) {
    note("humanReviewRequired", "The inspection was accepted without a usable arrival time.");
  }

  if (visibleDistress === "yes") {
    note("humanReviewRequired", "Visible distress was reported. A person needs to see this.");
  }

  if (veterinaryFollowupRequested === true) {
    note("humanReviewRequired", "The caretaker asked for veterinary or supervisor follow-up.");
  }

  // Anything validation had to touch is, by itself, a reason for a person to
  // look. This is the fail-closed rule, and it is the last word.
  if (adjustments.length > 0) humanReviewRequired = true;
  if (outcome !== "inspection_confirmed") humanReviewRequired = true;

  const result: CaretakerResult = {
    inspectionAccepted,
    estimatedArrivalMinutes,
    visibleDistress,
    veterinaryFollowupRequested,
    caretakerNotes,
    outcome,
    humanReviewRequired,
  };

  return { result, adjustments, providerReturnedResult: true };
}
