/** Next.js wrapper around the access rules in `lib/access.ts`. */
import { NextResponse } from "next/server";
import { accessDecision } from "./access";

export { accessDecision, operatorId, secretMatches } from "./access";
export type { AccessDecision } from "./access";

export function requireOperator(request: Request): NextResponse | null {
  const decision = accessDecision(request);
  if (decision.ok) return null;
  return NextResponse.json({ error: decision.error }, {
    status: decision.status,
    headers: decision.headers,
  });
}
