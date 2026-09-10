"use client";

import { coordinationView } from "@/lib/coordination";
import type { Incident } from "@/lib/types";
import { Field, Notice, Pill, Rail } from "./ui";

function answer(value: boolean | null): { text: string; tone: "green" | "red" | "amber" } {
  if (value === true) return { text: "Yes", tone: "green" };
  if (value === false) return { text: "No", tone: "red" };
  return { text: "Not established", tone: "amber" };
}

/**
 * The result screen.
 *
 * Unstated answers render as "Not established" in amber rather than as "No" in
 * red, because they are different facts and the difference decides whether
 * somebody drives to the barn. Anything validation had to correct is printed
 * here too: a downgraded outcome that looked clean on screen would be worse
 * than no result at all.
 */
export function ResultPanel({ incident }: { incident: Incident }) {
  const validated = incident.validated;
  if (!validated) return null;
  const result = validated.result;
  const view = coordinationView(result);

  const inspection = answer(result.inspectionAccepted);
  const followup = answer(result.veterinaryFollowupRequested);
  const distressTone = result.visibleDistress === "yes" ? "red" : result.visibleDistress === "no" ? "green" : "amber";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-chalk">Structured result</h3>
        <Pill tone={result.humanReviewRequired ? "amber" : "green"}>
          {result.humanReviewRequired ? "Human review required" : "No review flagged"}
        </Pill>
      </div>

      <div className={`rounded-md border p-4 ${
        view.tone === "green" ? "border-green-dim bg-green-dim/30"
          : view.tone === "amber" ? "border-amber-dim bg-amber-dim/30"
          : "border-red-dim bg-red-dim/30"
      }`}>
        <Rail>Recommended coordination status</Rail>
        <p className={`mt-1.5 text-lg font-semibold ${
          view.tone === "green" ? "text-green" : view.tone === "amber" ? "text-amber" : "text-red"
        }`}>
          {view.label}
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-fog">{view.detail}</p>
      </div>

      {incident.call?.summary ? (
        <Field label="Call summary">
          <p className="leading-relaxed text-fog">{incident.call.summary}</p>
        </Field>
      ) : null}

      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <Rail>Inspection accepted</Rail>
          <p className={`mt-1 text-sm ${inspection.tone === "green" ? "text-green" : inspection.tone === "red" ? "text-red" : "text-amber"}`}>
            {inspection.text}
          </p>
        </div>
        <div>
          <Rail>Estimated arrival</Rail>
          <p className="numeric mt-1 text-sm text-chalk">
            {result.estimatedArrivalMinutes === null
              ? <span className="text-amber">Not established</span>
              : `${result.estimatedArrivalMinutes} min`}
          </p>
        </div>
        <div>
          <Rail>Visible distress</Rail>
          <p className={`mt-1 text-sm ${distressTone === "green" ? "text-green" : distressTone === "red" ? "text-red" : "text-amber"}`}>
            {result.visibleDistress === "unknown" ? "Unknown — not assessed" : result.visibleDistress === "yes" ? "Yes, reported" : "No"}
          </p>
        </div>
        <div>
          <Rail>Veterinary or supervisor follow-up requested</Rail>
          <p className={`mt-1 text-sm ${followup.tone === "green" ? "text-green" : followup.tone === "red" ? "text-red" : "text-amber"}`}>
            {followup.text}
          </p>
        </div>
        <div className="sm:col-span-2">
          <Rail>Caretaker notes</Rail>
          <p className="mt-1 text-sm leading-relaxed text-chalk">
            {result.caretakerNotes ?? <span className="text-fog-dim">Nothing added.</span>}
          </p>
        </div>
        <div>
          <Rail>Outcome</Rail>
          <p className="numeric mt-1 text-sm text-chalk">{result.outcome}</p>
        </div>
        <div>
          <Rail>Completion confidence</Rail>
          <p className="numeric mt-1 text-sm text-chalk">
            {incident.call?.completionConfidence
              ? `${Math.round(incident.call.completionConfidence.score * 100)}% (${incident.call.completionConfidence.label})`
              : "not reported"}
          </p>
        </div>
      </dl>

      {validated.adjustments.length > 0 ? (
        <Notice tone="amber" title="VALIDATION NOTES">
          <p>
            The provider&rsquo;s result did not survive validation unchanged. What follows is every
            change and every reason, so nothing on this screen was quietly rewritten.
          </p>
          <ul className="mt-2 space-y-1.5">
            {validated.adjustments.map((adjustment, index) => (
              <li key={`${adjustment.field}-${index}`} className="flex gap-2">
                <span className="numeric shrink-0 text-fog-dim">{adjustment.field}</span>
                <span>{adjustment.reason}</span>
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {!validated.providerReturnedResult ? (
        <Notice tone="red" title="NO STRUCTURED RESULT">
          The call returned no structured result, so nothing was established. The values above are
          the fail-closed defaults, not findings.
        </Notice>
      ) : null}

      <Notice tone="neutral" title="WHAT HAPPENS NEXT IS A PERSON'S DECISION">
        HerdRelay has contacted nobody else and will not. It has not diagnosed {incident.alert.animalId},
        has not booked a veterinarian, and has not scheduled a follow-up call. Every step from here is
        taken by a human.
      </Notice>

      {incident.call?.taskEvidence.length ? (
        <div>
          <Rail>Provider evidence</Rail>
          <ul className="mt-2 space-y-1.5 text-sm text-fog">
            {incident.call.taskEvidence.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden className="text-fog-dim">&middot;</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
