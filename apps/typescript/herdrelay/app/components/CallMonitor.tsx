"use client";

import { callDiagnosis, formatOffset } from "@/lib/call-record";
import { PHASE_LABELS, PHASE_TONES } from "@/lib/coordination";
import type { Incident, IncidentPhase } from "@/lib/types";
import { Dot, Notice, Pill, Rail } from "./ui";

const SEQUENCE: IncidentPhase[] = ["planned", "approved", "calling", "in_progress", "completed"];

const TERMINALS: IncidentPhase[] = ["completed", "failed", "unanswered", "uncertain"];

/** The status strip and the transcript, which is the only evidence of the call. */
export function CallMonitor({ incident }: { incident: Incident }) {
  const phase = incident.phase;
  const terminal = TERMINALS.includes(phase);
  const reachedIndex = terminal ? SEQUENCE.length - 1 : SEQUENCE.indexOf(phase);
  const call = incident.call;
  const diagnosis = call ? callDiagnosis(call) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-chalk">Call status</h3>
        <Pill tone={PHASE_TONES[phase]}>
          <Dot tone={PHASE_TONES[phase]} live={!terminal && phase !== "planned"} />
          {PHASE_LABELS[phase]}
        </Pill>
      </div>

      <ol className="flex flex-wrap gap-1.5" aria-label="Call progress">
        {SEQUENCE.map((step, index) => {
          const done = index <= reachedIndex;
          const isTerminalSlot = index === SEQUENCE.length - 1;
          const label = isTerminalSlot && terminal ? PHASE_LABELS[phase] : PHASE_LABELS[step];
          const tone = isTerminalSlot && terminal ? PHASE_TONES[phase] : "green";
          return (
            <li
              key={step}
              aria-current={index === reachedIndex}
              className={`flex-1 min-w-[5.5rem] rounded border px-2 py-1.5 text-center text-[11px] ${
                done
                  ? tone === "red"
                    ? "border-red-dim bg-red-dim/40 text-red"
                    : tone === "amber"
                      ? "border-amber-dim bg-amber-dim/40 text-amber"
                      : "border-green-dim bg-green-dim/40 text-green"
                  : "border-line-soft bg-panel-soft text-fog-dim"
              }`}
            >
              {label}
            </li>
          );
        })}
      </ol>

      {incident.createState === "ambiguous" ? (
        <Notice tone="red" title="OUTCOME UNKNOWN — CALLING HALTED">
          HerdRelay sent a call request and never learned whether it was accepted, so it does not
          know whether a phone rang. It has stopped, and it will not try again on its own. Find the
          call in the CALL-E dashboard and reconcile it, or close the incident.
        </Notice>
      ) : null}

      {call ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Rail>Call ID</Rail>
            <p className="numeric mt-1 truncate text-xs text-fog" title={call.callId}>
              {call.callId}
            </p>
          </div>
          <div>
            <Rail>Provider status</Rail>
            <p className="numeric mt-1 text-xs text-fog">
              {call.status}
              {call.attemptStatus ? ` / ${call.attemptStatus}` : ""}
            </p>
          </div>
          <div>
            <Rail>Completion confidence</Rail>
            <p className="numeric mt-1 text-xs text-fog">
              {call.completionConfidence
                ? `${Math.round(call.completionConfidence.score * 100)}% (${call.completionConfidence.label})`
                : "not reported"}
            </p>
          </div>
        </div>
      ) : null}

      {diagnosis ? (
        <Notice tone="red" title="THE CALL DID NOT PRODUCE A CONVERSATION">
          <p>{diagnosis.reason}</p>
          <p className="mt-1.5">{diagnosis.hint}</p>
          {diagnosis.code ? (
            <p className="numeric mt-2 text-xs text-fog-dim">Provider code: {diagnosis.code}</p>
          ) : null}
        </Notice>
      ) : null}

      {call && call.transcript.length > 0 ? (
        <div>
          <Rail>Transcript evidence</Rail>
          <ol className="mt-2 space-y-2.5 rounded-md border border-line bg-panel-soft p-3.5">
            {call.transcript.map((turn, index) => (
              <li key={`${index}-${turn.offsetSeconds}`} className="flex gap-3 text-sm">
                <span className="numeric w-11 shrink-0 pt-0.5 text-xs text-fog-dim">
                  {formatOffset(turn.offsetSeconds) ?? "--:--"}
                </span>
                <span className="w-16 shrink-0 pt-0.5">
                  <span
                    className={`rail ${turn.speaker === "user" ? "text-green" : "text-fog-dim"}`}
                  >
                    {turn.speaker === "user" ? "Caretaker" : turn.speaker === "bot" ? "HerdRelay" : "Unknown"}
                  </span>
                </span>
                <span className={turn.speaker === "user" ? "text-chalk" : "text-fog"}>{turn.text}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : terminal ? (
        <Notice tone="red" title="NO CONVERSATION WAS RECORDED">
          Nothing was said on this call, so nothing is known about {incident.alert.animalId}. The
          alert remains open and unverified.
        </Notice>
      ) : null}
    </div>
  );
}
