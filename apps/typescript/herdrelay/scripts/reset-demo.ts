/** Clear every incident, lock, and destination reservation. Dry run only. */
import { callMode } from "../lib/mode";
import { listIncidents, resetAll } from "../lib/store";

async function main(): Promise<void> {
  if (callMode() === "live") {
    throw new Error("Reset is disabled in live mode. Real call records are not demo state.");
  }
  const cleared = (await listIncidents()).length;
  await resetAll();
  console.log(`Cleared ${cleared} incident${cleared === 1 ? "" : "s"}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
