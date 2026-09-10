"use client";

import { useState } from "react";
import { Button, Notice, Rail } from "./ui";

export type SelfServiceState = { enabled: boolean; dailyCap: number; remainingToday: number };

/**
 * The number, and the statement that it belongs to whoever typed it.
 *
 * Only rendered in self-service demo mode. The consent tick is not decoration:
 * nothing is prepared, reserved or dialed until it is checked, and the fact
 * that it was checked is written into the incident record with a timestamp.
 */
export function ConsentForm({
  selfService,
  busy,
  disabled,
  onSubmit,
}: {
  selfService: SelfServiceState;
  busy: boolean;
  disabled: boolean;
  onSubmit: (input: { phone: string; name: string; consent: true }) => void;
}) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);

  const looksLikeE164 = /^\+[1-9][0-9]{6,14}$/.test(phone.trim());
  const ready = looksLikeE164 && consent && !busy && !disabled;
  const exhausted = selfService.remainingToday <= 0;

  return (
    <div className="space-y-4 border-t border-line pt-4">
      <div>
        <Rail>Who should this call reach?</Rail>
        <p className="mt-1.5 text-sm leading-relaxed text-fog">
          This demo calls the number you enter, once. Use your own phone.
        </p>
      </div>

      {exhausted ? (
        <Notice tone="amber" title="TODAY'S CALLS ARE USED UP">
          This demo places at most {selfService.dailyCap} calls a day, and today&rsquo;s are spent.
          The no-call demo still runs in full — pick a dry-run scenario instead.
        </Notice>
      ) : null}

      <label className="block text-sm text-fog">
        <span className="rail">Your phone number, in E.164</span>
        <input
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="+14155552671"
          inputMode="tel"
          autoComplete="tel"
          disabled={exhausted}
          aria-label="Your phone number in E.164 format"
          className="numeric mt-1.5 w-full rounded-md border border-line bg-ink px-3 py-2 text-sm text-chalk disabled:opacity-40"
        />
        <span className="mt-1 block text-xs text-fog-dim">
          Country code and digits only — no spaces, brackets or dashes.
        </span>
      </label>

      <label className="block text-sm text-fog">
        <span className="rail">Your name (optional)</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Demo participant"
          maxLength={60}
          disabled={exhausted}
          aria-label="Your name, used on the call"
          className="mt-1.5 w-full rounded-md border border-line bg-ink px-3 py-2 text-sm text-chalk disabled:opacity-40"
        />
        <span className="mt-1 block text-xs text-fog-dim">Used to address you on the call.</span>
      </label>

      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-fog">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          disabled={exhausted}
          className="mt-0.5 h-4 w-4 accent-[#5fd39a]"
        />
        <span>
          <span className="text-chalk">
            This is my own phone number and I agree to receive one automated AI call from this
            demonstration.
          </span>{" "}
          The call says it is an AI before it asks anything, and the animal data it describes is
          synthetic.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => onSubmit({ phone: phone.trim(), name: name.trim(), consent: true })}
          disabled={!ready}
        >
          Prepare call task
        </Button>
        <span className="text-xs text-fog-dim">
          {selfService.remainingToday} of {selfService.dailyCap} calls left today
        </span>
      </div>

      <p className="text-xs leading-relaxed text-fog-dim">
        Preparing builds the task and the preview. It places no call — you still have to approve the
        exact call and then authorize it. Any number is called once only, and your number is erased
        from this server when the call ends.
      </p>
    </div>
  );
}
