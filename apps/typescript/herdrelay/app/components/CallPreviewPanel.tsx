"use client";

import { useEffect, useState } from "react";
import type { CallPreview, Incident } from "@/lib/types";
import { Button, Field, Notice, Pill, Rail } from "./ui";

/**
 * The approval gate.
 *
 * Two things are load-bearing here and are worth stating plainly:
 *
 *   1. Previewing and authorizing are different actions, in different blocks,
 *      with different weights. Nothing on the preview side of this panel can
 *      place a call.
 *   2. The authorize control for a live call is not the same control as the one
 *      for a dry run. It is red, it names the masked destination, and it stays
 *      disabled until the operator has typed the word. A muscle-memory click
 *      that starts a simulation must not be able to start a real call.
 */
export function CallPreviewPanel({
  incident,
  preview,
  busy,
  onApprove,
  onPlace,
}: {
  incident: Incident;
  preview: CallPreview;
  busy: boolean;
  onApprove: (fingerprint: string) => void;
  onPlace: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [typed, setTyped] = useState("");
  const live = preview.mode === "live";
  const approved = incident.approval !== null;

  // A new preview is a new call. Any acknowledgement of the previous one is void.
  useEffect(() => {
    setAcknowledged(false);
    setTyped("");
  }, [preview.fingerprint]);

  const authorizeReady = approved && (!live || typed.trim().toUpperCase() === "AUTHORIZE");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-chalk">Call task preview</h3>
        <Pill tone={live ? "red" : "green"}>{live ? "LIVE MODE" : "DRY RUN"}</Pill>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Recipient (masked)">
          <span className="numeric text-chalk">{preview.recipientMasked}</span>
          <span className="ml-2 text-fog-dim">{preview.caretakerName}</span>
        </Field>
        <Field label="Calls placed">
          <span className="text-chalk">One. HerdRelay does not redial and schedules nothing.</span>
        </Field>
      </div>

      <Field label="Purpose">
        <p className="leading-relaxed text-fog">{preview.purpose}</p>
      </Field>

      <Field label="AI disclosure, spoken verbatim before anything is asked">
        <p className="rounded-md border border-line bg-panel-soft p-3 leading-relaxed text-fog">
          &ldquo;{preview.disclosure}&rdquo;
        </p>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Rail>Questions that will be asked</Rail>
          <ol className="mt-2 space-y-1.5 text-sm text-fog">
            {preview.questions.map((question, index) => (
              <li key={question} className="flex gap-2">
                <span className="numeric text-fog-dim">{index + 1}.</span>
                <span className="text-chalk">{question}</span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <Rail>Data expected from the call</Rail>
          <ul className="mt-2 space-y-1.5 text-sm text-fog">
            {preview.expectedData.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden className="text-fog-dim">
                  &middot;
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <Rail>Safety limitations</Rail>
        <ul className="mt-2 space-y-1.5 text-sm text-fog">
          {preview.limitations.map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden className="text-amber">
                &middot;
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <details className="rounded-md border border-line bg-panel-soft">
        <summary className="cursor-pointer px-3.5 py-2.5 text-sm text-fog hover:text-chalk">
          Verbatim brief given to CALL-E ({preview.task.length} characters)
        </summary>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-line px-3.5 py-3 text-xs leading-relaxed text-fog">
          {preview.task}
        </pre>
      </details>

      <p className="numeric text-xs text-fog-dim">
        Approval fingerprint {preview.fingerprint.slice(0, 16)}…
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* Gate 1: approve this exact call.                                    */}
      {/* ------------------------------------------------------------------ */}
      <div className="rounded-md border border-line bg-panel-soft p-4">
        <Rail>Step 1 — approve this exact call</Rail>
        {approved ? (
          <p className="mt-2 text-sm text-green">
            Approved for {incident.approval?.recipientMasked}. The approval expires at{" "}
            <span className="numeric">{new Date(incident.approval!.expiresAt).toISOString().slice(11, 16)} UTC</span>.
          </p>
        ) : (
          <>
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm text-fog">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#5fd39a]"
              />
              <span>
                I have read the questions and the brief above, and I confirm that{" "}
                <span className="text-chalk">{preview.caretakerName}</span> at{" "}
                <span className="numeric text-chalk">{preview.recipientMasked}</span> is an authorized
                caretaker who has agreed to receive AI-assisted monitoring calls.
              </span>
            </label>
            <div className="mt-4">
              <Button
                onClick={() => onApprove(preview.fingerprint)}
                disabled={!acknowledged || busy}
              >
                Approve this call
              </Button>
            </div>
          </>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Gate 2: place it. Deliberately a separate block and a separate act. */}
      {/* ------------------------------------------------------------------ */}
      <div
        className={`rounded-md border p-4 ${
          live ? "border-red bg-red-dim/30" : "border-line bg-panel-soft"
        }`}
      >
        <Rail>Step 2 — {live ? "authorize the real call" : "run the simulated call"}</Rail>

        {live ? (
          <>
            <Notice tone="red" title="THIS WILL RING A REAL PHONE">
              A real outbound call will be placed to {preview.recipientMasked}. It cannot be
              un-placed. Confirm the caretaker is expecting it.
            </Notice>
            <label className="mt-3 block text-sm text-fog">
              Type <span className="numeric text-chalk">AUTHORIZE</span> to enable the call button.
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                disabled={!approved}
                aria-label="Type AUTHORIZE to enable the call button"
                className="numeric mt-2 w-48 rounded-md border border-line bg-ink px-3 py-2 text-sm text-chalk disabled:opacity-40"
              />
            </label>
          </>
        ) : (
          <p className="mt-2 text-sm text-fog">
            Dry run plays a scripted CALL-E response through the same code path a real call uses.
            No request leaves this process and no phone rings.
          </p>
        )}

        <div className="mt-4">
          <Button
            intent={live ? "danger" : "primary"}
            onClick={onPlace}
            disabled={!authorizeReady || busy}
          >
            {busy
              ? "Working…"
              : live
                ? `Authorize real call to ${preview.recipientMasked}`
                : "Start simulated call"}
          </Button>
        </div>
      </div>
    </div>
  );
}
