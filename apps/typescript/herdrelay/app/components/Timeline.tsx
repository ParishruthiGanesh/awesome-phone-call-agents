"use client";

import type { Incident, TimelineEntry } from "@/lib/types";
import { Rail } from "./ui";

const STEP_LABELS: Record<TimelineEntry["step"], string> = {
  alert_received: "Alert received",
  call_prepared: "Call prepared",
  approved: "Approved",
  dialing: "Dialing",
  call_connected: "Connected",
  call_ended: "Call ended",
  result_validated: "Result validated",
  reset: "Reset",
};

/** Alert to approval to call to result, in the order it actually happened. */
export function Timeline({ incident }: { incident: Incident }) {
  return (
    <div>
      <Rail>Timeline</Rail>
      <ol className="mt-3 space-y-3">
        {incident.timeline.map((entry, index) => (
          <li key={`${entry.step}-${index}`} className="relative flex gap-3 pl-4">
            <span
              aria-hidden
              className="absolute left-0 top-1.5 h-1.5 w-1.5 rounded-full bg-fog-dim"
            />
            {index < incident.timeline.length - 1 ? (
              <span aria-hidden className="absolute left-[2.5px] top-4 h-full w-px bg-line" />
            ) : null}
            <div className="min-w-0">
              <p className="text-sm text-chalk">{STEP_LABELS[entry.step]}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-fog">{entry.detail}</p>
              <p className="numeric mt-0.5 text-[11px] text-fog-dim">
                <time dateTime={entry.at}>{entry.at.slice(11, 19)} UTC</time>
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
