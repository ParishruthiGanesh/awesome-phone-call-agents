import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOperator } from "@/lib/auth";
import { reconcileIncident, workflowError } from "@/lib/incident";

export const runtime = "nodejs";

const Body = z.object({ callId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional() }).strict();

/** Resolve an incident whose create request never came back. Never dials. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireOperator(request);
  if (denied) return denied;
  const { id } = await context.params;
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Provide the CALL-E call ID to reconcile." }, { status: 400 });
  try {
    const incident = await reconcileIncident(id, parsed.data.callId ?? "");
    return NextResponse.json({ incident });
  } catch (error) {
    const { status, ...body } = workflowError(error);
    return NextResponse.json(body, { status });
  }
}
