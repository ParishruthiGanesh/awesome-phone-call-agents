import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { previewFor, workflowError } from "@/lib/incident";
import { getIncident } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { denied } = await requireOperator(request);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    const incident = await getIncident(id);
    if (!incident) return NextResponse.json({ error: "Unknown incident." }, { status: 404 });
    return NextResponse.json({ incident, preview: await previewFor(incident) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const { status, ...body } = workflowError(error);
    return NextResponse.json(body, { status });
  }
}
