import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOperator } from "@/lib/auth";
import { prepareIncident, previewFor, workflowError } from "@/lib/incident";

export const runtime = "nodejs";

const Body = z.object({ alertId: z.string().min(1).max(64), scenario: z.string().max(64).optional() }).strict();

/** Prepare one incident from one alert. Prepares a call; places nothing. */
export async function POST(request: Request) {
  const denied = requireOperator(request);
  if (denied) return denied;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "An alertId is required. Destinations cannot be supplied by the browser." }, { status: 400 });
  }
  try {
    const incident = await prepareIncident(parsed.data.alertId, parsed.data.scenario);
    return NextResponse.json({ incident, preview: previewFor(incident) });
  } catch (error) {
    const { status, ...body } = workflowError(error);
    return NextResponse.json(body, { status });
  }
}
