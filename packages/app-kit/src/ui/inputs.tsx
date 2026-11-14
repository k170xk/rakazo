import { Minus, Plus, Star, X } from "lucide-react";
import { motion } from "motion/react";
import type { KeyboardEvent, ReactNode } from "react";
import { useId, useRef, useState } from "react";
import { cn } from "./cn.js";

const roundTo = (value: number, step: number, min: number) =>
  Math.round((Math.round((value - min) / step) * step + min) * 1e6) / 1e6;

/** Two handles on one track for a range (budget from–to, floor area, dates as numbers). */
export function RangeSlider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  format = String,
  label,
  className,
}: {
  value: [number, number];
  onChange: (value: [number, number]) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (value: number) => string;
  label?: ReactNode;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [low, high] = value;
  const share = (n: number) => ((n - min) / (max - min || 1)) * 100;
  const set = (which: 0 | 1, raw: number) => {
    const n = Math.min(max, Math.max(min, roundTo(raw, step, min)));
    onChange(which === 0 ? [Math.min(n, high), high] : [low, Math.max(n, low)]);
  };
  const fromPointer = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box) return min;
    return min + ((clientX - box.left) / box.width) * (max - min);
  };
  const thumb = (which: 0 | 1) => {
    const n = which === 0 ? low : high;
    return (
      <span
        role="slider"
        tabIndex={0}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={n}
        aria-valuetext={format(n)}
        aria-label={which === 0 ? "From" : "To"}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            set(which, fromPointer(event.clientX));
        }}
        onKeyDown={(event) => {
          const big = (max - min) / 10;
          const moves: Record<string, number> = {
            ArrowLeft: -step,
            ArrowDown: -step,
            ArrowRight: step,
            ArrowUp: step,
            PageDown: -big,
            PageUp: big,
          };
          if (event.key in moves) {
            event.preventDefault();
            set(which, n + (moves[event.key] ?? 0));
          } else if (event.key === "Home") set(which, min);
          else if (event.key === "End") set(which, max);
        }}
        className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-primary bg-card shadow-md outline-none focus-visible:ring-4 focus-visible:ring-primary/25 active:cursor-grabbing"
        style={{ left: `${share(n)}%` }}
      />
    );
  };
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {label !== undefined && (
        <span className="flex items-center justify-between text-sm font-semibold">
          {label}
          <span className="tabular text-muted-foreground">
            {format(low)} – {format(high)}
          </span>
        </span>
      )}
      <div
        ref={track}
        onPointerDown={(event) => {
          const n = fromPointer(event.clientX);
          set(Math.abs(n - low) <= Math.abs(n - high) ? 0 : 1, n);
        }}
        className="relative h-5 cursor-pointer touch-none"
      >
        <span className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-muted" />
        <span
          className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-primary"
          style={{ left: `${share(low)}%`, width: `${share(high) - share(low)}%` }}
        />
        {thumb(0)}
        {thumb(1)}
      </div>
    </div>
  );
}

/** Stars (or any count) to score something: a supplier, a site, a review answer. */
export function Rating({
  value,
  onChange,
  max = 5,
  size = "md",
  label,
}: {
  value: number | null | undefined;
  onChange?: (value: number | null) => void;
  max?: number;
  size?: "sm" | "md" | "lg";
  label?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  const px = { sm: "size-4", md: "size-6", lg: "size-8" }[size];
  return (
    <fieldset
      aria-label={label ?? `${value ?? 0} out of ${max}`}
      className="m-0 inline-flex items-center gap-0.5 border-0 p-0"
      onPointerLeave={() => setHover(null)}
    >
      {Array.from({ length: max }, (_, index) => {
        const n = index + 1;
        const star = (
          <Star
            className={cn(
              px,
              "transition-colors",
              n <= shown ? "fill-warning text-warning" : "text-muted-foreground/40",
            )}
          />
        );
        if (!onChange) return <span key={n}>{star}</span>;
        return (
          <motion.button
            key={n}
            type="button"
            aria-pressed={value === n}
            aria-label={`${n} of ${max}`}
            whileTap={{ scale: 0.85 }}
            onPointerEnter={() => setHover(n)}
            onClick={() => onChange(value === n ? null : n)}
            className="rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {star}
          </motion.button>
        );
      })}
    </fieldset>
  );
}

/** A row of joined buttons for one choice among a few (view: list/board, period, priority). */
export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
}: {
  options: Array<V | { value: V; label?: ReactNode; icon?: ReactNode }>;
  value: V;
  onChange: (value: V) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  const id = useId();
  const list = options.map((option) => (typeof option === "string" ? { value: option } : option));
  return (
    <fieldset className={cn("m-0 inline-flex rounded-xl border-0 bg-muted p-1", className)}>
      {list.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative flex items-center gap-1.5 rounded-lg font-semibold transition-colors [&_svg]:size-4",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-[13px]",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-lg bg-card shadow-sm"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {option.icon}
              {option.label ?? option.value}
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}

/** A number with − and + buttons (quantities, people, storeys); typing works too. */
export function NumberStepper({
  value,
  onChange,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  suffix,
  id,
}: {
  value: number | null | undefined;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  id?: string;
}) {
  const n = value ?? 0;
  const set = (next: number) =>
    onChange(Math.min(max, Math.max(min, Math.round(next * 1e6) / 1e6)));
  return (
    <div className="inline-flex h-10 items-center rounded-xl border border-input bg-card">
      <button
        type="button"
        aria-label="Less"
        disabled={n <= min}
        onClick={() => set(n - step)}
        className="grid h-full w-10 place-items-center rounded-l-xl text-muted-foreground hover:bg-muted disabled:opacity-35"
      >
        <Minus className="size-4" />
      </button>
      <input
        id={id}
        inputMode="decimal"
        value={value ?? ""}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (event.target.value !== "" && Number.isFinite(next)) set(next);
        }}
        className="h-full w-16 bg-transparent text-center text-sm font-semibold tabular outline-none"
      />
      {suffix && <span className="pr-1 text-xs text-muted-foreground">{suffix}</span>}
      <button
        type="button"
        aria-label="More"
        disabled={n >= max}
        onClick={() => set(n + step)}
        className="grid h-full w-10 place-items-center rounded-r-xl text-muted-foreground hover:bg-muted disabled:opacity-35"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

/**
 * Free tags typed in (Enter or comma adds one), with optional suggestions. The value is a list;
 * keep it in a text column joined by commas.
 */
export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = "Add a tag",
  max = 30,
  id,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  max?: number;
  id?: string;
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const add = (raw: string) => {
    const tag = raw.trim().replace(/,$/, "").slice(0, 60);
    if (
      !tag ||
      value.some((item) => item.toLowerCase() === tag.toLowerCase()) ||
      value.length >= max
    )
      return;
    onChange([...value, tag]);
    setText("");
  };
  const matches = text
    ? suggestions
        .filter((item) => item.toLowerCase().includes(text.toLowerCase()) && !value.includes(item))
        .slice(0, 6)
    : [];
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(matches[0] && event.key === "Enter" && !suggestions.includes(text) ? matches[0] : text);
    } else if (event.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="relative">
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border border-input bg-card px-2 py-1.5 focus-within:ring-4 focus-within:ring-primary/15">
        {value.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-lg bg-primary/12 py-0.5 pr-1 pl-2 text-[12.5px] font-semibold text-primary"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => onChange(value.filter((item) => item !== tag))}
              className="inline-flex size-6 items-center justify-center rounded hover:bg-primary/15 pointer-coarse:size-8 max-sm:size-8"
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            add(text);
          }}
          placeholder={value.length ? "" : placeholder}
          className="min-w-24 flex-1 bg-transparent px-1 text-sm outline-none"
        />
      </div>
      {focused && matches.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-border bg-popover p-1 shadow-lg">
          {matches.map((item) => (
            <button
              key={item}
              type="button"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => add(item)}
              className="block w-full rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-muted"
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SWATCHES = [
  "#76BF43",
  "#4D9A2A",
  "#0F766E",
  "#2563EB",
  "#7C3AED",
  "#DB2777",
  "#DC2626",
  "#EA580C",
  "#CA8A04",
  "#6B7280",
  "#1F2937",
  "#FFFFFF",
];

/** Pick a colour from OCSC-friendly swatches or type a #rrggbb (status colours, map layers). */
export function ColorPicker({
  value,
  onChange,
  swatches = SWATCHES,
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  swatches?: string[];
}) {
  const [text, setText] = useState(value ?? "");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {swatches.map((swatch) => (
        <button
          key={swatch}
          type="button"
          aria-label={swatch}
          aria-pressed={value?.toLowerCase() === swatch.toLowerCase()}
          onClick={() => {
            setText(swatch);
            onChange(swatch);
          }}
          className={cn(
            "size-7 rounded-full border border-black/10 transition-transform",
            value?.toLowerCase() === swatch.toLowerCase() &&
              "scale-110 ring-2 ring-primary ring-offset-2 ring-offset-background",
          )}
          style={{ background: swatch }}
        />
      ))}
      <input
        aria-label="Colour code"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          if (/^#[0-9a-fA-F]{6}$/.test(event.target.value)) onChange(event.target.value);
        }}
        placeholder="#76BF43"
        className="h-8 w-24 rounded-lg border border-input bg-card px-2 font-mono text-xs outline-none focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
}
