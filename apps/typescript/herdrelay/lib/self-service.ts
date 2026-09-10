/**
 * Self-service demo mode.
 *
 * Off unless `HERDRELAY_SELF_SERVICE=true`. When it is on, the person using the
 * console supplies the number to call and states that it is their own, instead
 * of the destination coming from the server's configuration.
 *
 * That is a genuinely more dangerous shape — a public page that dials a number
 * a stranger typed is an open dialer — so it is only defensible with all of
 * these holding at once:
 *
 *   1. The number is accompanied by an explicit statement of consent, recorded
 *      with a timestamp, from the person who will be called.
 *   2. A number may be called once, ever. There is no second call to a phone
 *      this deployment has already rung.
 *   3. A whole-deployment daily cap, so abuse is bounded and cheap.
 *   4. A per-visitor attempt limit, so one person cannot burn the cap alone.
 *   5. The console still requires a sign-in.
 *   6. The number itself is never written into the incident record, and is
 *      erased once the call is over.
 *
 * None of this makes an open dialer safe. It makes a supervised demonstration
 * bounded. It is not something to leave running unattended.
 */
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { destination, maskE164, type Destination } from "./phone";
import { dataDir, isIncidentId } from "./store";
import type { Env } from "./types";

export const DEFAULT_DAILY_CAP = 5;
export const DEFAULT_VISITOR_ATTEMPTS = 3;
const VISITOR_WINDOW_MS = 60 * 60_000;

export function isSelfService(env: Env = process.env): boolean {
  return env.HERDRELAY_SELF_SERVICE === "true";
}

export function dailyCap(env: Env = process.env): number {
  const configured = Number(env.HERDRELAY_DAILY_CALL_CAP);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_DAILY_CAP;
}

export function visitorAttemptLimit(env: Env = process.env): number {
  const configured = Number(env.HERDRELAY_VISITOR_ATTEMPTS);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_VISITOR_ATTEMPTS;
}

export class SelfServiceRefusal extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Hashed, so no directory listing is a phone book and no log line is an address. */
function fingerprint(value: string): string {
  return createHash("sha256").update(`herdrelay:${value}`).digest("hex");
}

const calledFile = (phone: string) =>
  path.join(dataDir(), "called-numbers", `${fingerprint(phone)}.json`);
const visitorFile = (visitor: string) =>
  path.join(dataDir(), "visitors", `${fingerprint(visitor)}.json`);
const dayFile = (day: string) => path.join(dataDir(), "daily", `${day}.json`);

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify(value), { mode: 0o600 });
}

export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 2. One call per number, ever
// ---------------------------------------------------------------------------

export async function numberAlreadyCalled(phone: string): Promise<boolean> {
  return (await readJson<{ at?: string } | null>(calledFile(phone), null)) !== null;
}

export async function recordNumberCalled(phone: string): Promise<void> {
  await writeJson(calledFile(phone), { at: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// 3. Whole-deployment daily cap
// ---------------------------------------------------------------------------

export async function callsToday(now = new Date()): Promise<number> {
  const record = await readJson<{ count?: number }>(dayFile(today(now)), {});
  return typeof record.count === "number" ? record.count : 0;
}

export async function recordCallToday(now = new Date()): Promise<void> {
  const day = today(now);
  const count = (await callsToday(now)) + 1;
  await writeJson(dayFile(day), { day, count });
}

// ---------------------------------------------------------------------------
// 4. Per-visitor attempt limit
// ---------------------------------------------------------------------------

export async function visitorAttempts(visitor: string, now = Date.now()): Promise<number> {
  const record = await readJson<{ attempts?: number[] }>(visitorFile(visitor), {});
  const attempts = Array.isArray(record.attempts) ? record.attempts : [];
  return attempts.filter((at) => now - at < VISITOR_WINDOW_MS).length;
}

export async function recordVisitorAttempt(visitor: string, now = Date.now()): Promise<void> {
  const record = await readJson<{ attempts?: number[] }>(visitorFile(visitor), {});
  const attempts = (Array.isArray(record.attempts) ? record.attempts : []).filter(
    (at) => now - at < VISITOR_WINDOW_MS,
  );
  await writeJson(visitorFile(visitor), { attempts: [...attempts, now] });
}

/**
 * Identify the visitor for rate limiting.
 *
 * Behind a proxy the left-most `x-forwarded-for` entry is the client. It is
 * spoofable, which is why it is one limit among several rather than the only
 * one. Hashed immediately: this is a counter, not a visitor log.
 */
export function visitorId(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  return first || headers.get("x-real-ip") || "unknown-visitor";
}

// ---------------------------------------------------------------------------
// 6. The number lives outside the incident record, and only while it is needed
// ---------------------------------------------------------------------------

const pendingFile = (incidentId: string) =>
  path.join(dataDir(), "pending-destinations", `${incidentId}.json`);

export type PendingDestination = { phone: string; caretakerName: string };

export async function storePendingDestination(
  incidentId: string,
  pending: PendingDestination,
): Promise<void> {
  if (!isIncidentId(incidentId)) throw new SelfServiceRefusal("Unknown incident.", 404);
  await writeJson(pendingFile(incidentId), pending);
}

export async function readPendingDestination(incidentId: string): Promise<PendingDestination | null> {
  if (!isIncidentId(incidentId)) return null;
  const record = await readJson<Partial<PendingDestination>>(pendingFile(incidentId), {});
  if (typeof record.phone !== "string") return null;
  return {
    phone: record.phone,
    caretakerName: typeof record.caretakerName === "string" ? record.caretakerName : "Demo participant",
  };
}

/** Erased once the call is over: the number is not needed to read the result. */
export async function clearPendingDestination(incidentId: string): Promise<void> {
  if (!isIncidentId(incidentId)) return;
  await fs.rm(pendingFile(incidentId), { force: true });
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export type ConsentRequest = {
  phone: unknown;
  consent: unknown;
  name?: unknown;
  visitor: string;
};

export type AcceptedConsent = {
  destination: Destination;
  caretakerName: string;
  consentedAt: string;
  visitorFingerprint: string;
};

/**
 * Every check, in the order that fails cheapest first, with the consent
 * statement checked before anything is recorded.
 */
export async function acceptConsent(
  request: ConsentRequest,
  env: Env = process.env,
): Promise<AcceptedConsent> {
  if (!isSelfService(env)) {
    throw new SelfServiceRefusal("This deployment does not accept caller-supplied numbers.", 403);
  }

  if (request.consent !== true) {
    throw new SelfServiceRefusal(
      "Confirm that the number is your own and that you agree to receive one automated AI call.",
    );
  }

  if (typeof request.phone !== "string") {
    throw new SelfServiceRefusal("Enter the phone number to call, in E.164 form.");
  }

  let resolved: Destination;
  try {
    resolved = destination(request.phone.trim());
  } catch (error) {
    throw new SelfServiceRefusal(
      error instanceof Error
        ? `${error.message} For example +14155552671.`
        : "That is not a dialable number.",
    );
  }

  const attempts = await visitorAttempts(request.visitor);
  if (attempts >= visitorAttemptLimit(env)) {
    throw new SelfServiceRefusal(
      "Too many attempts from here. Try again later, or watch the no-call demo instead.",
      429,
    );
  }
  await recordVisitorAttempt(request.visitor);

  if (await numberAlreadyCalled(resolved.phone)) {
    throw new SelfServiceRefusal(
      "This demo calls any given number once only, and that number has already been called.",
      409,
    );
  }

  const cap = dailyCap(env);
  if ((await callsToday()) >= cap) {
    throw new SelfServiceRefusal(
      `This demo is capped at ${cap} calls a day and today's are used up. The no-call demo still works in full.`,
      429,
    );
  }

  const name = typeof request.name === "string" ? request.name.trim().slice(0, 60) : "";

  return {
    destination: resolved,
    caretakerName: name || "Demo participant",
    consentedAt: new Date().toISOString(),
    visitorFingerprint: fingerprint(request.visitor),
  };
}

/** Spend the two budgets. Called once the provider has accepted the call. */
export async function recordCallPlaced(phone: string): Promise<void> {
  await recordNumberCalled(phone);
  await recordCallToday();
}

export { maskE164 };
