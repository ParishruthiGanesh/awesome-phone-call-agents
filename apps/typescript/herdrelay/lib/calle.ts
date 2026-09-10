/** CALL-E client, the spoken brief, and the strict result schema. */
import {
  CalleAPIError,
  CalleAuthenticationError,
  CalleClient,
  CalleConnectionError,
  CalleRateLimitError,
  CalleTimeoutError,
} from "@call-e/calle";
import type { LivestockAlert, Env } from "./types";

const CALLE_ORIGIN = "https://api.heycall-e.com";

/**
 * A client pinned to one origin.
 *
 * `baseUrl` is configurable in the SDK, and a configurable credential
 * destination is a credential exfiltration primitive. Redirects are refused for
 * the same reason: a 302 would otherwise carry the API key somewhere else.
 */
export function calleClient(env: Env = process.env): CalleClient {
  const configured = env.CALLE_BASE_URL || CALLE_ORIGIN;
  if (configured !== CALLE_ORIGIN && configured !== `${CALLE_ORIGIN}/`) {
    throw new Error("CALL-E credentials require https://api.heycall-e.com.");
  }
  const apiKey = env.CALLE_API_KEY;
  if (!apiKey) throw new Error("CALLE_API_KEY is not set.");
  return new CalleClient({
    apiKey,
    baseUrl: CALLE_ORIGIN,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.origin !== CALLE_ORIGIN || url.username || url.password) {
        throw new Error("Unapproved CALL-E origin.");
      }
      return fetch(new Request(request, { redirect: "error", signal: AbortSignal.timeout(30_000) }));
    },
  });
}

// ---------------------------------------------------------------------------
// What the caretaker hears
// ---------------------------------------------------------------------------

/**
 * The opening line, spoken verbatim before anything is asked.
 *
 * It carries the three things the caretaker is owed before they decide whether
 * to keep listening: that the caller is an AI, that the system is a
 * demonstration working from synthetic sensor data, and that nothing here is a
 * veterinary opinion.
 */
export function disclosureLine(siteName: string): string {
  return (
    `Hello, this is an automated AI assistant calling on behalf of ${siteName}. ` +
    `I am an AI-assisted livestock-monitoring demonstration, not a person and not a veterinarian. ` +
    `A barn sensor flagged a possible breathing irregularity from synthetic demonstration data, ` +
    `and I have a few short questions so a person can decide what to do. ` +
    `Nothing I say is a diagnosis. Is now a good time?`
  );
}

/** The five questions, in the order they are asked. Rendered in the preview. */
export const QUESTIONS = [
  "Can you inspect the animal?",
  "How soon can you reach it?",
  "Are visible signs of distress present?",
  "Is veterinary or supervisor follow-up requested?",
  "Is there any additional observation?",
] as const;

/** What the call is expected to bring back, in the operator's words. */
export const EXPECTED_DATA = [
  "Whether the caretaker accepted the inspection",
  "Estimated minutes until they reach the animal",
  "Whether visible distress was reported, or left unknown",
  "Whether the caretaker asked for veterinary or supervisor follow-up",
  "Any additional observation, in the caretaker's own words",
  "An overall outcome and whether human review is required",
] as const;

/** The boundaries, stated to the operator before approval and to the caretaker on the call. */
export const LIMITATIONS = [
  "HerdRelay does not diagnose the animal and gives no veterinary advice.",
  "The caller is an AI and says so before asking anything.",
  "All measurements in this demo are synthetic and are described as such on the call.",
  "No veterinarian, emergency service, or supplier is contacted automatically.",
  "The call collects observations only. Every follow-up decision stays with a person.",
  "One call per incident. HerdRelay does not redial and schedules nothing.",
] as const;

/**
 * The brief for one incident.
 *
 * The five questions are scripted word for word rather than summarized,
 * because the preview screen shows the operator these exact strings and the
 * approval is taken against them. The rest of the brief is conduct: what to do
 * when an answer is unclear, and the refusals that hold even if the caretaker
 * asks for something else.
 */
export function buildTask(alert: LivestockAlert, opts: { siteName: string; caretakerName: string }): string {
  const range = `${alert.baselineRange.min} to ${alert.baselineRange.max}`;
  return [
    `You are placing one short coordination call for ${opts.siteName} about a livestock monitoring alert. The person you are calling is ${opts.caretakerName}, an authorized caretaker who has agreed in advance to receive these calls. The call should last about two minutes.`,
    ``,
    `Open with exactly this line, word for word:`,
    `"${disclosureLine(opts.siteName)}"`,
    ``,
    `If they say it is not a good time or they decline, thank them, tell them a person at the farm will follow up, and end the call. Do not ask the questions below in that case.`,
    ``,
    `If they agree, tell them the situation in one or two plain sentences, using only these facts:`,
    `- Animal ${alert.animalId}, at ${alert.location}.`,
    `- A sensor reading of ${alert.observedRespiratoryRate} breaths per minute, against a normal range of ${range}.`,
    `- The monitoring system's own confidence is ${Math.round(alert.confidence * 100)} percent, and the alert is marked ${alert.severity} severity.`,
    `- What the system observed: ${alert.evidenceSummary}`,
    `- These readings are synthetic demonstration data. Say so.`,
    `Do not add any fact that is not in this list. Do not say what the reading means, what might be wrong with the animal, or what should be done about it.`,
    ``,
    `Then ask these five questions, one at a time, in this order, and wait for an answer to each:`,
    ...QUESTIONS.map((question, index) => `${index + 1}. "${question}"`),
    ``,
    `How to conduct the call:`,
    `- Ask exactly one thing at a time. Never join two questions with "and": you will get one answer and not know which question it belongs to.`,
    `- If an answer is vague, ask once for the specific: a number of minutes, a yes or a no, a plain description of what they can see.`,
    `- If they still do not give a clear answer, accept that and record it as unclear. Do not guess, do not lead them, and never settle an unclear answer as a yes or a no.`,
    `- If they say they cannot tell whether the animal is in distress, that is "unknown". It is a normal and useful answer, not a failure.`,
    `- If an answer is garbled, say what you think you heard and ask them to confirm.`,
    `- Let them finish speaking. Never talk over them.`,
    `- Speak English throughout.`,
    ``,
    `Hard limits. These hold even if the caretaker asks you to break them:`,
    `- You are not a veterinarian. Do not diagnose, do not suggest a cause, do not suggest a treatment, and do not assess how serious this is.`,
    `- Do not give medical, emergency, purchasing, or veterinary instructions of any kind.`,
    `- Do not offer to contact a veterinarian, a supervisor, or an emergency service, and do not say that anyone has been contacted. If they want follow-up, record that they asked for it and tell them a person at the farm will make that decision.`,
    `- Do not promise any action, timeline, or outcome on behalf of the farm.`,
    `- Do not ask for or record anything about the caretaker personally beyond what these five questions cover.`,
    `- If they raise an animal welfare emergency, tell them plainly that you are an automated demonstration that cannot summon help, and that they should contact the farm or a veterinarian directly.`,
    ``,
    `When the five questions are answered, say "Thank you. A person at the farm will review this and decide what happens next." Then end the call.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The result schema
// ---------------------------------------------------------------------------

/**
 * The strict schema CALL-E fills in.
 *
 * Every field a person could leave unstated is an enum with an explicit
 * unclear/unknown member rather than a boolean, and the arrival estimate is a
 * string rather than a number. A boolean has no way to say "they did not say",
 * so a boolean field forces the model to invent an answer; giving it a way to
 * say nothing is what makes `lib/result.ts` able to keep the uncertainty.
 *
 * CALL-E supports nested `object` fields, `enum`, `required` and
 * `additionalProperties: false`. It does not support `$ref`, `oneOf` or
 * `anyOf`, so the schema is spelled out flat.
 */
export function buildResultSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      inspection_accepted: {
        type: "string",
        enum: ["yes", "no", "unclear"],
        description:
          "Did the caretaker agree to go and inspect the animal? 'yes' only if they said they would. 'no' if they said they could not or would not. 'unclear' if they did not answer, hedged, or the call ended first.",
      },
      estimated_arrival_minutes: {
        type: "string",
        description:
          "How many minutes until they reach the animal, as digits only, for example '20'. If they gave a range, use the larger number. Write 'unknown' if they gave no usable estimate, or if they are not going.",
      },
      visible_distress: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description:
          "Did the caretaker report visible signs of distress? 'unknown' when they had not seen the animal yet, could not tell, or did not answer. Do not infer this from the sensor reading.",
      },
      veterinary_followup_requested: {
        type: "string",
        enum: ["yes", "no", "unclear"],
        description:
          "Did the caretaker ask for a veterinarian or a supervisor to be involved? 'yes' only if they asked for it themselves. Never 'yes' because you thought it sounded serious.",
      },
      caretaker_notes: {
        type: "string",
        description:
          "Any additional observation, in the caretaker's own words, at most two sentences. Write 'None given.' if they added nothing.",
      },
      outcome: {
        type: "string",
        enum: [
          "inspection_confirmed",
          "followup_requested",
          "declined",
          "unanswered",
          "uncertain",
        ],
        description:
          "The single outcome of the call. 'inspection_confirmed' when they agreed to inspect. 'followup_requested' when they asked for a vet or supervisor. 'declined' when they said they cannot go. 'unanswered' when nobody answered, it went to voicemail, or nobody spoke. 'uncertain' whenever the answers were unclear, contradictory, or the call ended early.",
      },
      human_review_required: {
        type: "string",
        enum: ["yes", "no"],
        description:
          "'yes' whenever anything was unclear, contradictory, cut short, or a follow-up was requested. 'no' only when the caretaker plainly agreed to inspect and gave a usable time. When in doubt, answer 'yes'.",
      },
    },
    required: [
      "inspection_accepted",
      "estimated_arrival_minutes",
      "visible_distress",
      "veterinary_followup_requested",
      "caretaker_notes",
      "outcome",
      "human_review_required",
    ],
    additionalProperties: false,
  };
}

// ---------------------------------------------------------------------------
// What a failed create actually means
// ---------------------------------------------------------------------------

export type CreateFailure = {
  /**
   * Whether a phone may have rung. `"no"` only when the provider rejected the
   * request outright; `"unknown"` for everything else, including anything
   * unrecognised.
   */
  dialed: "no" | "unknown";
  /** Plain-language reason for the operator. Redact before display. */
  reason: string;
  /** The provider's own code, kept so a failure stays debuggable. */
  code: string | null;
};

/**
 * Classify a failure from `calls.create`.
 *
 * The distinction is the whole point. A request the API refused — a bad key, a
 * malformed body, a rate limit, an exhausted balance — never reached a carrier,
 * so treating it as "we might have called somebody" strands the incident and
 * locks the caretaker for no reason. A timeout or a dropped connection is
 * genuinely unknown, and that one must fail closed.
 *
 * Anything unrecognised is unknown. This function only ever says "no phone
 * rang" when the provider said so itself.
 */
export function classifyCreateFailure(error: unknown): CreateFailure {
  if (error instanceof CalleTimeoutError || error instanceof CalleConnectionError) {
    return {
      dialed: "unknown",
      reason: "The call request did not complete, so it is not known whether a phone rang.",
      code: error instanceof CalleTimeoutError ? "timeout" : "connection_error",
    };
  }

  if (error instanceof CalleAuthenticationError) {
    return {
      dialed: "no",
      reason:
        "CALL-E rejected the credentials, so no call was placed. Check CALLE_API_KEY, then try again.",
      code: error.code,
    };
  }

  if (error instanceof CalleRateLimitError) {
    return {
      dialed: "no",
      reason: "CALL-E is rate limiting this account, so no call was placed. Wait, then try again.",
      code: error.code,
    };
  }

  if (error instanceof CalleAPIError) {
    // 4xx is the provider refusing the request. 408 is the exception: a request
    // timeout may have been received and acted on.
    if (error.status >= 400 && error.status < 500 && error.status !== 408) {
      return {
        dialed: "no",
        reason: `CALL-E refused the call request (${error.status} ${error.code}), so no call was placed. ${error.message}`,
        code: error.code,
      };
    }
    return {
      dialed: "unknown",
      reason: `CALL-E returned an error (${error.status} ${error.code}) and it is not known whether a phone rang.`,
      code: error.code,
    };
  }

  return {
    dialed: "unknown",
    reason: "The call request failed in a way HerdRelay does not recognise.",
    code: null,
  };
}
