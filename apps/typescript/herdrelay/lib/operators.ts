/**
 * Named operator accounts.
 *
 * The point of this file is one line on the result screen: "Approved by Marta
 * Nowak". An approval is the record that a *person* authorized a phone call, so
 * an approval that names a deployment instead of a person is not really the
 * record it claims to be.
 *
 * Accounts live in a gitignored JSON file, created with `npm run operators:add`.
 * Passwords are stored as scrypt hashes with a per-account salt, never in
 * plaintext and never recoverable — a forgotten password is replaced, not
 * looked up.
 *
 * This is deliberately not an identity system. A real deployment should sit
 * behind the farm's existing SSO; see the README's Known limitations. What this
 * gives you is the part that actually matters for the audit trail — a name
 * attached to a decision — without requiring a registered OAuth application to
 * run the app from a fresh clone.
 */
import { promises as fs } from "node:fs";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import type { Env } from "./types";

// `promisify` only picks up scrypt's three-argument overload, so the options
// form is spelled out here rather than dropping the cost parameter.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/** OWASP's floor for interactive scrypt logins. */
const KEY_LENGTH = 64;
const SCRYPT_COST = 16384;

export type OperatorRecord = {
  username: string;
  name: string;
  salt: string;
  hash: string;
};

/** An authenticated person. `id` is stable; `name` is what gets written down. */
export type Operator = {
  id: string;
  name: string;
  /** True when this is the legacy shared token rather than a named account. */
  shared: boolean;
};

export const SHARED_TOKEN_OPERATOR_NAME = "Unnamed operator (shared token)";

/**
 * An account defined entirely by an environment variable, as
 * `username:Display Name:password`.
 *
 * It exists so a deployed instance can have a sign-in without anybody opening a
 * shell on the server to run `operators:add` — `operators.json` is gitignored
 * and never travels with the code. Nothing is written to disk, so it also works
 * on a read-only filesystem.
 *
 * The trade-off is real and worth stating: this password sits in the
 * deployment's environment in plaintext, where a file account stores only a
 * hash. It is meant for a demonstration account whose password is published
 * anyway, not for an operator whose approval means something.
 */
export function seededOperator(env: Env = process.env): { username: string; name: string; password: string } | null {
  const raw = env.HERDRELAY_OPERATOR_SEED?.trim();
  if (!raw) return null;
  const firstColon = raw.indexOf(":");
  const secondColon = raw.indexOf(":", firstColon + 1);
  if (firstColon < 1 || secondColon < firstColon + 2) return null;

  const username = raw.slice(0, firstColon).trim();
  const name = raw.slice(firstColon + 1, secondColon).trim();
  // Everything after the second colon, so a password may contain colons.
  const password = raw.slice(secondColon + 1);
  if (!isValidUsername(username) || !name || password.length < 8) return null;
  return { username, name, password };
}

export function operatorsFile(env: Env = process.env): string {
  return env.HERDRELAY_OPERATORS_FILE?.trim() || path.join(process.cwd(), "operators.json");
}

export async function loadOperators(env: Env = process.env): Promise<OperatorRecord[]> {
  let raw: string;
  try {
    raw = await fs.readFile(operatorsFile(env), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isOperatorRecord);
}

function isOperatorRecord(value: unknown): value is OperatorRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.username === "string" && record.username.length > 0 &&
    typeof record.name === "string" && record.name.length > 0 &&
    typeof record.salt === "string" && /^[0-9a-f]{32,}$/.test(record.salt) &&
    typeof record.hash === "string" && /^[0-9a-f]{64,}$/.test(record.hash)
  );
}

export async function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const derived = await scryptAsync(password, salt, KEY_LENGTH, { N: SCRYPT_COST });
  return { salt, hash: derived.toString("hex") };
}

/**
 * Check a username and password against the account file.
 *
 * Both a missing account and a wrong password return `null` with the same
 * message upstream, so the response cannot be used to enumerate who has an
 * account on the deployment.
 */
export async function verifyOperator(
  username: string,
  password: string,
  env: Env = process.env,
): Promise<Operator | null> {
  const seed = seededOperator(env);
  if (seed && seed.username === username) {
    const provided = Buffer.from(password);
    const expected = Buffer.from(seed.password);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
    return { id: operatorIdFor(seed.username), name: seed.name, shared: false };
  }

  const records = await loadOperators(env);
  const record = records.find((candidate) => candidate.username === username);
  if (!record) {
    // Spend comparable time on an unknown username so the failure does not
    // time-leak which half was wrong.
    await hashPassword(password);
    return null;
  }
  const { hash } = await hashPassword(password, record.salt);
  const provided = Buffer.from(hash, "hex");
  const stored = Buffer.from(record.hash, "hex");
  if (provided.length !== stored.length || !timingSafeEqual(provided, stored)) return null;
  return { id: operatorIdFor(record.username), name: record.name, shared: false };
}

/** Derived from the username, so an operator keeps their identity across a password change. */
export function operatorIdFor(username: string): string {
  return createHash("sha256").update(`herdrelay-operator:${username}`).digest("hex");
}

export async function saveOperator(record: OperatorRecord, env: Env = process.env): Promise<void> {
  const file = operatorsFile(env);
  const existing = await loadOperators(env);
  const next = [...existing.filter((candidate) => candidate.username !== record.username), record];
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
}

export function isValidUsername(username: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{1,31}$/.test(username);
}
