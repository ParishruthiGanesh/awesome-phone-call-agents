/**
 * Synthetic livestock alerts.
 *
 * These stand in for a camera or IoT monitoring system. HerdRelay has no
 * ingestion path for real animal data, and `synthetic: true` is asserted here
 * rather than read from the file so that no fixture, however edited, can present
 * itself to the UI as a real measurement.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AlertSeverity, LivestockAlert } from "./types";

const FIXTURES = path.join(process.cwd(), "fixtures");

const SEVERITIES: AlertSeverity[] = ["low", "moderate", "high"];

function parseAlert(raw: unknown): LivestockAlert | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const range = value.baselineRange as Record<string, unknown> | undefined;
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : null);
  const number = (key: string) => (typeof value[key] === "number" ? (value[key] as number) : null);

  const id = text("id");
  const animalId = text("animalId");
  const location = text("location");
  const detectedAt = text("detectedAt");
  const sensorId = text("sensorId");
  const evidenceSummary = text("evidenceSummary");
  const observedRespiratoryRate = number("observedRespiratoryRate");
  const confidence = number("confidence");
  const severity = SEVERITIES.find((candidate) => candidate === value.severity);
  const min = typeof range?.min === "number" ? range.min : null;
  const max = typeof range?.max === "number" ? range.max : null;

  if (
    !id || !animalId || !location || !detectedAt || !sensorId || !evidenceSummary ||
    observedRespiratoryRate === null || confidence === null || !severity ||
    min === null || max === null || !Number.isFinite(Date.parse(detectedAt))
  ) {
    return null;
  }

  return {
    id, animalId, location, detectedAt, sensorId, evidenceSummary,
    observedRespiratoryRate,
    baselineRange: { min, max },
    confidence: Math.min(Math.max(confidence, 0), 1),
    severity,
    synthetic: true,
  };
}

export async function loadAlerts(): Promise<LivestockAlert[]> {
  const raw = JSON.parse(await fs.readFile(path.join(FIXTURES, "alerts.json"), "utf8"));
  const alerts = Array.isArray(raw?.alerts) ? raw.alerts : [];
  return alerts.map(parseAlert).filter((alert: LivestockAlert | null): alert is LivestockAlert => alert !== null);
}

export async function findAlert(id: string): Promise<LivestockAlert | null> {
  return (await loadAlerts()).find((alert) => alert.id === id) ?? null;
}

export { deviationPercent, warrantsCall } from "./alert-signal";
