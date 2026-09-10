/** Console primitives. Shared so the alert bands mean one thing everywhere. */
import type { ReactNode } from "react";

export type Tone = "green" | "amber" | "red" | "neutral";

const TONE_CLASSES: Record<Tone, string> = {
  green: "border-green-dim bg-green-dim/40 text-green",
  amber: "border-amber-dim bg-amber-dim/40 text-amber",
  red: "border-red-dim bg-red-dim/40 text-red",
  neutral: "border-line bg-panel-soft text-fog",
};

export function Pill({ tone = "neutral", children, className = "" }: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "neutral", live = false }: { tone?: Tone; live?: boolean }) {
  const colors: Record<Tone, string> = {
    green: "bg-green",
    amber: "bg-amber",
    red: "bg-red",
    neutral: "bg-fog-dim",
  };
  return <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${colors[tone]} ${live ? "dot-live" : ""}`} />;
}

export function Rail({ children }: { children: ReactNode }) {
  return <div className="rail">{children}</div>;
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>;
}

export function Field({ label, children, className = "" }: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Rail>{label}</Rail>
      <div className="mt-1 text-sm text-chalk">{children}</div>
    </div>
  );
}

export function Stat({ label, value, unit, tone = "neutral", note }: {
  label: string;
  value: string;
  unit?: string;
  tone?: Tone;
  note?: string;
}) {
  const valueTone: Record<Tone, string> = {
    green: "text-green",
    amber: "text-amber",
    red: "text-red",
    neutral: "text-chalk",
  };
  return (
    <div className="panel p-4">
      <Rail>{label}</Rail>
      <p className={`mt-2 numeric text-2xl leading-none ${valueTone[tone]}`}>
        {value}
        {unit ? <span className="ml-1 text-sm text-fog-dim">{unit}</span> : null}
      </p>
      {note ? <p className="mt-2 text-xs leading-relaxed text-fog">{note}</p> : null}
    </div>
  );
}

/** Every button in the console. `intent` carries the weight of the action. */
export function Button({
  children,
  onClick,
  disabled = false,
  intent = "default",
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  intent?: "default" | "primary" | "danger" | "quiet";
  type?: "button" | "submit";
  className?: string;
}) {
  const intents: Record<string, string> = {
    default: "border-line bg-panel-soft text-chalk hover:border-fog-dim",
    primary: "border-green-dim bg-green-dim text-green hover:border-green",
    danger: "border-red bg-red-dim text-red hover:bg-red hover:text-ink",
    quiet: "border-transparent bg-transparent text-fog hover:text-chalk",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${intents[intent]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Notice({ tone = "amber", title, children }: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}) {
  const borders: Record<Tone, string> = {
    green: "border-green-dim",
    amber: "border-amber-dim",
    red: "border-red",
    neutral: "border-line",
  };
  const titles: Record<Tone, string> = {
    green: "text-green",
    amber: "text-amber",
    red: "text-red",
    neutral: "text-fog",
  };
  return (
    <div className={`rounded-md border ${borders[tone]} bg-panel-soft p-3.5`} role={tone === "red" ? "alert" : undefined}>
      {title ? <p className={`text-xs font-semibold tracking-wide ${titles[tone]}`}>{title}</p> : null}
      <div className="mt-1 text-sm leading-relaxed text-fog">{children}</div>
    </div>
  );
}
