/**
 * Named operator accounts, and the one claim they exist to support: that an
 * approval record can say which person made it.
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { accessDecision } from "../lib/access";
import {
  hashPassword,
  isValidUsername,
  loadOperators,
  operatorIdFor,
  saveOperator,
  verifyOperator,
} from "../lib/operators";
import type { Env } from "../lib/types";

let env: Env;

const PASSWORD = "correct-horse-battery";

before(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "herdrelay-operators-"));
  env = { HERDRELAY_OPERATORS_FILE: path.join(dir, "operators.json") } as Env;
});

beforeEach(async () => {
  await fs.rm(env.HERDRELAY_OPERATORS_FILE!, { force: true });
});

async function addMarta(): Promise<void> {
  const { salt, hash } = await hashPassword(PASSWORD);
  await saveOperator({ username: "marta", name: "Marta Nowak", salt, hash }, env);
}

test("a missing account file is no accounts, not an error", async () => {
  assert.deepEqual(await loadOperators(env), []);
});

test("a saved operator signs in and is identified by name", async () => {
  await addMarta();
  const operator = await verifyOperator("marta", PASSWORD, env);
  assert.equal(operator?.name, "Marta Nowak");
  assert.equal(operator?.shared, false);
  assert.equal(operator?.id, operatorIdFor("marta"));
});

test("a wrong password and an unknown account both fail, and neither is distinguishable", async () => {
  await addMarta();
  assert.equal(await verifyOperator("marta", "wrong-password-entirely", env), null);
  assert.equal(await verifyOperator("nobody", PASSWORD, env), null);
});

test("the stored record holds a hash and a salt, never the password", async () => {
  await addMarta();
  const raw = await fs.readFile(env.HERDRELAY_OPERATORS_FILE!, "utf8");
  assert.equal(raw.includes(PASSWORD), false);
  const [record] = await loadOperators(env);
  assert.match(record!.hash, /^[0-9a-f]{128}$/);
  assert.match(record!.salt, /^[0-9a-f]{32}$/);
});

test("the same password hashes differently for two operators", async () => {
  const first = await hashPassword(PASSWORD);
  const second = await hashPassword(PASSWORD);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
});

test("an operator keeps their identity across a password change", async () => {
  await addMarta();
  const before = await verifyOperator("marta", PASSWORD, env);
  const { salt, hash } = await hashPassword("a-different-password");
  await saveOperator({ username: "marta", name: "Marta Nowak", salt, hash }, env);
  const after = await verifyOperator("marta", "a-different-password", env);
  assert.equal(after?.id, before?.id);
  assert.equal(await verifyOperator("marta", PASSWORD, env), null);
});

test("saving an existing username replaces it rather than adding a second", async () => {
  await addMarta();
  await addMarta();
  assert.equal((await loadOperators(env)).length, 1);
});

test("malformed entries in the account file are ignored, not trusted", async () => {
  await fs.writeFile(
    env.HERDRELAY_OPERATORS_FILE!,
    JSON.stringify([
      { username: "ghost" },
      { username: "plain", name: "Plain Text", salt: "x", hash: "hunter2" },
      "not an object",
    ]),
  );
  assert.deepEqual(await loadOperators(env), []);
});

test("usernames are constrained", () => {
  for (const good of ["marta", "sam.okonkwo", "op-2", "a1"]) {
    assert.ok(isValidUsername(good), `rejected ${good}`);
  }
  for (const bad of ["", "a", "Marta", "has space", "x".repeat(33), "-leading"]) {
    assert.equal(isValidUsername(bad), false, `accepted ${bad}`);
  }
});

test("a deployment with named accounts does not also accept the shared token", async () => {
  await addMarta();
  const live = {
    ...env,
    HERDRELAY_MODE: "live",
    HERDRELAY_AUTHORIZED_E164: "+14155552671",
    HERDRELAY_CARETAKER_NAME: "Sam Okonkwo",
    CALLE_API_KEY: "test-key",
    HERDRELAY_AUTH_TOKEN: "x".repeat(32),
  } as Env;
  const basic = (user: string, password: string) =>
    new Headers({ authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` });

  const viaToken = await accessDecision({ method: "GET", headers: basic("herdrelay", "x".repeat(32)) }, live);
  assert.equal(viaToken.ok, false);

  const viaAccount = await accessDecision({ method: "GET", headers: basic("marta", PASSWORD) }, live);
  assert.equal(viaAccount.ok, true);
  assert.equal(viaAccount.ok === true && viaAccount.operator.name, "Marta Nowak");
  assert.equal(viaAccount.ok === true && viaAccount.operator.shared, false);
});
