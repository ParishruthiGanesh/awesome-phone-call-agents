import { test } from "node:test";
import assert from "node:assert/strict";
import { destination, isE164, isReservedFictional, maskE164, syntheticDestination } from "../lib/phone";
import { redact } from "../lib/redact";
import { DRY_RUN_PHONE } from "../lib/dry-run";

test("only exact ASCII E.164 is accepted", () => {
  assert.ok(isE164("+14155552671"));
  for (const bad of [
    "14155552671",           // no plus
    "+1 415 555 2671",       // spaces
    "+1-415-555-2671",       // punctuation
    "+14155552671x22",       // extension
    "+０１２３４５６７８",      // full-width digits
    "+14155552671\n",        // trailing newline
    "+0415555267",           // leading zero
    "",
    null,
  ]) {
    assert.equal(isE164(bad), false, `accepted ${JSON.stringify(bad)}`);
  }
});

test("a destination must be routable and must identify its own country", () => {
  const parsed = destination("+14155552671");
  assert.equal(parsed.region, "US");
  assert.equal(parsed.locale, "en");
  assert.throws(() => destination("+1415555267"), /valid number/);
  assert.throws(() => destination("nonsense"), /E\.164/);
});

test("the reserved fictional range is refused as a live destination", () => {
  // This is the guarantee that keeps a demo number out of a real call: the
  // fixture number cannot pass the check a live call has to pass.
  assert.throws(() => destination(DRY_RUN_PHONE), /reserved fictional/);
  assert.ok(isReservedFictional(DRY_RUN_PHONE));
  assert.equal(syntheticDestination(DRY_RUN_PHONE).phone, DRY_RUN_PHONE);
});

test("a synthetic destination is refused for anything outside the fictional range", () => {
  assert.throws(() => syntheticDestination("+14155552671"), /reserved fictional/);
});

test("masking keeps the country code and two digits, and nothing else", () => {
  const masked = maskE164("+12025550142");
  assert.match(masked, /^\+1 •+42$/);
  assert.equal(masked.includes("2025550"), false);
  assert.equal(maskE164("+442079460958").startsWith("+44 "), true);
  assert.equal(maskE164("not a number"), "•••");
});

test("redaction masks every number-shaped string, wherever it appears", () => {
  const leak = "CALL-E rejected {\"phones\":[\"+12025550142\"]} for +442079460958";
  const safe = redact(leak);
  assert.equal(safe.includes("2025550142"), false);
  assert.equal(safe.includes("2079460958"), false);
  assert.match(safe, /\+1 •+42/);
  assert.match(safe, /\+44 •+58/);
});
