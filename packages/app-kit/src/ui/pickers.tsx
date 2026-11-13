import { Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn.js";

const TRIGGER =
  "inline-flex h-10 w-full items-center gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm text-foreground shadow-[0_1px_1px_hsl(220_30%_10%/0.03)] transition-[border,box-shadow] outline-none hover:border-primary/40 focus-visible:border-primary/60 focus-visible:ring-4 focus-visible:ring-primary/15 disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0";

type Align = "start" | "center" | "end";

/**
 * A floating panel anchored to its trigger: it flips above when there is no room below, stays on
 * screen, and closes on Escape or a click outside. Children may be a function given `close`.
 */
export function Popover({
  trigger,
  children,
  align = "start",
  open: controlled,
  onOpenChange,
  matchWidth,
  className,
}: {
  trigger: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: Align;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Make the panel at least as wide as the trigger (for pickers). */
  matchWidth?: boolean;
  className?: string;
}) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = (value: boolean) => {
    setOwn(value);
    onOpenChange?.(value);
  };
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{
    left: number;
    top: number;
    up: boolean;
    width: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const measure = () => {
      const a = anchor.current?.getBoundingClientRect();
      const p = panel.current;
      if (!a || !p) return;
      const height = p.offsetHeight;
      const width = Math.max(p.offsetWidth, matchWidth ? a.width : 0);
      const up = a.bottom + 6 + height > window.innerHeight - 8 && a.top - 6 - height > 8;
      const wanted =
        align === "end"
          ? a.right - width
          : align === "center"
            ? a.left + a.width / 2 - width / 2
            : a.left;
      setPlace({
        left: Math.max(8, Math.min(wanted, window.innerWidth - width - 8)),
        top: up ? a.top - 6 - height : a.bottom + 6,
        up,
        width: a.width,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (panel.current) observer?.observe(panel.current);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      observer?.disconnect();
    };
  }, [open, align, matchWidth]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!anchor.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      anchor.current?.querySelector<HTMLElement>("button,[tabindex]")?.focus();
    };
    document.addEventListener("mousedown", outside);
    window.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", onEscape);
    };
  });

  const close = () => setOpen(false);
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the trigger is a button of its own; this only listens */}
      <span
        ref={anchor}
        role="presentation"
        className="inline-flex max-w-full"
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {trigger}
      </span>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={panel}
                initial={{ opacity: 0, y: place?.up ? 4 : -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
                transition={{ duration: 0.14 }}
                style={{
                  left: place?.left ?? 0,
                  top: place?.top ?? 0,
                  minWidth: matchWidth ? place?.width : undefined,
                  visibility: place ? "visible" : "hidden",
                }}
                className={cn(
                  "fixed z-[70] max-w-[calc(100vw-16px)] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lift",
                  className,
                )}
              >
                {typeof children === "function" ? children(close) : children}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

/** A small label on hover or keyboard focus. Pure CSS, so it costs nothing until shown. */
export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
}) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs font-semibold whitespace-nowrap text-background opacity-0 shadow-lift transition-[opacity,transform] duration-150 group-focus-within/tip:opacity-100 group-hover/tip:opacity-100",
          side === "top"
            ? "bottom-full mb-1.5 translate-y-1 group-focus-within/tip:translate-y-0 group-hover/tip:translate-y-0"
            : "top-full mt-1.5 -translate-y-1 group-focus-within/tip:translate-y-0 group-hover/tip:translate-y-0",
        )}
      >
        {content}
      </span>
    </span>
  );
}

/* ----- Dates ----- */

const pad = (value: number) => String(value).padStart(2, "0");
/** A local date as YYYY-MM-DD. */
export const isoDate = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseDate = (value?: string | null) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
};
const shown = (value?: string | null) =>
  parseDate(value)?.toLocaleDateString("en-IE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }) ?? "";
const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function MonthGrid({
  month,
  from,
  to,
  hover,
  min,
  max,
  onPick,
  onHover,
}: {
  month: Date;
  from?: string;
  to?: string;
  hover?: string;
  min?: string;
  max?: string;
  onPick: (day: string) => void;
  onHover?: (day: string | undefined) => void;
}) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const today = isoDate(new Date());
  const end = to ?? (from && hover && hover > from ? hover : undefined);
  return (
    <div className="w-[252px]">
      <p className="mb-2 text-center text-sm font-bold">
        {first.toLocaleDateString("en-IE", { month: "long", year: "numeric" })}
      </p>
      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {WEEKDAYS.map((day) => (
          <span key={day} className="pb-1 text-[11px] font-semibold text-muted-foreground">
            {day}
          </span>
        ))}
        {Array.from({ length: 42 }, (_, index) => {
          const date = addDays(start, index);
          const day = isoDate(date);
          const outside = date.getMonth() !== month.getMonth();
          const disabled = Boolean((min && day < min) || (max && day > max));
          const edge = day === from || day === end;
          const between = Boolean(from && end && day > from && day < end);
          return (
            <button
              key={day}
              type="button"
              disabled={disabled}
              onClick={() => onPick(day)}
              onPointerEnter={() => onHover?.(day)}
              aria-pressed={edge}
              aria-label={date.toLocaleDateString("en-IE", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              className={cn(
                "relative h-9 text-[13px] font-medium tabular transition-colors disabled:opacity-30",
                outside && !edge && "text-muted-foreground/50",
                between && "bg-primary/12",
                edge
                  ? "rounded-lg bg-primary font-bold text-primary-foreground shadow-sm"
                  : "rounded-lg hover:bg-muted",
                between && "rounded-none",
                day === today && !edge && "font-bold text-primary",
              )}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MonthNav({ onMove, children }: { onMove: (by: number) => void; children: ReactNode }) {
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Previous month"
        onClick={() => onMove(-1)}
        className="absolute top-0 left-0 z-10 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-4"
      >
        <ChevronLeft />
      </button>
      <button
        type="button"
        aria-label="Next month"
        onClick={() => onMove(1)}
        className="absolute top-0 right-0 z-10 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-4"
      >
        <ChevronRight />
      </button>
      {children}
    </div>
  );
}

/** A date field with a calendar; the value is a YYYY-MM-DD string ("" when empty). */
export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  min,
  max,
  clearable = true,
  disabled,
  id,
  className,
}: {
  value?: string | null;
  onChange: (value: string) => void;
  /** From Field: <Field label="Due">{(id) => <DatePicker id={id} … />}</Field>. */
  id?: string;
  placeholder?: string;
  min?: string;
  max?: string;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [month, setMonth] = useState(() => parseDate(value) ?? new Date());
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setMonth(parseDate(value) ?? new Date());
        setOpen(next);
      }}
      className="p-3"
      trigger={
        <button type="button" id={id} disabled={disabled} className={cn(TRIGGER, className)}>
          <Calendar className="text-muted-foreground" />
          <span className={cn("flex-1 truncate", !value && "text-muted-foreground/70")}>
            {shown(value) || placeholder}
          </span>
          {clearable && value ? (
            <X
              role="button"
              aria-label="Clear date"
              className="text-muted-foreground hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                onChange("");
              }}
            />
          ) : (
            <ChevronDown className="text-muted-foreground" />
          )}
        </button>
      }
    >
      <MonthNav
        onMove={(by) =>
          setMonth((current) => new Date(current.getFullYear(), current.getMonth() + by, 1))
        }
      >
        <MonthGrid
          month={month}
          from={value ?? undefined}
          min={min}
          max={max}
          onPick={(day) => {
            onChange(day);
            setOpen(false);
          }}
        />
      </MonthNav>
      <div className="mt-2 flex justify-between border-t border-border/70 pt-2">
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10"
          onClick={() => {
            onChange(isoDate(new Date()));
            setOpen(false);
          }}
        >
          Today
        </button>
      </div>
    </Popover>
  );
}

export type DateRange = { from: string; to: string };

const startOfMonth = (date: Date, by = 0) => new Date(date.getFullYear(), date.getMonth() + by, 1);
const RANGE_PRESETS: Array<{ label: string; range: () => DateRange }> = [
  { label: "Today", range: () => ({ from: isoDate(new Date()), to: isoDate(new Date()) }) },
  {
    label: "Last 7 days",
    range: () => ({ from: isoDate(addDays(new Date(), -6)), to: isoDate(new Date()) }),
  },
  {
    label: "Last 30 days",
    range: () => ({ from: isoDate(addDays(new Date(), -29)), to: isoDate(new Date()) }),
  },
  {
    label: "This month",
    range: () => ({
      from: isoDate(startOfMonth(new Date())),
      to: isoDate(addDays(startOfMonth(new Date(), 1), -1)),
    }),
  },
  {
    label: "Last month",
    range: () => ({
      from: isoDate(startOfMonth(new Date(), -1)),
      to: isoDate(addDays(startOfMonth(new Date()), -1)),
    }),
  },
  {
    label: "This quarter",
    range: () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      return { from: isoDate(start), to: isoDate(addDays(startOfMonth(start, 3), -1)) };
    },
  },
  {
    label: "This year",
    range: () => ({
      from: `${new Date().getFullYear()}-01-01`,
      to: `${new Date().getFullYear()}-12-31`,
    }),
  },
];

/** A from–to field with two months and quick ranges (last 7 days, this month, this quarter…). */
export function DateRangePicker({
  value,
  onChange,
  placeholder = "Any dates",
  presets = true,
  id,
  className,
}: {
  id?: string;
  value?: DateRange | null;
  onChange: (value: DateRange | null) => void;
  placeholder?: string;
  presets?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(parseDate(value?.from) ?? new Date(), -1));
  const [draft, setDraft] = useState<string | undefined>();
  const [hover, setHover] = useState<string | undefined>();
  const pick = (day: string) => {
    if (!draft || day < draft) {
      setDraft(day);
      return;
    }
    onChange({ from: draft, to: day });
    setDraft(undefined);
    setOpen(false);
  };
  const from = draft ?? value?.from;
  const to = draft ? undefined : value?.to;
  const label = value
    ? value.from === value.to
      ? shown(value.from)
      : `${shown(value.from)} – ${shown(value.to)}`
    : "";
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setDraft(undefined);
        if (next) setMonth(startOfMonth(parseDate(value?.from) ?? new Date(), value ? 0 : -1));
        setOpen(next);
      }}
      className="p-3"
      trigger={
        <button type="button" id={id} className={cn(TRIGGER, className)}>
          <Calendar className="text-muted-foreground" />
          <span className={cn("flex-1 truncate", !label && "text-muted-foreground/70")}>
            {label || placeholder}
          </span>
          {value ? (
            <X
              role="button"
              aria-label="Clear dates"
              className="text-muted-foreground hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                onChange(null);
              }}
            />
          ) : (
            <ChevronDown className="text-muted-foreground" />
          )}
        </button>
      }
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        {presets && (
          <div className="flex flex-row flex-wrap gap-1 sm:w-32 sm:flex-col sm:border-r sm:border-border/70 sm:pr-3">
            {RANGE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  onChange(preset.range());
                  setOpen(false);
                }}
                className="rounded-md px-2 py-1.5 text-left text-[13px] font-medium hover:bg-muted"
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}
        <MonthNav onMove={(by) => setMonth((current) => startOfMonth(current, by))}>
          <div className="flex gap-4" onPointerLeave={() => setHover(undefined)}>
            <MonthGrid
              month={month}
              from={from}
              to={to}
              hover={draft ? hover : undefined}
              onPick={pick}
              onHover={setHover}
            />
            <div className="hidden sm:block">
              <MonthGrid
                month={startOfMonth(month, 1)}
                from={from}
                to={to}
                hover={draft ? hover : undefined}
                onPick={pick}
                onHover={setHover}
              />
            </div>
          </div>
        </MonthNav>
      </div>
      {draft && (
        <p className="mt-2 text-center text-xs text-muted-foreground">Now pick the end date</p>
      )}
    </Popover>
  );
}

/* ----- Combobox ----- */

export type ComboOption =
  | string
  | { value: string; label?: string; hint?: string; icon?: ReactNode };

const optionOf = (option: ComboOption) =>
  typeof option === "string"
    ? { value: option, label: option }
    : { ...option, label: option.label ?? option.value };

/** Every typed word appears somewhere in the text, in any order, ignoring case and accents. */
export function matchesWords(text: string, query: string): boolean {
  const fold = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  const haystack = fold(text);
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

type ComboProps = {
  options: ComboOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  /** Offer "Add “…”" for text that matches nothing. */
  onCreate?: (text: string) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
};

/** A searchable picker for long lists (people, projects, clients); `multiple` keeps chips. */
export function Combobox(
  props: ComboProps &
    (
      | { multiple?: false; value: string; onChange: (value: string) => void }
      | { multiple: true; value: string[]; onChange: (value: string[]) => void }
    ),
) {
  const {
    options,
    placeholder = "Choose…",
    searchPlaceholder = "Search…",
    onCreate,
    disabled,
    className,
  } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const list = useMemo(() => options.map(optionOf), [options]);
  const found = useMemo(
    () =>
      list
        .filter((option) => matchesWords(`${option.label} ${option.hint ?? ""}`, query))
        .slice(0, 200),
    [list, query],
  );
  const selected = props.multiple ? props.value : props.value ? [props.value] : [];
  const choose = (value: string) => {
    if (props.multiple) {
      props.onChange(
        selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value],
      );
    } else {
      props.onChange(value);
      setOpen(false);
    }
  };
  const creatable = Boolean(
    onCreate &&
      query.trim() &&
      !list.some((option) => option.label.toLowerCase() === query.trim().toLowerCase()),
  );
  const labelOf = (value: string) => list.find((option) => option.value === value)?.label ?? value;
  return (
    <Popover
      open={open}
      matchWidth
      onOpenChange={(next) => {
        setOpen(next);
        setQuery("");
        setCursor(0);
      }}
      className="w-72 p-0"
      trigger={
        <button
          type="button"
          disabled={disabled}
          className={cn(TRIGGER, "h-auto min-h-10 py-1.5", className)}
        >
          <span className="flex min-w-0 flex-1 flex-wrap gap-1">
            {!selected.length && <span className="text-muted-foreground/70">{placeholder}</span>}
            {props.multiple
              ? selected.map((value) => (
                  <span
                    key={value}
                    className="inline-flex items-center gap-1 rounded-md bg-primary/12 px-1.5 py-0.5 text-xs font-semibold"
                  >
                    {labelOf(value)}
                    <X
                      role="button"
                      aria-label={`Remove ${labelOf(value)}`}
                      className="size-3!"
                      onClick={(event) => {
                        event.stopPropagation();
                        choose(value);
                      }}
                    />
                  </span>
                ))
              : selected[0] && <span className="truncate">{labelOf(selected[0])}</span>}
          </span>
          <ChevronDown className="text-muted-foreground" />
        </button>
      }
    >
      <div className="flex items-center gap-2 border-b border-border/70 px-3 [&_svg]:size-4">
        <Search className="text-muted-foreground" />
        <input
          // biome-ignore lint/a11y/noAutofocus: the search box is the reason the picker opened
          autoFocus
          value={query}
          placeholder={searchPlaceholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown")
              setCursor((value) => Math.min(value + 1, found.length - 1));
            else if (event.key === "ArrowUp") setCursor((value) => Math.max(value - 1, 0));
            else if (event.key === "Enter") {
              event.preventDefault();
              const option = found[cursor];
              if (option) choose(option.value);
              else if (creatable) {
                onCreate?.(query.trim());
                setQuery("");
              }
            } else return;
            event.preventDefault();
          }}
          className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
        />
      </div>
      <div
        role="listbox"
        aria-multiselectable={props.multiple || undefined}
        className="max-h-64 overflow-y-auto p-1"
      >
        {found.map((option, index) => {
          const on = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={on}
              onClick={() => choose(option.value)}
              onPointerEnter={() => setCursor(index)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm [&_svg]:size-4",
                index === cursor && "bg-muted",
              )}
            >
              {option.icon}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{option.label}</span>
                {option.hint && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {option.hint}
                  </span>
                )}
              </span>
              <Check className={cn("text-primary", !on && "invisible")} />
            </button>
          );
        })}
        {creatable && (
          <button
            type="button"
            onClick={() => {
              onCreate?.(query.trim());
              setQuery("");
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-semibold text-primary hover:bg-primary/10"
          >
            Add “{query.trim()}”
          </button>
        )}
        {!found.length && !creatable && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches</p>
        )}
      </div>
    </Popover>
  );
}

/** A slider with its current value shown; `format` turns the number into text (e.g. "40%"). */
export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  format = String,
  label,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (value: number) => string;
  label?: ReactNode;
  className?: string;
}) {
  const share = ((value - min) / (max - min || 1)) * 100;
  return (
    <label className={cn("flex flex-col gap-2", className)}>
      {label !== undefined && (
        <span className="flex items-center justify-between text-sm font-semibold">
          {label}
          <span className="tabular text-muted-foreground">{format(value)}</span>
        </span>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{
          background: `linear-gradient(90deg, hsl(var(--primary)) ${share}%, hsl(var(--muted)) ${share}%)`,
        }}
        className="h-2 w-full cursor-pointer appearance-none rounded-full accent-primary outline-none focus-visible:ring-4 focus-visible:ring-primary/20 [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-card [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-card [&::-webkit-slider-thumb]:shadow-md"
      />
    </label>
  );
}
