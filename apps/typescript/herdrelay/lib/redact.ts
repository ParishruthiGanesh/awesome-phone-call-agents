/**
 * Redaction for anything that leaves the process.
 *
 * Provider errors quote request bodies, and a request body here contains a
 * caretaker's phone number. Every error string that reaches a log line, an API
 * response, or the screen goes through `redact` first.
 */
import { maskE164 } from "./phone";

const E164_LIKE = /\+[1-9][0-9]{6,14}/g;

export function redact(text: string): string {
  return text.replace(E164_LIKE, (match) => maskE164(match));
}

/**
 * Log without ever printing a destination.
 *
 * Kept as the single logging entry point so that "mask phone numbers in logs"
 * is one function to audit rather than a convention to remember.
 */
export function logSafe(message: string, context: Record<string, unknown> = {}): void {
  const safeContext = Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      typeof value === "string" ? redact(value) : value,
    ]),
  );
  const suffix = Object.keys(safeContext).length ? ` ${JSON.stringify(safeContext)}` : "";
  console.log(`[herdrelay] ${redact(message)}${suffix}`);
}
