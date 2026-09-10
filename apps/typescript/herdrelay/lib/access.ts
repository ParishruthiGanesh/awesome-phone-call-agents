/**
 * Operator access rules.
 *
 * Live mode is credentialed without exception: a deployment that can make a
 * phone ring is never open. Dry run is allowed to run without any credential,
 * because it holds none and produces no side effect, and a hackathon demo that
 * demands a password before it will show a fixture is a demo nobody runs.
 *
 * Two credential sources, in this order:
 *
 *   1. Named accounts in `operators.json` (`npm run operators:add`). Preferred,
 *      because the approval record then carries a person's name rather than a
 *      hash of a shared secret — and "a human approved this call" is the whole
 *      claim the app makes.
 *   2. `HERDRELAY_AUTH_TOKEN`, a single shared password. Kept so an existing
 *      deployment does not break, but an approval taken this way is recorded as
 *      an unnamed operator, and the console says so.
 *
 * Pure of any web framework on purpose: the CLI scripts and the tests need
 * these rules without pulling Next.js in behind them.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { callMode } from "./mode";
import { loadOperators, SHARED_TOKEN_OPERATOR_NAME, verifyOperator, type Operator } from "./operators";
import type { Env } from "./types";

export function secretMatches(actual: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

/** The shared-token identity, when no named account is in play. */
export function operatorId(env: Env = process.env): string {
  const token = env.HERDRELAY_AUTH_TOKEN ?? "";
  if (token.length < 32) return "local-dry-run-operator";
  return createHash("sha256").update(token).digest("hex");
}

/** The operator a request with no credential acts as. Dry run only. */
export function anonymousOperator(env: Env = process.env): Operator {
  return { id: operatorId(env), name: "Local operator (no sign-in)", shared: true };
}

export type AccessDecision =
  | { ok: true; operator: Operator }
  | { ok: false; status: number; error: string; headers?: Record<string, string> };

const CHALLENGE = {
  "WWW-Authenticate": 'Basic realm="HerdRelay", charset="UTF-8"',
  "Cache-Control": "no-store",
};

function parseBasic(header: string): { username: string; password: string } | null {
  if (!header.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

/**
 * Decide whether a request may act, and as whom.
 */
export async function accessDecision(
  request: { method: string; headers: Headers },
  env: Env = process.env,
): Promise<AccessDecision> {
  const live = callMode(env) === "live";
  const accounts = await loadOperators(env);
  const token = env.HERDRELAY_AUTH_TOKEN ?? "";
  const hasToken = token.length >= 32;

  if (live && accounts.length === 0 && !hasToken) {
    return {
      ok: false,
      status: 503,
      error:
        "Live mode needs a signed-in operator. Create one with `npm run operators:add`, so the approval record names the person who authorized the call.",
    };
  }

  let operator: Operator | null = accounts.length === 0 && !hasToken ? anonymousOperator(env) : null;

  if (!operator) {
    const credentials = parseBasic(request.headers.get("authorization") ?? "");
    if (!credentials) {
      return { ok: false, status: 401, error: "Sign in to continue.", headers: CHALLENGE };
    }

    // Named accounts first; a deployment that has them should not be reachable
    // with the shared token as well.
    if (accounts.length > 0) {
      operator = await verifyOperator(credentials.username, credentials.password, env);
    } else if (
      credentials.username === "herdrelay" &&
      secretMatches(credentials.password, token)
    ) {
      operator = { id: operatorId(env), name: SHARED_TOKEN_OPERATOR_NAME, shared: true };
    }

    if (!operator) {
      // One message for both a wrong password and an unknown account, so this
      // cannot be used to learn who has an account here.
      return { ok: false, status: 401, error: "Sign in to continue.", headers: CHALLENGE };
    }
  }

  // A cross-site request must never be able to approve or start a call.
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    if (request.headers.get("sec-fetch-site") === "cross-site") {
      return { ok: false, status: 403, error: "Cross-origin changes are forbidden." };
    }
    const origin = request.headers.get("origin");
    const configured = env.HERDRELAY_ORIGIN?.trim();
    if (origin !== null && !originAllowed(origin, configured, request.headers.get("host"))) {
      return { ok: false, status: 403, error: "Cross-origin changes are forbidden." };
    }
  }

  return { ok: true, operator };
}

/**
 * Compare the browser's `Origin` against the origin this deployment answers on.
 *
 * When `HERDRELAY_ORIGIN` is set it is the only answer, which is what a
 * deployment behind a proxy needs. When it is not, the request's own `Host` is
 * used: a browser sets `Host` to the site it is talking to and a cross-site
 * page cannot change it, so the comparison still holds — and a local demo on
 * any port works without configuring anything.
 */
function originAllowed(origin: string, configured: string | undefined, host: string | null): boolean {
  if (configured) return origin === configured;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
