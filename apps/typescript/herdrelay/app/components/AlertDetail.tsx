"use client";

import { deviationPercent } from "@/lib/alert-signal";
import type { AlertRow } from "./AlertsTable";
import { SEVERITY_TONE } from "./AlertsTable";
import { Field, Notice, Pill, Rail } from "./ui";

/**
 * What the monitoring system saw, and nothing more.
 *
 * There is no interpretation on this screen on purpose: no "possible
 * pneumonia", no triage score, no suggested action. The reading, the range, the
 * confidence and the evidence are the facts a person needs to decide whether to
 * ask somebody to walk to the pen.
 */
export function AlertDetail({ alert }: { alert: AlertRow }) {
  const deviation = deviationPercent(alert);
  const detected = new Date(alert.detectedAt);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-chalk">Animal {alert.animalId}</h2>
            <Pill tone={SEVERITY_TONE[alert.severity]}>{alert.severity} severity</Pill>
          </div>
          <p className="mt-1 text-sm text-fog">{alert.location}</p>
        </div>
        <Pill tone="neutral">Synthetic data</Pill>
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <Rail>Observed rate</Rail>
          <p className="numeric mt-1 text-lg text-chalk">
            {alert.observedRespiratoryRate}
            <span className="ml-1 text-xs text-fog-dim">breaths/min</span>
          </p>
        </div>
        <div>
          <Rail>Expected range</Rail>
          <p className="numeric mt-1 text-lg text-fog">
            {alert.baselineRange.min}–{alert.baselineRange.max}
            <span className="ml-1 text-xs text-fog-dim">breaths/min</span>
          </p>
        </div>
        <div>
          <Rail>Above range</Rail>
          <p className="numeric mt-1 text-lg text-chalk">{deviation > 0 ? `+${deviation}%` : "in range"}</p>
        </div>
        <div>
          <Rail>Confidence</Rail>
          <p className="numeric mt-1 text-lg text-chalk">{Math.round(alert.confidence * 100)}%</p>
        </div>
        <div>
          <Rail>Detected</Rail>
          <p className="numeric mt-1 text-sm text-fog">
            <time dateTime={alert.detectedAt}>{detected.toISOString().replace("T", " ").slice(0, 16)} UTC</time>
          </p>
        </div>
        <div>
          <Rail>Sensor</Rail>
          <p className="numeric mt-1 text-sm text-fog">{alert.sensorId}</p>
        </div>
      </dl>

      <Field label="Evidence summary">
        <p className="leading-relaxed text-fog">{alert.evidenceSummary}</p>
      </Field>

      <Notice tone="neutral" title="WHAT THIS ALERT IS NOT">
        This is a sensor reading outside a configured range. It is not a diagnosis, not a triage
        decision, and not veterinary advice. HerdRelay cannot tell you what is wrong with{" "}
        {alert.animalId}, and neither can the call it places. All figures on this screen are
        synthetic demonstration data.
      </Notice>

      {!alert.callAdvice.warranted ? (
        <Notice tone="amber" title="A CALL IS NOT WARRANTED">
          {alert.callAdvice.reason} You can still prepare one, but consider whether this is worth a
          caretaker&rsquo;s phone ringing.
        </Notice>
      ) : null}
    </div>
  );
}
