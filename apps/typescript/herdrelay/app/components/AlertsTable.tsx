"use client";

import type { AlertSeverity, Incident, LivestockAlert } from "@/lib/types";
import { PHASE_LABELS, PHASE_TONES } from "@/lib/coordination";
import { Dot, Pill, type Tone } from "./ui";

export type AlertRow = LivestockAlert & { callAdvice: { warranted: boolean; reason: string } };

export const SEVERITY_TONE: Record<AlertSeverity, Tone> = {
  low: "neutral",
  moderate: "amber",
  high: "red",
};

export function AlertsTable({
  alerts,
  incidents,
  selectedId,
  onSelect,
}: {
  alerts: AlertRow[];
  incidents: Incident[];
  selectedId: string | null;
  onSelect: (alert: AlertRow) => void;
}) {
  const latestFor = (alertId: string) => incidents.find((incident) => incident.alert.id === alertId) ?? null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[38rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line">
            {["Animal", "Location", "Rate", "Confidence", "Severity", "Status"].map((heading) => (
              <th key={heading} scope="col" className="rail px-3 py-2 font-normal">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => {
            const incident = latestFor(alert.id);
            const selected = alert.id === selectedId;
            return (
              <tr
                key={alert.id}
                onClick={() => onSelect(alert)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(alert);
                  }
                }}
                tabIndex={0}
                aria-current={selected}
                className={`cursor-pointer border-b border-line-soft transition-colors ${
                  selected ? "bg-panel-soft" : "hover:bg-panel-soft/60"
                }`}
              >
                <th scope="row" className="px-3 py-3 font-medium text-chalk">
                  <span className="flex items-center gap-2">
                    <Dot tone={SEVERITY_TONE[alert.severity]} />
                    {alert.animalId}
                  </span>
                </th>
                <td className="px-3 py-3 text-fog">{alert.location}</td>
                <td className="numeric px-3 py-3 text-chalk">
                  {alert.observedRespiratoryRate}
                  <span className="text-fog-dim"> / {alert.baselineRange.min}–{alert.baselineRange.max}</span>
                </td>
                <td className="numeric px-3 py-3 text-fog">{Math.round(alert.confidence * 100)}%</td>
                <td className="px-3 py-3">
                  <Pill tone={SEVERITY_TONE[alert.severity]}>{alert.severity}</Pill>
                </td>
                <td className="px-3 py-3">
                  {incident ? (
                    <Pill tone={PHASE_TONES[incident.phase]}>{PHASE_LABELS[incident.phase]}</Pill>
                  ) : alert.callAdvice.warranted ? (
                    <span className="text-fog">Requires human verification</span>
                  ) : (
                    <span className="text-fog-dim">No call warranted</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
