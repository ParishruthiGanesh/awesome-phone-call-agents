import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOperator } from "@/lib/auth";
import { approveIncident, workflowError } from "@/lib/incident";

export const runtime = "nodejs";

const Body = z.object({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/) }).strict();

/**
 * The approval gate.
 *
 * The fingerprint is the whole point: it binds the approval to the exact call
 * that was on screen, so this endpoint cannot be used to approve a call the
 * operator has not read.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { denied, operator } = await requireOperator(request);
  if (denied) return denied;
  const { id } = await context.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Approval must carry the fingerprint of the previewed call." }, { status: 400 });
  }
  try {
    const { incident, preview } = await approveIncident(id, parsed.data.fingerprint, operator);
    return NextResponse.json({ incident, preview });
  } catch (error) {
    const { status, ...body } = workflowError(error);
    return NextResponse.json(body, { status });
  }
}
