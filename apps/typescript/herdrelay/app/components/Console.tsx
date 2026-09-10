"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CallMode, CallPreview, Incident } from "@/lib/types";
import { AlertDetail } from "./AlertDetail";
import { AlertsTable, type AlertRow } from "./AlertsTable";
import { CallMonitor } from "./CallMonitor";
import { CallPreviewPanel } from "./CallPreviewPanel";
import { ResultPanel } from "./ResultPanel";
import { Timeline } from "./Timeline";
import { Button, Notice, Panel, Pill, Rail, Stat } from "./ui";

type ConsoleState = {
  mode: CallMode;
  liveReady: boolean;
  liveBlockedReason: string | null;
  dryRunScenario: string | null;
  scenarios: Record<string, string>;
  alerts: AlertRow[];
  incidents: Incident[];
};

const POLL_MS = 1200;
const FINISHED = ["completed", "failed", "unanswered", "uncertain"];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status}).`);
  return body as T;
}

export function Console() {
  const [state, setState] = useState<ConsoleState | null>(null);
  const [selected, setSelected] = useState<AlertRow | null>(null);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [preview, setPreview] = useState<CallPreview | null>(null);
  const [scenario, setScenario] = useState<string>("inspection_confirmed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Guards a second submit while the first is still in flight. The server
  // refuses duplicates too; this only spares the operator the error.
  const inFlight = useRef(false);

  const refreshState = useCallback(async () => {
    try {
      const next = await api<ConsoleState>("/api/state");
      setState(next);
      setLoadError(null);
      if (next.dryRunScenario) setScenario((current) => current || next.dryRunScenario!);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "Could not load the console.");
    }
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const finished = incident !== null && FINISHED.includes(incident.phase);

  // Poll while a call is live. Dry run and live calls poll the same endpoint.
  useEffect(() => {
    if (!incident || !incident.callId || finished) return;
    const id = incident.id;
    const timer = setInterval(async () => {
      try {
        const body = await api<{ incident: Incident; pollError?: string }>(`/api/incidents/${id}/status`);
        setIncident(body.incident);
        if (body.pollError) setError(body.pollError);
        if (FINISHED.includes(body.incident.phase)) void refreshState();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not refresh the call.");
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [incident, finished, refreshState]);

  const act = useCallback(async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  const prepare = (alert: AlertRow) =>
    act(async () => {
      const body = await api<{ incident: Incident; preview: CallPreview }>("/api/incidents", {
        method: "POST",
        body: JSON.stringify({ alertId: alert.id, scenario }),
      });
      setIncident(body.incident);
      setPreview(body.preview);
      await refreshState();
    });

  const approve = (fingerprint: string) =>
    act(async () => {
      const body = await api<{ incident: Incident; preview: CallPreview }>(
        `/api/incidents/${incident!.id}/approve`,
        { method: "POST", body: JSON.stringify({ fingerprint }) },
      );
      setIncident(body.incident);
      setPreview(body.preview);
    });

  const place = () =>
    act(async () => {
      const body = await api<{ incident: Incident }>(`/api/incidents/${incident!.id}/call`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setIncident(body.incident);
      await refreshState();
    });

  const reconcile = () =>
    act(async () => {
      const body = await api<{ incident: Incident }>(`/api/incidents/${incident!.id}/reconcile`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setIncident(body.incident);
      await refreshState();
    });

  const openIncident = (target: Incident) =>
    act(async () => {
      const body = await api<{ incident: Incident; preview: CallPreview }>(`/api/incidents/${target.id}`);
      setIncident(body.incident);
      setPreview(body.preview);
      setSelected(state?.alerts.find((alert) => alert.id === body.incident.alert.id) ?? null);
    });

  const reset = () =>
    act(async () => {
      await api("/api/demo/reset", { method: "POST", body: JSON.stringify({}) });
      setIncident(null);
      setPreview(null);
      setSelected(null);
      await refreshState();
    });

  const summary = useMemo(() => {
    const alerts = state?.alerts ?? [];
    const incidents = state?.incidents ?? [];
    return {
      openAlerts: alerts.filter((alert) => alert.callAdvice.warranted).length,
      highSeverity: alerts.filter((alert) => alert.severity === "high").length,
      calling: incidents.filter((item) => ["approved", "calling", "in_progress"].includes(item.phase)).length,
      review: incidents.filter((item) => FINISHED.includes(item.phase) && item.humanReviewRequired).length,
    };
  }, [state]);

  const live = state?.mode === "live";

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-chalk">HerdRelay</h1>
            {state ? (
              <Pill tone={live ? "red" : "green"}>{live ? "LIVE MODE" : "DRY RUN"}</Pill>
            ) : null}
          </div>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-fog">
            Livestock incident coordination. A monitoring alert becomes one human-approved phone call
            to an authorized caretaker. HerdRelay does not diagnose animals and gives no veterinary
            advice.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state && !live ? (
            <Button intent="quiet" onClick={reset} disabled={busy}>
              Reset demo
            </Button>
          ) : null}
        </div>
      </header>

      {loadError ? (
        <div className="mt-5">
          <Notice tone="red" title="CONSOLE UNAVAILABLE">{loadError}</Notice>
        </div>
      ) : null}

      {state && live && !state.liveReady ? (
        <div className="mt-5">
          <Notice tone="red" title="LIVE MODE IS NOT READY">
            {state.liveBlockedReason} Until this is resolved, no call can be placed.
          </Notice>
        </div>
      ) : null}

      {state && !live ? (
        <div className="mt-5">
          <Notice tone="green" title="DRY RUN — NO PHONE WILL RING">
            Every measurement here is synthetic and every call is a scripted CALL-E response replayed
            through the same code path a real call uses. Set <span className="numeric">HERDRELAY_MODE=live</span>{" "}
            with an authorized caretaker number to place real calls.
          </Notice>
        </div>
      ) : null}

      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Alerts needing verification" value={String(summary.openAlerts)} tone={summary.openAlerts ? "amber" : "neutral"} />
        <Stat label="High severity" value={String(summary.highSeverity)} tone={summary.highSeverity ? "red" : "neutral"} />
        <Stat label="Calls in progress" value={String(summary.calling)} tone={summary.calling ? "amber" : "neutral"} />
        <Stat label="Awaiting human review" value={String(summary.review)} tone={summary.review ? "amber" : "neutral"} />
      </section>

      <Panel className="mt-5 p-4">
        <div className="flex items-center justify-between gap-3 pb-2">
          <h2 className="text-base font-semibold text-chalk">Recent alerts</h2>
          <span className="rail">Synthetic monitoring feed</span>
        </div>
        {state ? (
          <AlertsTable
            alerts={state.alerts}
            incidents={state.incidents}
            selectedId={selected?.id ?? null}
            onSelect={(alert) => {
              setSelected(alert);
              setError(null);
              const existing = state.incidents.find((item) => item.alert.id === alert.id);
              if (existing) {
                void openIncident(existing);
              } else {
                setIncident(null);
                setPreview(null);
              }
            }}
          />
        ) : (
          <p className="py-6 text-sm text-fog-dim">Loading alerts…</p>
        )}
      </Panel>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {selected ? (
            <Panel className="p-5">
              <AlertDetail alert={selected} />
              {!incident ? (
                <div className="mt-5 space-y-3 border-t border-line pt-4">
                  {!live && state ? (
                    <label className="block text-sm text-fog">
                      <span className="rail">Dry-run scenario</span>
                      <select
                        value={scenario}
                        onChange={(event) => setScenario(event.target.value)}
                        className="mt-1.5 w-full rounded-md border border-line bg-ink px-3 py-2 text-sm text-chalk"
                      >
                        {Object.entries(state.scenarios).map(([name, label]) => (
                          <option key={name} value={name}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <Button onClick={() => prepare(selected)} disabled={busy || (live && !state?.liveReady)}>
                    Prepare call task
                  </Button>
                  <p className="text-xs text-fog-dim">
                    Preparing builds the task and the preview. It places no call.
                  </p>
                </div>
              ) : null}
            </Panel>
          ) : (
            <Panel className="p-8 text-center">
              <p className="text-sm text-fog">Select an alert to review it.</p>
            </Panel>
          )}
        </div>

        <div className="space-y-5">
          {error ? <Notice tone="red" title="ACTION FAILED">{error}</Notice> : null}

          {incident && preview && !incident.callId && incident.createState !== "ambiguous" ? (
            <Panel className="p-5">
              <CallPreviewPanel
                incident={incident}
                preview={preview}
                busy={busy}
                onApprove={approve}
                onPlace={place}
              />
            </Panel>
          ) : null}

          {incident && (incident.callId || incident.createState === "ambiguous") ? (
            <Panel className="p-5">
              <CallMonitor incident={incident} />
              {incident.createState === "ambiguous" ? (
                <div className="mt-4">
                  <Button intent="default" onClick={reconcile} disabled={busy}>
                    Acknowledge and close this incident
                  </Button>
                </div>
              ) : null}
            </Panel>
          ) : null}

          {incident?.validated ? (
            <Panel className="p-5">
              <ResultPanel incident={incident} />
            </Panel>
          ) : null}

          {incident ? (
            <Panel className="p-5">
              <Timeline incident={incident} />
            </Panel>
          ) : null}

          {!incident ? (
            <Panel className="p-5">
              <Rail>How this works</Rail>
              <ol className="mt-3 space-y-2.5 text-sm leading-relaxed text-fog">
                <li>1. A monitoring alert arrives and is reviewed by a person.</li>
                <li>2. HerdRelay prepares a call task and shows the exact call, with the number masked.</li>
                <li>3. The operator approves that exact call. Nothing dials without it.</li>
                <li>4. CALL-E calls the authorized caretaker, says it is an AI, and asks five questions.</li>
                <li>5. The answers are validated, and anything unclear stays unclear.</li>
                <li>6. A person decides what happens next. HerdRelay decides nothing.</li>
              </ol>
            </Panel>
          ) : null}
        </div>
      </div>

      <footer className="mt-8 border-t border-line pt-5 text-xs leading-relaxed text-fog-dim">
        HerdRelay is a demonstration of a human-approved phone-call workflow. It is not a veterinary
        product, it does not diagnose illness, and it makes no medical, emergency, purchasing, or
        veterinary decisions. All animal data shown is synthetic. Phone numbers are masked
        everywhere, including in server logs.
      </footer>
    </main>
  );
}
