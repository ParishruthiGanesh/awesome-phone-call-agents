import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { callMode } from "@/lib/mode";
import { listIncidents, resetAll } from "@/lib/store";

export const runtime = "nodejs";

/**
 * Clear the demo.
 *
 * Refused in live mode: those incident files are the only record that a real
 * person's phone rang, and a reset button is not a reason to lose it.
 */
export async function POST(request: Request) {
  const denied = requireOperator(request);
  if (denied) return denied;
  if (callMode() === "live") {
    return NextResponse.json(
      { error: "Reset is disabled in live mode. Real call records are not demo state." },
      { status: 403 },
    );
  }
  const cleared = (await listIncidents()).length;
  await resetAll();
  return NextResponse.json({ cleared });
}
