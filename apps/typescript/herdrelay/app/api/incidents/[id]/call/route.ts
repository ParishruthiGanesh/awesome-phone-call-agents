import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { placeCall, previewFor, workflowError } from "@/lib/incident";

export const runtime = "nodejs";

/**
 * Place the one approved call.
 *
 * The body carries nothing. There is no number, no task, and no mode to
 * override: everything that determines what happens was fixed at approval and
 * is re-derived from the server's own configuration.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { denied, operator } = await requireOperator(request);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    const incident = await placeCall(id, operator);
    return NextResponse.json({ incident, preview: previewFor(incident) });
  } catch (error) {
    const { status, ...body } = workflowError(error);
    return NextResponse.json(body, { status });
  }
}
