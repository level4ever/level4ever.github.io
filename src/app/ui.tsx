// Small building blocks shared by the app's screens.

import { useEffect, useRef, type ReactNode } from "react";
import type { Severity, Warning } from "../lib/analysis";

// A modal dialog, open while it's rendered. Escape or the backdrop closes it.
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal?.();
    }
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => event.target === ref.current && onClose()}
    >
      <div className="dialog-body">
        <h2>{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

// A row of toggle chips, one per option.
export function Chips<T>({
  options,
  selected,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (selected: T[]) => void;
  label: string;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((option) => {
        const on = selected.includes(option.value);
        return (
          <button
            key={String(option.value)}
            type="button"
            className="chip"
            aria-pressed={on}
            onClick={() => onChange(on ? selected.filter((v) => v !== option.value) : [...selected, option.value])}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const SEVERITY_ICON: Record<Severity, string> = { error: "⛔", warning: "⚠", info: "ℹ" };

export function worst(warnings: Warning[] | undefined): Severity | undefined {
  if (!warnings?.length) return undefined;
  if (warnings.some((w) => w.severity === "error")) return "error";
  if (warnings.some((w) => w.severity === "warning")) return "warning";
  return "info";
}

export function SeverityIcon({ severity, title }: { severity: Severity; title?: string }) {
  return (
    <span className={`sev-${severity}`} title={title} aria-label={severity}>
      {SEVERITY_ICON[severity]}
    </span>
  );
}

export function WarningList({ warnings }: { warnings: Warning[] }) {
  return (
    <ul className="warnings">
      {warnings.map((w, i) => (
        <li key={i}>
          <SeverityIcon severity={w.severity} />
          <span>{w.text}</span>
        </li>
      ))}
    </ul>
  );
}

// A quest's level, coloured as the game colours it for a character at `level`.
export function QuestLevel({ level, playerLevel }: { level: number; playerLevel?: number }) {
  return (
    <span
      className={`level ${level > 0 ? difficulty(level, playerLevel) : ""}`}
      title={level > 0 ? `Level ${level}` : "Its level matches yours"}
    >
      {level > 0 ? level : "≈"}
    </span>
  );
}

function difficulty(level: number, player: number | undefined): string {
  if (!player || !level) return "";
  const diff = level - player;
  if (diff >= 5) return "diff-red";
  if (diff >= 3) return "diff-orange";
  if (diff >= -2) return "diff-yellow";
  // Grey below the game's green range, which widens with level.
  const greenRange = player <= 5 ? 5 : player <= 39 ? 5 + Math.floor(player / 10) : 9;
  return -diff <= greenRange ? "diff-green" : "diff-grey";
}
