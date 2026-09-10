import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DryRunProviderFailure,
  loadScenario,
  scenarioLabels,
  simulateProgress,
  SIMULATED_DURATION_MS,
} from "../lib/dry-run";
import { normalizeCall } from "../lib/call-record";

test("every scenario in the menu has a fixture, except the one that models an absent answer", async () => {
  const labels = await scenarioLabels();
  for (const name of Object.keys(labels)) {
    if (name === "provider_failure") continue;
    const fixture = await loadScenario(name as "inspection_confirmed");
    assert.ok(fixture.call.id, `${name} has no call`);
  }
  await assert.rejects(() => loadScenario("provider_failure"), DryRunProviderFailure);
});

test("a call in flight reveals nothing terminal", async () => {
  const { call } = await loadScenario("inspection_confirmed");
  for (const elapsed of [0, 1_000, 5_000, SIMULATED_DURATION_MS - 1]) {
    const partial = normalizeCall(simulateProgress(call, elapsed));
    assert.equal(partial.structuredResult, null, `result leaked at ${elapsed}ms`);
    assert.equal(partial.summary, null);
    assert.equal(partial.taskCompleted, null);
    assert.equal(partial.completionConfidence, null);
    assert.equal(partial.failureCode, null);
    assert.equal(partial.completedAt, null);
    assert.ok(["queued", "in_progress"].includes(partial.status));
  }
});

test("the transcript arrives in order and only after the call has connected", async () => {
  const { call } = await loadScenario("inspection_confirmed");
  const queued = normalizeCall(simulateProgress(call, 0));
  assert.equal(queued.status, "queued");
  assert.equal(queued.transcript.length, 0);

  const early = normalizeCall(simulateProgress(call, 4_000));
  const late = normalizeCall(simulateProgress(call, 10_000));
  assert.ok(early.transcript.length > 0);
  assert.ok(late.transcript.length >= early.transcript.length);
  assert.deepEqual(late.transcript.slice(0, early.transcript.length), early.transcript);
});

test("the terminal state is the fixture itself, unmodified", async () => {
  const { call } = await loadScenario("followup_requested");
  assert.deepEqual(simulateProgress(call, SIMULATED_DURATION_MS), call);
  assert.deepEqual(simulateProgress(call, SIMULATED_DURATION_MS * 4), call);
});

test("a failed scenario carries a provider failure and no conversation to misread", async () => {
  const { call } = await loadScenario("unanswered");
  const record = normalizeCall(call);
  assert.equal(record.status, "failed");
  assert.equal(record.transcript.length, 0);
  assert.match(record.failureCode ?? "", /no_answer/);
});
