import { cn } from "@rakazo/ui-web";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

/** A lettered answer row for question cards; the chosen one is tinted and the rest dim. */
export function OptionRow({
  letter,
  selected,
  disabled,
  onClick,
  children,
}: {
  letter: string;
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected || undefined}
      onClick={onClick}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-start text-[15px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        selected
          ? "border-success/40 bg-success/10"
          : "border-border hover:bg-accent disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-lg text-[13px] font-medium",
          selected ? "bg-success text-background" : "bg-muted text-muted-foreground",
        )}
      >
        {letter}
      </span>
      <span className="flex-1">{children}</span>
      {selected ? <Check aria-hidden className="size-4 shrink-0 text-success" /> : null}
    </button>
  );
}

export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}
