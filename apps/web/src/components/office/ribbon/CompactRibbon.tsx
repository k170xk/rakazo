import { useLingui } from "@lingui/react/macro";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@rakazo/ui-web";
import { ChevronUp, Ellipsis, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";
import { quickControl, RibbonLayoutProvider, SheetGrip } from "./layout";
import type { RibbonProps } from "./Ribbon";

const noop = () => {};
const PINNED = { layout: "quick", pass: "pinned", close: noop } as const;
const QUICK = { layout: "quick", pass: "quick", close: noop } as const;
const ALL = { layout: "quick", pass: "all", close: noop } as const;

/**
 * The ribbon on phones, after the Office mobile apps: one row with a tab button, the open tab's
 * most used tools (selection tools first) scrolling sideways, and a sheet with every tool of a
 * tab as large labelled tiles. It draws the same tool definitions as the desktop ribbon.
 */
export function CompactRibbon({
  label,
  tabs,
  value,
  onValueChange,
  end,
  testId,
  children,
}: RibbonProps) {
  const { t } = useLingui();
  const base = useId();
  const [sheetOpen, setSheetOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLButtonElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const open = tabs.find((tab) => tab.id === value) ?? tabs[0];
  const contextual = tabs.filter((tab) => tab.contextual && tab.id !== open?.id);
  const contextKey = contextual.map((tab) => tab.id).join(",");

  const measure = useCallback(() => {
    const node = scroller.current;
    if (!node) return;
    const max = node.scrollWidth - node.clientWidth;
    const position = Math.abs(node.scrollLeft);
    const next = { start: position > 2, end: position < max - 2 };
    setEdges((now) => (now.start === next.start && now.end === next.end ? now : next));
  }, []);

  useEffect(measure);

  useEffect(() => {
    const node = scroller.current;
    if (!node || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure]);

  // Tools for a new selection appear at the row's start, so bring them into view.
  useEffect(() => {
    if (contextKey) scroller.current?.scrollTo?.({ left: 0, behavior: "smooth" });
  }, [contextKey]);

  const close = useCallback(() => setSheetOpen(false), []);

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const next = tabs[(index + (rtl ? -step : step) + tabs.length) % tabs.length];
    if (!next) return;
    onValueChange(next.id);
    document.getElementById(`${base}-tab-${next.id}`)?.focus();
  }

  return (
    <div
      className="shrink-0 border-b border-border bg-muted print:hidden"
      data-testid={testId}
      data-ribbon=""
      data-compact=""
    >
      <div className="flex h-[52px] items-center gap-1 ps-[max(0.375rem,env(safe-area-inset-left))] pe-[max(0.375rem,env(safe-area-inset-right))]">
        <button
          ref={picker}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          aria-label={t`${open?.label ?? ""} tools`}
          data-testid={testId ? `${testId}-tab-picker` : undefined}
          onClick={() => setSheetOpen(true)}
          className="flex h-11 shrink-0 items-center gap-1 rounded-full bg-background px-3.5 text-[14px] font-medium text-foreground shadow-xs ring-1 ring-foreground/[0.06] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open?.label}
          <ChevronUp className="size-3.5 opacity-60" aria-hidden="true" />
        </button>
        <div className="relative min-w-0 flex-1">
          <div
            ref={scroller}
            role="toolbar"
            aria-label={label}
            data-testid={testId ? `${testId}-quick` : undefined}
            onScroll={measure}
            className="flex h-11 items-center gap-0.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {contextual.length ? (
              <>
                <RibbonLayoutProvider value={QUICK}>
                  {contextual.map((tab) => (
                    <Fragment key={tab.id}>{tab.content}</Fragment>
                  ))}
                </RibbonLayoutProvider>
                <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-foreground/10" />
              </>
            ) : null}
            <RibbonLayoutProvider value={PINNED}>
              {tabs.map((tab) => (
                <Fragment key={tab.id}>{tab.content}</Fragment>
              ))}
            </RibbonLayoutProvider>
            <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-foreground/10" />
            <RibbonLayoutProvider value={QUICK}>{open?.content}</RibbonLayoutProvider>
          </div>
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute inset-y-0 start-0 w-6 bg-gradient-to-r from-muted to-transparent transition-opacity rtl:bg-gradient-to-l ${
              edges.start ? "opacity-100" : "opacity-0"
            }`}
          />
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute inset-y-0 end-0 w-8 bg-gradient-to-l from-muted to-transparent transition-opacity rtl:bg-gradient-to-r ${
              edges.end ? "opacity-100" : "opacity-0"
            }`}
          />
        </div>
        {end ? (
          <RibbonLayoutProvider value={ALL}>
            <div className="flex shrink-0 items-center">{end}</div>
          </RibbonLayoutProvider>
        ) : null}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={t`All tools`}
          data-testid={testId ? `${testId}-more` : undefined}
          onClick={() => setSheetOpen(true)}
          className={quickControl}
        >
          <Ellipsis className="size-5" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      {children}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          ref={sheet}
          side="bottom"
          showCloseButton={false}
          data-testid={testId ? `${testId}-sheet` : undefined}
          // A tool that moved the cursor into the document keeps it there once the sheet closes.
          finalFocus={() => {
            const active = document.activeElement;
            const kept = active && active !== document.body && !sheet.current?.contains(active);
            return kept ? false : (picker.current ?? true);
          }}
          className="max-h-[min(75dvh,40rem)] gap-0 rounded-t-2xl border-t-0 bg-muted pb-[max(0.75rem,env(safe-area-inset-bottom))] ps-[env(safe-area-inset-left)] pe-[env(safe-area-inset-right)] ring-1 ring-foreground/10"
        >
          <div className="px-2">
            <SheetGrip sheet={sheet} onClose={close} />
          </div>
          <div className="flex shrink-0 items-center gap-2 ps-3 pe-2 pb-2">
            <SheetTitle className="sr-only">{label}</SheetTitle>
            <div
              role="tablist"
              aria-label={label}
              className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {tabs.map((tab, index) => {
                const selected = tab.id === open?.id;
                return (
                  <button
                    key={tab.id}
                    id={`${base}-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`${base}-panel`}
                    tabIndex={selected ? 0 : -1}
                    data-testid={testId ? `${testId}-sheet-tab-${tab.id}` : undefined}
                    onClick={() => onValueChange(tab.id)}
                    onKeyDown={(event) => onTabKey(event, index)}
                    className={`h-10 shrink-0 rounded-full px-4 text-[14px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                      selected
                        ? "bg-background font-medium text-foreground shadow-xs ring-1 ring-foreground/[0.06]"
                        : "text-muted-foreground active:bg-foreground/[0.06]"
                    }`}
                  >
                    {tab.label}
                    {tab.contextual ? (
                      <span
                        aria-hidden="true"
                        className="ms-1.5 inline-block size-1.5 rounded-full bg-primary align-middle"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
            <SheetClose
              aria-label={t`Close`}
              className="grid size-11 shrink-0 place-items-center rounded-full text-foreground outline-none active:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-5" strokeWidth={1.8} aria-hidden="true" />
            </SheetClose>
          </div>
          <div
            id={`${base}-panel`}
            role="tabpanel"
            aria-labelledby={open ? `${base}-tab-${open.id}` : undefined}
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-3 pt-1 pb-2"
          >
            <RibbonLayoutProvider value={{ layout: "sheet", pass: "all", close }}>
              {open?.content}
            </RibbonLayoutProvider>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
