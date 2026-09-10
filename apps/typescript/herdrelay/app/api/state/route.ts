import { NextResponse } from "next/server";
import { loadAlerts, warrantsCall } from "@/lib/alerts";
import { requireOperator } from "@/lib/auth";
import { scenarioLabels } from "@/lib/dry-run";
import { callMode, dryRunScenario, liveReadiness } from "@/lib/mode";
import { callsToday, dailyCap, isSelfService } from "@/lib/self-service";
import { listIncidents } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everything the console renders on load: mode, alerts, incidents. */
export async function GET(request: Request) {
  const { denied, operator } = await requireOperator(request);
  if (denied) return denied;

  const mode = callMode();
  const readiness = liveReadiness();
  const alerts = await loadAlerts();

  return NextResponse.json({
    mode,
    operator: { name: operator.name, shared: operator.shared },
    selfService: isSelfService()
      ? { enabled: true, dailyCap: dailyCap(), remainingToday: Math.max(dailyCap() - (await callsToday()), 0) }
      : { enabled: false, dailyCap: 0, remainingToday: 0 },
    // Never the number itself, and never the credential: only whether the
    // configuration is complete enough to dial.
    liveReady: readiness.ready,
    liveBlockedReason: readiness.ready ? null : readiness.reason,
    dryRunScenario: mode === "dry_run" ? dryRunScenario() : null,
    scenarios: await scenarioLabels(),
    alerts: alerts.map((alert) => ({ ...alert, callAdvice: warrantsCall(alert) })),
    incidents: await listIncidents(),
  }, { headers: { "Cache-Control": "no-store" } });
}
