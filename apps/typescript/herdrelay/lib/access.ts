/**
 * Operator access rules.
 *
 * Live mode is credentialed without exception: a deployment that can make a
 * phone ring is never open. Dry run is allowed to run without a token, because
 * it holds no credential and produces no side effect, and a hackathon demo that
 * demands a password before it will show a fixture is a demo nobody runs. Set
 * `HERDRELAY_AUTH_TOKEN` and dry run asks for it too.
 *
 * Pure on purpose: the CLI scripts and the tests need these rules without
 * pulling a web framework in behind them.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { callMode } from "./mode";
import type { Env } from "./types";

export function secretMatches(actual: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

/** Stable per-deployment operator identity. Never a session id, never a header. */
export function operatorId(env: Env = process.env): string {
  const token = env.HERDRELAY_AUTH_TOKEN ?? "";
  if (token.length < 32) return "local-dry-run-operator";
  return createHash("sha256").update(token).digest("hex");
}

export type AccessDecision = { ok: true } | { ok: false; status: number; error: string; headers?: Record<string, string> };

/**
 * Decide whether a request may act. Pure, so the rules are testable without a
 * running server; `requireOperator` is the thin Next.js wrapper around it.
 */
export function accessDecision(
  request: { method: string; headers: Headers },
  env: Env = process.env,
): AccessDecision {
  const token = env.HERDRELAY_AUTH_TOKEN ?? "";
  const live = callMode(env) === "live";

  if (live && token.length < 32) {
    return {
      ok: false,
      status: 503,
      error: "Live mode requires HERDRELAY_AUTH_TOKEN with at least 32 random characters.",
    };
  }

  if (token.length >= 32) {
    const expected = `Basic ${Buffer.from(`herdrelay:${token}`).toString("base64")}`;
    if (!secretMatches(request.headers.get("authorization") ?? "", expected)) {
      return {
        ok: false,
        status: 401,
        error: "Authentication required.",
        headers: {
          "WWW-Authenticate": 'Basic realm="HerdRelay", charset="UTF-8"',
          "Cache-Control": "no-store",
        },
      };
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

  return { ok: true };
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
