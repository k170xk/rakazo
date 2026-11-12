import { Check, ChevronLeft, ChevronRight, Minus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Button, Tabs, Textarea } from "./basic.js";
import { cn, ease } from "./cn.js";
import type { Period } from "./data.js";
import { PERIODS } from "./data.js";

const SHORT_PERIODS: Record<Period, string> = {
  "7d": "7d",
  "30d": "30d",
  "90d": "90d",
  ytd: "YTD",
  "12m": "12m",
  all: "All",
};

export type Step = {
  id: string;
  label: string;
  description?: ReactNode;
  render: () => ReactNode;
  /** False keeps Next switched off until the step is filled in. */
  valid?: boolean;
};

/**
 * A form in steps (new job, inspection, onboarding): numbered progress along the top, Back and
 * Next, and the last step's button runs `onFinish`. Steps slide as they change.
 */
export function Steps({
  steps,
  onFinish,
  finishLabel = "Submit",
  onCancel,
  className,
}: {
  steps: Step[];
  onFinish: () => void | Promise<void>;
  finishLabel?: string;
  onCancel?: () => void;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [busy, setBusy] = useState(false);
  const step = steps[Math.min(index, steps.length - 1)];
  if (!step) return null;
  const last = index >= steps.length - 1;
  const move = (by: number) => {
    setDirection(by);
    setIndex((current) => Math.max(0, Math.min(steps.length - 1, current + by)));
  };
  const finish = async () => {
    setBusy(true);
    try {
      await onFinish();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <ol className="flex items-center gap-2">
        {steps.map((item, at) => {
          const done = at < index;
          const current = at === index;
          return (
            <li
              key={item.id}
              className={cn("flex min-w-0 items-center gap-2", at < steps.length - 1 && "flex-1")}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors",
                  done && "bg-primary text-primary-foreground",
                  current && "bg-primary/15 text-primary ring-2 ring-primary",
                  !done && !current && "bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="size-4" /> : at + 1}
              </span>
              <span
                className={cn(
                  "hidden truncate text-sm font-semibold sm:block",
                  current ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {item.label}
              </span>
              {at < steps.length - 1 && (
                <span className="relative h-0.5 min-w-4 flex-1 overflow-hidden rounded-full bg-muted">
                  <motion.span
                    className="absolute inset-y-0 left-0 bg-primary"
                    initial={false}
                    animate={{ width: done ? "100%" : "0%" }}
                    transition={{ duration: 0.4, ease }}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="relative overflow-hidden">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={step.id}
            custom={direction}
            initial={{ opacity: 0, x: direction * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -24 }}
            transition={{ duration: 0.22, ease }}
            className="flex flex-col gap-4"
          >
            <div>
              <h3 className="text-lg font-bold tracking-tight">{step.label}</h3>
              {step.description && (
                <p className="text-sm text-muted-foreground">{step.description}</p>
              )}
            </div>
            {step.render()}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-4">
        <div>
          {index > 0 ? (
            <Button variant="ghost" icon={<ChevronLeft />} onClick={() => move(-1)}>
              Back
            </Button>
          ) : (
            onCancel && (
              <Button variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )
          )}
        </div>
        <span className="text-xs text-muted-foreground tabular">
          Step {index + 1} of {steps.length}
        </span>
        {last ? (
          <Button loading={busy} disabled={step.valid === false} onClick={() => void finish()}>
            {finishLabel}
          </Button>
        ) : (
          <Button disabled={step.valid === false} onClick={() => move(1)}>
            Next <ChevronRight />
          </Button>
        )}
      </div>
    </div>
  );
}

export type CheckResult = "pass" | "fail" | "na";
export type ChecklistItem = { id: string; label: string; hint?: ReactNode; section?: string };
export type ChecklistValue = Record<string, { result?: CheckResult; note?: string }>;

const RESULTS: Array<{ value: CheckResult; label: string; icon: ReactNode; on: string }> = [
  { value: "pass", label: "Pass", icon: <Check />, on: "bg-success text-white border-success" },
  { value: "fail", label: "Fail", icon: <X />, on: "bg-destructive text-white border-destructive" },
  {
    value: "na",
    label: "N/A",
    icon: <Minus />,
    on: "bg-muted-foreground text-white border-muted-foreground",
  },
];

/** How far a checklist has got: answered, passed and failed counts. */
export function checklistSummary(items: ChecklistItem[], value: ChecklistValue) {
  let answered = 0;
  let passed = 0;
  let failed = 0;
  for (const item of items) {
    const result = value[item.id]?.result;
    if (!result) continue;
    answered += 1;
    if (result === "pass") passed += 1;
    if (result === "fail") failed += 1;
  }
  return { total: items.length, answered, passed, failed, complete: answered === items.length };
}

/**
 * An inspection or audit checklist: each item is passed, failed or not applicable, and a failed
 * item asks for a note. Keep the value in a longtext column with JSON.stringify and readJson.
 */
export function Checklist({
  items,
  value,
  onChange,
  readOnly,
}: {
  items: ChecklistItem[];
  value: ChecklistValue;
  onChange?: (next: ChecklistValue) => void;
  readOnly?: boolean;
}) {
  const summary = checklistSummary(items, value);
  const set = (id: string, patch: { result?: CheckResult; note?: string }) =>
    onChange?.({ ...value, [id]: { ...value[id], ...patch } });
  let section: string | undefined;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="relative h-2 min-w-40 flex-1 overflow-hidden rounded-full bg-muted">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-primary"
            animate={{ width: `${summary.total ? (summary.answered / summary.total) * 100 : 0}%` }}
            transition={{ duration: 0.4, ease }}
          />
        </div>
        <span className="font-semibold tabular">
          {summary.answered}/{summary.total} checked
        </span>
        {summary.failed > 0 && (
          <span className="font-semibold text-destructive tabular">{summary.failed} failed</span>
        )}
      </div>
      <ul className="flex flex-col divide-y divide-border/70 rounded-2xl border border-border/70 bg-card">
        {items.map((item) => {
          const entry = value[item.id] ?? {};
          const header = item.section && item.section !== section ? item.section : null;
          section = item.section;
          return (
            <li key={item.id} className="flex flex-col gap-2 px-4 py-3">
              {header && (
                <p className="-mx-4 -mt-3 mb-1 bg-muted/50 px-4 py-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
                  {header}
                </p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{item.label}</p>
                  {item.hint && <p className="text-xs text-muted-foreground">{item.hint}</p>}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {RESULTS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      disabled={readOnly}
                      aria-pressed={entry.result === option.value}
                      onClick={() =>
                        set(item.id, {
                          result: entry.result === option.value ? undefined : option.value,
                        })
                      }
                      className={cn(
                        "inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-xs font-bold transition-colors disabled:cursor-default [&_svg]:size-3.5",
                        entry.result === option.value
                          ? option.on
                          : "border-border bg-card text-muted-foreground enabled:hover:text-foreground",
                      )}
                    >
                      {option.icon}
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              {(entry.result === "fail" || entry.note) && (
                <Textarea
                  value={entry.note ?? ""}
                  readOnly={readOnly}
                  placeholder="What is wrong, and what needs doing?"
                  onChange={(event) => set(item.id, { note: event.target.value })}
                  rows={2}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Last 7 days, 30 days, quarter, year to date, 12 months or everything, for dashboards. */
export function PeriodFilter({
  value,
  onChange,
  options = ["30d", "90d", "ytd", "12m", "all"],
}: {
  value: Period;
  onChange: (period: Period) => void;
  options?: Period[];
}) {
  return (
    <Tabs
      value={value}
      onChange={onChange}
      items={options.map((period) => ({
        value: period,
        label: (
          <>
            <span className="sm:hidden">{SHORT_PERIODS[period]}</span>
            <span className="hidden sm:inline">{PERIODS[period]}</span>
          </>
        ),
      }))}
    />
  );
}
