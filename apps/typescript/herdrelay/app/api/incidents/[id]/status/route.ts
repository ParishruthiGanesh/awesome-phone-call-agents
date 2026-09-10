import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { isFinished, refreshIncident, workflowError } from "@/lib/incident";
import { getIncident } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Poll one incident. Read-only against the provider. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireOperator(request);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    const incident = await refreshIncident(id);
    return NextResponse.json(
      { incident, finished: isFinished(incident) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // A failed poll must not erase what was already established, so the last
    // verified state is returned alongside the error.
    const last = await getIncident(id).catch(() => null);
    const { status, ...body } = workflowError(error);
    if (last) return NextResponse.json({ incident: last, finished: isFinished(last), pollError: body.error });
    return NextResponse.json(body, { status });
  }
}
