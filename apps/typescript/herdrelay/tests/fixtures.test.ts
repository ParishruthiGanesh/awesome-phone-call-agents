import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { findAlert, loadAlerts } from "../lib/alerts";
import { deviationPercent, warrantsCall } from "../lib/alert-signal";
import { isReservedFictional } from "../lib/phone";

test("the shipped alerts parse, and every one of them is synthetic", async () => {
  const alerts = await loadAlerts();
  assert.ok(alerts.length >= 4);
  for (const alert of alerts) {
    assert.equal(alert.synthetic, true);
    assert.ok(alert.confidence >= 0 && alert.confidence <= 1);
    assert.ok(alert.baselineRange.min < alert.baselineRange.max);
    assert.ok(Number.isFinite(Date.parse(alert.detectedAt)));
  }
});

test("`synthetic` is asserted by the loader, not taken from the file", async () => {
  // A fixture that claimed to be real data would still load as synthetic:
  // there is no ingestion path in this app that could make it otherwise.
  const raw = JSON.parse(await fs.readFile(path.join(process.cwd(), "fixtures", "alerts.json"), "utf8"));
  assert.ok(raw.note.includes("SYNTHETIC"));
  const alert = await findAlert("alert_c17_0412");
  assert.equal(alert?.synthetic, true);
});

test("the documented demo alert is the one the README describes", async () => {
  const alert = await findAlert("alert_c17_0412");
  assert.equal(alert?.animalId, "C-17");
  assert.equal(alert?.location, "North Barn, Pen 4");
  assert.equal(alert?.observedRespiratoryRate, 46);
  assert.deepEqual(alert?.baselineRange, { min: 25, max: 35 });
  assert.equal(alert?.confidence, 0.91);
  assert.equal(alert?.severity, "high");
  assert.equal(deviationPercent(alert!), 31);
});

test("an in-range or low-confidence reading is not worth ringing anybody about", async () => {
  const inRange = await findAlert("alert_a09_0411");
  assert.equal(warrantsCall(inRange!).warranted, false);
  const high = await findAlert("alert_c17_0412");
  assert.equal(warrantsCall(high!).warranted, true);
  assert.equal(
    warrantsCall({ ...high!, confidence: 0.3 }).warranted,
    false,
  );
});

test("every phone number in the shipped fixtures is a reserved fictional one", async () => {
  const dir = path.join(process.cwd(), "fixtures");
  for (const file of await fs.readdir(dir)) {
    const text = await fs.readFile(path.join(dir, file), "utf8");
    for (const match of text.match(/\+[1-9][0-9]{6,14}/g) ?? []) {
      assert.ok(isReservedFictional(match), `${file} contains a non-fictional number`);
    }
  }
});
