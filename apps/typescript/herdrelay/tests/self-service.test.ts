/**
 * Self-service demo mode: the six locks, each tested on its own.
 *
 * The shape being defended here is a public page that dials a number a
 * stranger typed. Every one of these has to hold for that to be defensible, so
 * every one of them gets a test that fails loudly if it stops holding.
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { anonymousOperator } from "../lib/access";
import {
  approveIncident,
  isFinished,
  placeCall,
  prepareIncident,
  previewFor,
  refreshIncident,
} from "../lib/incident";
import {
  acceptConsent,
  callsToday,
  isSelfService,
  numberAlreadyCalled,
  readPendingDestination,
  recordCallPlaced,
  SelfServiceRefusal,
  visitorAttempts,
} from "../lib/self-service";
import { resetAll, saveIncident, getIncident } from "../lib/store";
import { SIMULATED_DURATION_MS } from "../lib/dry-run";
import type { Env, Incident } from "../lib/types";

const ALERT = "alert_c17_0412";
const OPERATOR = { ...anonymousOperator({} as Env), name: "Judge" };
const PHONE = "+14155552671";
const VISITOR = "203.0.113.7";

const consented = (over: Record<string, unknown> = {}) => ({
  phone: PHONE,
  consent: true as unknown,
  name: "Devpost Judge",
  visitor: VISITOR,
  ...over,
});

before(async () => {
  process.env.HERDRELAY_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "herdrelay-selfservice-"));
  process.env.HERDRELAY_SELF_SERVICE = "true";
  delete process.env.HERDRELAY_MODE;
});

beforeEach(async () => {
  await resetAll();
  delete process.env.HERDRELAY_DAILY_CALL_CAP;
});

async function runToCompletion(incident: Incident): Promise<Incident> {
  const preview = await previewFor(incident);
  const { incident: approved } = await approveIncident(incident.id, preview.fingerprint, OPERATOR);
  const placed = await placeCall(approved.id, OPERATOR);
  const started = new Date(Date.now() - SIMULATED_DURATION_MS - 1_000).toISOString();
  await saveIncident({ ...placed, call: { ...placed.call!, createdAt: started } });
  return refreshIncident(placed.id);
}

// --- 1. consent ------------------------------------------------------------

test("nothing is prepared without the consent statement", async () => {
  for (const value of [undefined, false, "true", 1, null]) {
    await assert.rejects(
      () => prepareIncident(ALERT, undefined, consented({ consent: value })),
      (error: SelfServiceRefusal) => {
        assert.match(error.message, /agree to receive one automated AI call/);
        return true;
      },
      `consent ${JSON.stringify(value)} was accepted`,
    );
  }
  // And a refused request costs nothing: no number is recorded as called.
  assert.equal(await numberAlreadyCalled(PHONE), false);
  assert.equal(await callsToday(), 0);
});

test("the consent statement is recorded on the incident, with a timestamp", async () => {
  const incident = await prepareIncident(ALERT, undefined, consented());
  assert.ok(incident.consent);
  assert.match(incident.consent!.statement, /my own phone number/);
  assert.ok(Number.isFinite(Date.parse(incident.consent!.consentedAt)));
  assert.match(incident.consent!.recipientMasked, /^\+1 •+71$/);
  assert.match(incident.consent!.visitorFingerprint, /^[0-9a-f]{64}$/);
});

test("an unusable number is refused with advice, before anything is spent", async () => {
  for (const bad of ["", "4155552671", "+1 415 555 2671", "not a phone", "+1415555267"]) {
    await assert.rejects(() => prepareIncident(ALERT, undefined, consented({ phone: bad })));
  }
  assert.equal(await callsToday(), 0);
});

// --- 2. one call per number, ever ------------------------------------------

test("a number this deployment has called can never be called again", async () => {
  const first = await prepareIncident(ALERT, undefined, consented());
  const finished = await runToCompletion(first);
  assert.ok(isFinished(finished));
  assert.equal(await numberAlreadyCalled(PHONE), true);

  await assert.rejects(
    () => prepareIncident("alert_d22_0411", undefined, consented()),
    /already been called/,
  );
});

test("the number is spent when the call is accepted, not when it completes", async () => {
  const incident = await prepareIncident(ALERT, undefined, consented());
  const preview = await previewFor(incident);
  const { incident: approved } = await approveIncident(incident.id, preview.fingerprint, OPERATOR);
  await placeCall(approved.id, OPERATOR); // in flight, not finished
  assert.equal(await numberAlreadyCalled(PHONE), true);
});

// --- 3. daily cap ----------------------------------------------------------

test("the deployment stops calling once the daily cap is spent", async () => {
  process.env.HERDRELAY_DAILY_CALL_CAP = "2";
  await recordCallPlaced("+14155550001");
  await recordCallPlaced("+14155550002");
  assert.equal(await callsToday(), 2);

  await assert.rejects(
    () => prepareIncident(ALERT, undefined, consented()),
    /capped at 2 calls a day/,
  );
});

test("an unusable cap value falls back to the default rather than to no cap", async () => {
  for (const value of ["0", "-1", "many", ""]) {
    process.env.HERDRELAY_DAILY_CALL_CAP = value;
    const { dailyCap } = await import("../lib/self-service");
    assert.equal(dailyCap(), 5, `cap ${value} disabled the limit`);
  }
});

// --- 4. per-visitor attempts ----------------------------------------------

test("one visitor cannot burn the whole cap alone", async () => {
  process.env.HERDRELAY_VISITOR_ATTEMPTS = "2";
  await acceptConsent(consented({ phone: "+14155550011" }));
  await acceptConsent(consented({ phone: "+14155550012" }));
  await assert.rejects(
    () => acceptConsent(consented({ phone: "+14155550013" })),
    /Too many attempts from here/,
  );
  // A different visitor is unaffected.
  await assert.doesNotReject(() =>
    acceptConsent(consented({ phone: "+14155550014", visitor: "198.51.100.9" })),
  );
  delete process.env.HERDRELAY_VISITOR_ATTEMPTS;
});

test("attempts are counted even when the request is later refused", async () => {
  process.env.HERDRELAY_DAILY_CALL_CAP = "1";
  await recordCallPlaced("+14155550031");
  await acceptConsent(consented({ phone: "+14155550032" })).catch(() => undefined);
  assert.equal(await visitorAttempts(VISITOR), 1, "a refused request cost the visitor nothing");
});

test("a number cannot be called twice by preparing two incidents before either dials", async () => {
  // Both are prepared while the number is still unspent, so only the dial-time
  // check can stop the second one.
  const first = await prepareIncident(ALERT, undefined, consented());
  const second = await prepareIncident("alert_d22_0411", undefined, consented());

  await runToCompletion(first);
  assert.equal(await numberAlreadyCalled(PHONE), true);

  const preview = await previewFor(second);
  const { incident: approved } = await approveIncident(second.id, preview.fingerprint, OPERATOR);
  await assert.rejects(() => placeCall(approved.id, OPERATOR), /already been called/);
});

// --- 6. the number stays off the record, and is erased ---------------------

test("the incident record never contains the number, only its masked form", async () => {
  const incident = await prepareIncident(ALERT, undefined, consented());
  const stored = JSON.stringify(await getIncident(incident.id));
  assert.equal(stored.includes("4155552671"), false);
  assert.equal(stored.includes(PHONE), false);
  assert.ok(stored.includes("•"));
});

test("the number is erased once the call is over", async () => {
  const incident = await prepareIncident(ALERT, undefined, consented());
  assert.equal((await readPendingDestination(incident.id))?.phone, PHONE);
  const finished = await runToCompletion(incident);
  assert.ok(isFinished(finished));
  assert.equal(await readPendingDestination(incident.id), null);
});

test("an incident whose number has been erased cannot be called again", async () => {
  const incident = await prepareIncident(ALERT, undefined, consented());
  const finished = await runToCompletion(incident);
  await assert.rejects(() => previewFor(finished), /no longer held/);
});

// --- the mode itself -------------------------------------------------------

test("caller-supplied numbers are refused outright when the mode is off", async () => {
  process.env.HERDRELAY_SELF_SERVICE = "false";
  assert.equal(isSelfService(), false);
  // With the mode off the request body is ignored and the configured
  // destination is used, so a browser cannot steer the call anywhere.
  const incident = await prepareIncident(ALERT, undefined, consented());
  assert.equal(incident.consent, null);
  await assert.rejects(() => acceptConsent(consented()), /does not accept caller-supplied numbers/);
  process.env.HERDRELAY_SELF_SERVICE = "true";
});
