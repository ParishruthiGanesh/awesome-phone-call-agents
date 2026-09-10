/** Next.js wrapper around the access rules in `lib/access.ts`. */
import { NextResponse } from "next/server";
import { accessDecision } from "./access";
import type { Operator } from "./operators";

export { accessDecision, anonymousOperator, operatorId, secretMatches } from "./access";
export type { AccessDecision } from "./access";

export type Authorized = { denied: NextResponse; operator: null } | { denied: null; operator: Operator };

/**
 * Authenticate a request. Every route handler starts with this and either
 * returns `denied` or acts as `operator`.
 */
export async function requireOperator(request: Request): Promise<Authorized> {
  const decision = await accessDecision(request);
  if (decision.ok) return { denied: null, operator: decision.operator };
  return {
    denied: NextResponse.json({ error: decision.error }, {
      status: decision.status,
      headers: decision.headers,
    }),
    operator: null,
  };
}
