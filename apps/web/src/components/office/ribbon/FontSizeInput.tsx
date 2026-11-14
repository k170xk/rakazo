import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rakazo/ui-web";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { keepSelection, RibbonTip, ribbonControl } from "./Ribbon";

export const FONT_SIZES: readonly number[] = [
  8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 54, 60, 72, 96,
];

export const MIN_FONT_SIZE = 1;
export const MAX_FONT_SIZE = 400;

/** A typed font size in points, rounded to the half point a document stores; null when invalid. */
export function parseFontSize(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  if (!Number.isFinite(value) || value < MIN_FONT_SIZE || value > MAX_FONT_SIZE) return null;
  return Math.round(value * 2) / 2;
}

/** The next size up or down the list, as Grow Font and Shrink Font step through it. */
export function stepFontSize(current: number, direction: 1 | -1): number {
  if (direction > 0) {
    const next = FONT_SIZES.find((size) => size > current);
    return next ?? Math.min(MAX_FONT_SIZE, Math.ceil(current / 10) * 10 + 10);
  }
  const previous = [...FONT_SIZES].reverse().find((size) => size < current);
  return previous ?? Math.max(MIN_FONT_SIZE, current - 1);
}

/** A font size box: type a size and press Enter, or pick one from the list. */
export function FontSizeInput({
  label,
  value,
  disabled,
  testId,
  onCommit,
}: {
  label: string;
  /** The selection's size in points; undefined when it is mixed or unknown. */
  value: number | undefined;
  disabled?: boolean;
  testId?: string;
  onCommit: (size: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [value]);

  function commit(text: string) {
    setDraft(null);
    const size = parseFontSize(text);
    if (size !== null && size !== value) onCommit(size);
  }

  return (
    <div className="flex shrink-0 items-center rounded-full ring-1 ring-foreground/[0.08] focus-within:ring-2 focus-within:ring-ring">
      <RibbonTip label={label}>
        <input
          aria-label={label}
          data-testid={testId}
          inputMode="decimal"
          disabled={disabled}
          value={draft ?? (value === undefined ? "" : String(value))}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => {
            if (draft !== null) commit(draft);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit(event.currentTarget.value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraft(null);
            }
          }}
          className="h-8 w-10 rounded-s-full bg-transparent ps-2.5 text-[13px] tabular-nums outline-none disabled:opacity-40"
        />
      </RibbonTip>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          aria-label={label}
          onMouseDown={keepSelection}
          className={`${ribbonControl} min-w-5 rounded-s-none px-1`}
        >
          <ChevronDown className="size-3 opacity-60" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72 w-20">
          {FONT_SIZES.map((size) => (
            <DropdownMenuItem
              key={size}
              onClick={() => onCommit(size)}
              className={size === value ? "font-semibold text-primary" : ""}
            >
              {size}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
