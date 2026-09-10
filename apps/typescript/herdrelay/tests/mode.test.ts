import { test } from "node:test";
import assert from "node:assert/strict";
import { accessDecision, operatorId } from "../lib/access";
import { callMode, dryRunScenario, liveReadiness } from "../lib/mode";
import type { Env } from "../lib/types";

const LIVE = {
  HERDRELAY_MODE: "live",
  HERDRELAY_AUTHORIZED_E164: "+14155552671",
  HERDRELAY_CARETAKER_NAME: "Sam Okonkwo",
  CALLE_API_KEY: "test-key",
  HERDRELAY_AUTH_TOKEN: "x".repeat(32),
} as Env;

test("anything that is not exactly `live` is a dry run", () => {
  for (const value of [undefined, "", "dry_run", "LIVE", "live ", "production", "true"]) {
    assert.equal(callMode({ HERDRELAY_MODE: value } as Env), "dry_run", `mode ${value} dialed`);
  }
  assert.equal(callMode({ HERDRELAY_MODE: "live" } as Env), "live");
});

test("an unrecognised scenario falls back to the safe default", () => {
  assert.equal(dryRunScenario({ HERDRELAY_DRY_RUN_SCENARIO: "nope" } as Env), "inspection_confirmed");
  assert.equal(dryRunScenario({ HERDRELAY_DRY_RUN_SCENARIO: "declined" } as Env), "declined");
});

test("live readiness fails closed on every missing piece, and names none of the secrets", () => {
  assert.equal(liveReadiness({} as Env).ready, false);
  for (const missing of ["HERDRELAY_AUTHORIZED_E164", "CALLE_API_KEY", "HERDRELAY_AUTH_TOKEN", "HERDRELAY_CARETAKER_NAME"]) {
    const env = { ...LIVE, [missing]: "" } as Env;
    const readiness = liveReadiness(env);
    assert.equal(readiness.ready, false, `${missing} was not required`);
    assert.equal(readiness.ready === false && readiness.reason.includes("+1415"), false);
  }
  assert.equal(liveReadiness(LIVE).ready, true);
});

test("live mode is never open, and dry run without a credential still refuses cross-origin writes", async () => {
  const headers = (extra: Record<string, string> = {}) => new Headers(extra);
  const decide = (init: { method: string; headers: Headers }, env: Env) => accessDecision(init, env);

  const noCredential = await decide({ method: "POST", headers: headers() }, { HERDRELAY_MODE: "live" } as Env);
  assert.equal(noCredential.ok, false);
  assert.equal(noCredential.ok === false && noCredential.status, 503);
  assert.match(noCredential.ok === false ? noCredential.error : "", /operators:add/);

  const unauthenticated = await decide({ method: "GET", headers: headers() }, LIVE);
  assert.equal(unauthenticated.ok, false);
  assert.equal(unauthenticated.ok === false && unauthenticated.status, 401);

  const authorization = `Basic ${Buffer.from(`herdrelay:${"x".repeat(32)}`).toString("base64")}`;
  const signedIn = await decide({ method: "GET", headers: headers({ authorization }) }, LIVE);
  assert.equal(signedIn.ok, true);
  // The shared token can act, but it cannot claim to be a person.
  assert.equal(signedIn.ok === true && signedIn.operator.shared, true);

  const crossSite = await decide(
    { method: "POST", headers: headers({ authorization, "sec-fetch-site": "cross-site" }) },
    LIVE,
  );
  assert.equal(crossSite.ok, false);
  assert.equal(crossSite.ok === false && crossSite.status, 403);

  const wrongOrigin = await decide(
    { method: "POST", headers: headers({ origin: "https://elsewhere.example", host: "localhost:3000" }) },
    {} as Env,
  );
  assert.equal(wrongOrigin.ok, false);

  // With no configured origin, the request's own Host is the comparison, so a
  // demo on any port works while a cross-site page still cannot post to it.
  assert.equal(
    (await decide(
      { method: "POST", headers: headers({ origin: "http://localhost:3123", host: "localhost:3123" }) },
      {} as Env,
    )).ok,
    true,
  );
  assert.equal(
    (await decide(
      { method: "POST", headers: headers({ origin: "http://localhost:3123", host: "localhost:3000" }) },
      {} as Env,
    )).ok,
    false,
  );
  // A configured origin is the only answer, whatever Host claims.
  assert.equal(
    (await decide(
      { method: "POST", headers: headers({ origin: "http://localhost:3123", host: "localhost:3123" }) },
      { HERDRELAY_ORIGIN: "https://herdrelay.example" } as Env,
    )).ok,
    false,
  );

  // Dry run with nothing configured stays open, which is what makes the demo runnable.
  const open = await decide({ method: "POST", headers: headers() }, {} as Env);
  assert.equal(open.ok, true);
  assert.equal(open.ok === true && open.operator.shared, true);
});

test("the operator identity is derived from the token and never leaks it", () => {
  const id = operatorId({ HERDRELAY_AUTH_TOKEN: "y".repeat(40) } as Env);
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(id.includes("yyyy"), false);
  assert.equal(operatorId({} as Env), "local-dry-run-operator");
});
