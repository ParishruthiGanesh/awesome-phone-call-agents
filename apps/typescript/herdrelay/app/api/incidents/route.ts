import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOperator } from "@/lib/auth";
import { prepareIncident, previewFor, workflowError } from "@/lib/incident";
import { visitorId } from "@/lib/self-service";

export const runtime = "nodejs";

const Body = z
  .object({
    alertId: z.string().min(1).max(64),
    scenario: z.string().max(64).optional(),
    // Self-service demo mode only. Ignored entirely when it is off, so a
    // configured deployment cannot be steered to another number by a request.
    phone: z.string().max(20).optional(),
    name: z.string().max(60).optional(),
    consent: z.boolean().optional(),
  })
  .strict();

/** Prepare one incident from one alert. Prepares a call; places nothing. */
export async function POST(request: Request) {
  const { denied } = await requireOperator(request);
  if (denied) return denied;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "An alertId is required." }, { status: 400 });
  }
  try {
    const incident = await prepareIncident(parsed.data.alertId, parsed.data.scenario, {
      phone: parsed.data.phone,
      name: parsed.data.name,
      consent: parsed.data.consent,
      visitor: visitorId(request.headers),
    });
    return NextResponse.json({ incident, preview: await previewFor(incident) });
  } catch (error) {
    const { status, ...body } = workflowError(error);
    return NextResponse.json(body, { status });
  }
}
