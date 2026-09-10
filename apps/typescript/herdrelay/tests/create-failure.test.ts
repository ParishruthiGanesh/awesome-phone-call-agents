/**
 * What a failed `calls.create` means.
 *
 * The asymmetry under test: HerdRelay may only say "no phone rang" when the
 * provider refused the request itself. Everything else, including anything
 * unrecognised, is unknown and must fail closed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CalleAPIError,
  CalleAuthenticationError,
  CalleConnectionError,
  CalleRateLimitError,
  CalleTimeoutError,
} from "@call-e/calle";
import { classifyCreateFailure } from "../lib/calle";

const apiError = (status: number, code = "bad_request") =>
  new CalleAPIError({ code, message: "CALL-E API request failed.", status });

test("a refused request means no phone rang", () => {
  for (const status of [400, 402, 404, 409, 422]) {
    const failure = classifyCreateFailure(apiError(status));
    assert.equal(failure.dialed, "no", `${status} was treated as unknown`);
  }
  assert.equal(
    classifyCreateFailure(new CalleAuthenticationError({ code: "unauthorized", message: "no", status: 401 })).dialed,
    "no",
  );
  assert.equal(
    classifyCreateFailure(new CalleRateLimitError({ code: "rate_limited", message: "slow down", status: 429 })).dialed,
    "no",
  );
});

test("a timeout or a dropped connection is never treated as a refusal", () => {
  assert.equal(classifyCreateFailure(new CalleTimeoutError("timed out")).dialed, "unknown");
  assert.equal(classifyCreateFailure(new CalleConnectionError("reset")).dialed, "unknown");
  // 408 is the one 4xx that may have been received and acted on.
  assert.equal(classifyCreateFailure(apiError(408, "request_timeout")).dialed, "unknown");
});

test("a server error is unknown, because the request may have been acted on", () => {
  for (const status of [500, 502, 503, 504]) {
    assert.equal(classifyCreateFailure(apiError(status, "internal_error")).dialed, "unknown");
  }
});

test("anything unrecognised fails closed", () => {
  for (const value of [new Error("who knows"), "a string", null, undefined, { status: 400 }]) {
    assert.equal(classifyCreateFailure(value).dialed, "unknown", `${String(value)} was trusted`);
  }
});

test("the reason names what to do, and carries the provider's own code", () => {
  const auth = classifyCreateFailure(
    new CalleAuthenticationError({ code: "unauthorized", message: "bad key", status: 401 }),
  );
  assert.match(auth.reason, /CALLE_API_KEY/);
  assert.equal(auth.code, "unauthorized");

  const refused = classifyCreateFailure(apiError(402, "insufficient_credits"));
  assert.match(refused.reason, /402 insufficient_credits/);
  assert.match(refused.reason, /no call was placed/);
});
