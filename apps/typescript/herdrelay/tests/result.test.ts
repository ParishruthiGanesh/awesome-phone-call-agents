import { test } from "node:test";
import assert from "node:assert/strict";
import { validateResult } from "../lib/result";

const spoke = { hasCaretakerSpeech: true };

const clean = {
  inspection_accepted: "yes",
  estimated_arrival_minutes: "20",
  visible_distress: "unknown",
  veterinary_followup_requested: "no",
  caretaker_notes: "Off her feed last night.",
  outcome: "inspection_confirmed",
  human_review_required: "no",
};

test("a clean, consistent result passes through without correction", () => {
  const { result, adjustments } = validateResult(clean, spoke);
  assert.deepEqual(adjustments, []);
  assert.deepEqual(result, {
    inspectionAccepted: true,
    estimatedArrivalMinutes: 20,
    visibleDistress: "unknown",
    veterinaryFollowupRequested: false,
    caretakerNotes: "Off her feed last night.",
    outcome: "inspection_confirmed",
    humanReviewRequired: false,
  });
});

test("an unclear answer stays unclear and is never rounded to yes or no", () => {
  const { result } = validateResult(
    { ...clean, inspection_accepted: "unclear", veterinary_followup_requested: "unclear" },
    spoke,
  );
  assert.equal(result.inspectionAccepted, null);
  assert.equal(result.veterinaryFollowupRequested, null);
});

test("unknown distress is never inferred from anything else in the result", () => {
  const { result } = validateResult({ ...clean, visible_distress: "probably" }, spoke);
  assert.equal(result.visibleDistress, "unknown");
});

test("an outcome that contradicts its own fields is downgraded to uncertain", () => {
  const { result, adjustments } = validateResult({ ...clean, inspection_accepted: "unclear" }, spoke);
  assert.equal(result.outcome, "uncertain");
  assert.equal(result.humanReviewRequired, true);
  assert.ok(adjustments.some((item) => /confirmed, but no acceptance/.test(item.reason)));
});

test("declined with an outcome of confirmed, and confirmed with an outcome of declined, both fail closed", () => {
  assert.equal(validateResult({ ...clean, outcome: "declined" }, spoke).result.outcome, "uncertain");
  assert.equal(
    validateResult({ ...clean, inspection_accepted: "no", outcome: "inspection_confirmed" }, spoke).result.outcome,
    "uncertain",
  );
});

test("follow-up requested without a request recorded is not a follow-up", () => {
  const { result } = validateResult(
    { ...clean, outcome: "followup_requested", veterinary_followup_requested: "no" },
    spoke,
  );
  assert.equal(result.outcome, "uncertain");
});

test("an arrival time for somebody who is not going is dropped, not reconciled", () => {
  const { result, adjustments } = validateResult(
    { ...clean, inspection_accepted: "no", outcome: "declined", estimated_arrival_minutes: "30" },
    spoke,
  );
  assert.equal(result.estimatedArrivalMinutes, null);
  assert.equal(result.outcome, "uncertain");
  assert.ok(adjustments.some((item) => item.field === "estimatedArrivalMinutes"));
});

test("unusable and out-of-range arrival estimates become null rather than a guess", () => {
  for (const value of ["soon", "twenty", "-5", "99999", "20 minutes", ""]) {
    const { result } = validateResult({ ...clean, estimated_arrival_minutes: value }, spoke);
    assert.equal(result.estimatedArrivalMinutes, null, `accepted ${value}`);
  }
  assert.equal(validateResult({ ...clean, estimated_arrival_minutes: "0" }, spoke).result.estimatedArrivalMinutes, 0);
});

test("an outcome claiming nobody answered is refused when the transcript says otherwise", () => {
  const { result } = validateResult({ ...clean, outcome: "unanswered" }, spoke);
  assert.equal(result.outcome, "uncertain");
});

test("nothing can be attributed to a caretaker who never spoke", () => {
  const { result, adjustments } = validateResult(clean, { hasCaretakerSpeech: false });
  assert.equal(result.outcome, "unanswered");
  assert.equal(result.estimatedArrivalMinutes, null);
  assert.equal(result.humanReviewRequired, true);
  assert.ok(adjustments.some((item) => /never|recorded/.test(item.reason)));
});

test("a missing result is a fail-closed default, and says so", () => {
  for (const empty of [null, undefined, "", [], 42]) {
    const validated = validateResult(empty, spoke);
    assert.equal(validated.providerReturnedResult, false);
    assert.equal(validated.result.humanReviewRequired, true);
    assert.equal(validated.result.outcome, "uncertain");
    assert.equal(validated.result.visibleDistress, "unknown");
  }
  assert.equal(validateResult(null, { hasCaretakerSpeech: false }).result.outcome, "unanswered");
});

test("human review is required whenever anything at all had to be corrected", () => {
  const { result } = validateResult({ ...clean, human_review_required: "no", visible_distress: "yes" }, spoke);
  assert.equal(result.humanReviewRequired, true);
});

test("only a clean confirmed inspection may report no review needed", () => {
  for (const outcome of ["followup_requested", "declined", "unanswered", "uncertain"]) {
    const { result } = validateResult({ ...clean, outcome, human_review_required: "no" }, spoke);
    assert.equal(result.humanReviewRequired, true, `${outcome} escaped review`);
  }
});

test("the domain spelling of every field is accepted alongside the wire spelling", () => {
  const { result } = validateResult(
    {
      inspectionAccepted: "yes",
      estimatedArrivalMinutes: "12",
      visibleDistress: "no",
      veterinaryFollowupRequested: "no",
      caretakerNotes: "None given.",
      outcome: "inspection_confirmed",
      humanReviewRequired: "no",
    },
    spoke,
  );
  assert.equal(result.inspectionAccepted, true);
  assert.equal(result.estimatedArrivalMinutes, 12);
  assert.equal(result.caretakerNotes, null);
});
