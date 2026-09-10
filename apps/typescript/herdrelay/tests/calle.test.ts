import { test } from "node:test";
import assert from "node:assert/strict";
import { buildResultSchema, buildTask, calleClient, disclosureLine, LIMITATIONS, QUESTIONS } from "../lib/calle";
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

const task = buildTask(alert, { siteName: "Ridgeline Dairy", caretakerName: "Sam Okonkwo" });

test("the call identifies itself as an AI before it asks anything", () => {
  const disclosure = disclosureLine("Ridgeline Dairy");
  assert.match(disclosure, /AI/);
  assert.match(disclosure, /not a person and not a veterinarian/);
  assert.match(disclosure, /synthetic demonstration data/);
  assert.match(disclosure, /Nothing I say is a diagnosis/i);
  // The disclosure has to be the opening line, not a line somewhere in the brief.
  assert.ok(task.indexOf(disclosure) < task.indexOf(QUESTIONS[0]));
});

test("all five questions are scripted verbatim and in order", () => {
  let cursor = -1;
  for (const question of QUESTIONS) {
    const at = task.indexOf(question);
    assert.ok(at > cursor, `${question} is missing or out of order`);
    cursor = at;
  }
  assert.equal(QUESTIONS.length, 5);
});

test("the brief carries the alert's own numbers and calls them synthetic", () => {
  assert.match(task, /46 breaths per minute/);
  assert.match(task, /25 to 35/);
  assert.match(task, /91 percent/);
  assert.match(task, /C-17/);
  assert.match(task, /North Barn, Pen 4/);
  assert.match(task, /synthetic demonstration data/);
});

test("the brief refuses diagnosis, escalation, and every decision that is not the farm's", () => {
  for (const rule of [
    /not a veterinarian/i,
    /[Dd]o not diagnose/,
    /do not suggest a treatment/,
    /Do not offer to contact a veterinarian/,
    /cannot summon help/,
    /Do not promise any action/,
  ]) {
    assert.match(task, rule);
  }
});

test("the brief tells the caller to keep an unclear answer unclear", () => {
  assert.match(task, /never settle an unclear answer as a yes or a no/);
  assert.match(task, /that is "unknown"/);
});

test("the stated limitations name the boundaries the brief enforces", () => {
  const text = LIMITATIONS.join(" ");
  assert.match(text, /does not diagnose/);
  assert.match(text, /caller is an AI/);
  assert.match(text, /No veterinarian, emergency service, or supplier is contacted automatically/);
  assert.match(text, /One call per incident/);
});

test("every field a person could leave unstated has a way to say so", () => {
  const schema = buildResultSchema() as {
    properties: Record<string, { type: string; enum?: string[] }>;
    required: string[];
    additionalProperties: boolean;
  };
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required.sort(), Object.keys(schema.properties).sort());

  assert.deepEqual(schema.properties.inspection_accepted.enum, ["yes", "no", "unclear"]);
  assert.deepEqual(schema.properties.visible_distress.enum, ["yes", "no", "unknown"]);
  assert.deepEqual(schema.properties.veterinary_followup_requested.enum, ["yes", "no", "unclear"]);
  // A number cannot say "they did not tell me", so the estimate is a string.
  assert.equal(schema.properties.estimated_arrival_minutes.type, "string");
  assert.deepEqual(schema.properties.outcome.enum, [
    "inspection_confirmed",
    "followup_requested",
    "declined",
    "unanswered",
    "uncertain",
  ]);
});

test("the client refuses to send credentials anywhere but CALL-E's own origin", () => {
  assert.throws(
    () => calleClient({ CALLE_API_KEY: "test-key", CALLE_BASE_URL: "https://evil.example.com" } as Env),
    /api\.heycall-e\.com/,
  );
  assert.throws(() => calleClient({} as Env), /CALLE_API_KEY/);
  assert.doesNotThrow(() =>
    calleClient({ CALLE_API_KEY: "test-key", CALLE_BASE_URL: "https://api.heycall-e.com/" } as Env),
  );
});
