/** Destination handling. A number reaches this module or it is not dialed. */
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

/** Exact ASCII E.164: no whitespace, Unicode digits, punctuation, or extensions. */
export function isE164(value: unknown): value is string {
  return typeof value === "string" && /^\+[1-9][0-9]{1,14}(?![\s\S])/.test(value);
}

export type Destination = {
  phone: string;
  region: string;
  locale: string;
  masked: string;
};

/**
 * Resolve the configured caretaker number into a routable destination.
 *
 * The region is read off the number itself and never defaulted to US, because
 * a wrong region is a wrong call, and a caretaker in another country is
 * exactly the person a barn alert would reach.
 */
export function destination(phone: string): Destination {
  if (!isE164(phone)) {
    throw new Error("Enter an exact ASCII E.164 number, including + and country code.");
  }
  // libphonenumber does not model the NANP fiction reservation, so a
  // 555-01XX number parses as a perfectly ordinary line. It is refused here
  // rather than left to the carrier: a demo number that survives this check is
  // a demo number that can end up in a live call.
  if (isReservedFictional(phone)) {
    throw new Error("That number is in the reserved fictional range and cannot be called.");
  }
  const parsed = parsePhoneNumberFromString(phone);
  if (!parsed?.isValid() || !parsed.country || parsed.number !== phone) {
    throw new Error("Enter a valid number with an identifiable destination country.");
  }
  return { phone, region: parsed.country, locale: "en", masked: maskE164(phone) };
}

/**
 * The reserved fictional ranges a demonstration may use.
 *
 * NANP `555-01XX` is set aside for fiction and is deliberately not routable, so
 * `destination()` rejects it — which is the correct answer for a live call and
 * the wrong one for a fixture. `syntheticDestination()` is the narrow door for
 * the dry run, and it opens for nothing else.
 */
const RESERVED_FICTIONAL = /^\+1[2-9][0-9]{2}5550(1[0-9]{2})$/;

export function isReservedFictional(phone: unknown): phone is string {
  return typeof phone === "string" && RESERVED_FICTIONAL.test(phone);
}

export function syntheticDestination(phone: string): Destination {
  if (!isReservedFictional(phone)) {
    throw new Error("A dry run may only use a reserved fictional number (NANP 555-01XX).");
  }
  return { phone, region: "US", locale: "en", masked: maskE164(phone) };
}

/**
 * `+12025550142` becomes `+1 •••••••42`.
 *
 * The country calling code stays legible so an operator can tell at a glance
 * that the call is going where they expect, and the last two digits are enough
 * to distinguish two caretakers on the same rota. Everything else is gone —
 * this string is what goes on screen, into the incident record, and into logs,
 * so it must not be enough to redial from.
 */
export function maskE164(phone: string): string {
  if (!isE164(phone)) return "•••";
  const parsed = parsePhoneNumberFromString(phone);
  const code = parsed?.countryCallingCode ?? "";
  const national = code ? phone.slice(1 + code.length) : phone.slice(1);
  const tail = national.slice(-2);
  const hidden = "•".repeat(Math.max(national.length - tail.length, 1));
  return `+${code} ${hidden}${tail}`.trim();
}

/**
 * Why the configured caretaker number cannot be used, or `null` if it can.
 *
 * The banner on the console and the preview resolver both call this, so a
 * misconfigured number is reported the same way whether the operator has
 * clicked anything yet or not — and neither path can be stricter than the
 * other. The offending value is never included in the message: a typo'd number
 * is still somebody's number.
 */
export function configuredDestinationProblem(value: string | undefined): string | null {
  if (!value) {
    return "No authorized caretaker number is configured. Set HERDRELAY_AUTHORIZED_E164.";
  }
  try {
    destination(value);
    return null;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "It is not a dialable number.";
    return `HERDRELAY_AUTHORIZED_E164 is set but unusable. ${reason} Write it as a country code and digits with no spaces, dashes, brackets or extension, for example +14155552671.`;
  }
}
