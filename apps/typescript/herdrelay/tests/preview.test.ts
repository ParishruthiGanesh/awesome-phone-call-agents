import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreview, fingerprintPreview, NotDialable, previewContext } from "../lib/preview";
import { DRY_RUN_PHONE } from "../lib/dry-run";
import type { LivestockAlert } from "../lib/types";
import type { Env } from "../lib/types";

const alert: LivestockAlert = {
  id: "alert_c17_0412",
  animalId: "C-17",
  location: "North Barn, Pen 4",
  detectedAt: "2026-04-12T05:42:00.000Z",
  sensorId: "cam-north-04",
  observedRespiratoryRate: 46,
  baselineRange: { min: 25, max: 35 },
  confidence: 0.91,
  severity: "high",
  evidenceSummary: "Elevated flank movement over 11 minutes of continuous footage.",
  synthetic: true,
};

const LIVE = {
  HERDRELAY_MODE: "live",
  HERDRELAY_AUTHORIZED_E164: "+14155552671",
  HERDRELAY_CARETAKER_NAME: "Sam Okonkwo",
  HERDRELAY_SITE_NAME: "Ridgeline Dairy",
  CALLE_API_KEY: "test-key",
  HERDRELAY_AUTH_TOKEN: "x".repeat(32),
} as Env;

test("a dry run resolves to the reserved fictional number, whatever else is configured", () => {
  const context = previewContext({ HERDRELAY_AUTHORIZED_E164: "+14155552671" } as Env);
  assert.equal(context.mode, "dry_run");
  assert.equal(context.destination.phone, DRY_RUN_PHONE);
});

test("live mode refuses to resolve a destination until it is fully configured", () => {
  assert.throws(() => previewContext({ HERDRELAY_MODE: "live" } as Env), NotDialable);
  const context = previewContext(LIVE);
  assert.equal(context.mode, "live");
  assert.equal(context.destination.phone, "+14155552671");
});

test("the preview shows a masked number and never the number itself", () => {
  const preview = buildPreview("incident-1", alert, previewContext(LIVE));
  assert.equal(JSON.stringify(preview).includes("4155552671"), false);
  assert.match(preview.recipientMasked, /^\+1 •+71$/);
  assert.equal(preview.questions.length, 5);
  assert.ok(preview.limitations.length >= 5);
});

test("the fingerprint is stable across rebuilds of the same call", () => {
  const context = previewContext(LIVE);
  assert.equal(
    buildPreview("incident-1", alert, context).fingerprint,
    buildPreview("incident-1", alert, context).fingerprint,
  );
});

test("anything that changes what the caretaker would hear changes the fingerprint", () => {
  const base = buildPreview("incident-1", alert, previewContext(LIVE));
  const variants = [
    buildPreview("incident-2", alert, previewContext(LIVE)),
    buildPreview("incident-1", { ...alert, animalId: "D-22" }, previewContext(LIVE)),
    buildPreview("incident-1", { ...alert, observedRespiratoryRate: 52 }, previewContext(LIVE)),
    buildPreview("incident-1", alert, previewContext({ ...LIVE, HERDRELAY_AUTHORIZED_E164: "+14155552672" })),
    buildPreview("incident-1", alert, previewContext({ ...LIVE, HERDRELAY_CARETAKER_NAME: "Someone Else" })),
    // The mode is part of the approval: a dry-run approval must not redeem for a real call.
    buildPreview("incident-1", alert, previewContext({} as Env)),
  ];
  for (const [index, variant] of variants.entries()) {
    assert.notEqual(variant.fingerprint, base.fingerprint, `variant ${index} kept the fingerprint`);
  }
});

test("key order in the preview object cannot change the fingerprint", () => {
  const preview = buildPreview("incident-1", alert, previewContext(LIVE));
  const { fingerprint, ...body } = preview;
  const shuffled = Object.fromEntries(Object.entries(body).reverse()) as typeof body;
  assert.equal(fingerprintPreview(shuffled), fingerprint);
});
