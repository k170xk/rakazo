import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { createContext, useCallback, useContext, useRef, useSyncExternalStore } from "react";

/**
 * Where ribbon tools are drawn: the desktop ribbon, the phone's one-row toolbar, or the large
 * labelled tiles of the phone's tools sheet. Every studio's tools are written once and read this.
 */
export type RibbonLayout = "bar" | "quick" | "sheet";

/**
 * Puts a tool in the phone toolbar: `true` while its tab is open, `"pinned"` on every tab (undo
 * and redo). Tools without it are reached through the tools sheet.
 */
export type Quick = boolean | "pinned";

/** Which tools one pass of the phone toolbar draws. */
export type QuickPass = "pinned" | "quick" | "all";

type RibbonLayoutValue = {
  layout: RibbonLayout;
  pass: QuickPass;
  /** Closes the tools sheet; does nothing outside it. */
  close: () => void;
};

const noop = () => {};
const RibbonLayoutContext = createContext<RibbonLayoutValue>({
  layout: "bar",
  pass: "all",
  close: noop,
});

export const RibbonLayoutProvider = RibbonLayoutContext.Provider;

export function useRibbonLayout(): RibbonLayoutValue {
  return useContext(RibbonLayoutContext);
}

/** Whether a tool marked `quick` belongs in the current pass of the phone toolbar. */
export function showsIn(value: Pick<RibbonLayoutValue, "layout" | "pass">, quick?: Quick) {
  if (value.layout !== "quick" || value.pass === "all") return true;
  if (value.pass === "pinned") return quick === "pinned";
  return quick === true;
}

/** Phones, and phones on their side, whose short screen can't spare a two-row ribbon. */
export const COMPACT_RIBBON_QUERY = "(max-width: 767px), (pointer: coarse) and (max-height: 500px)";

function subscribeCompact(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return noop;
  const media = window.matchMedia(COMPACT_RIBBON_QUERY);
  media.addEventListener("change", onChange);
  window.addEventListener("orientationchange", onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("orientationchange", onChange);
  };
}

function readCompact() {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(COMPACT_RIBBON_QUERY).matches
    : false;
}

export function useCompactRibbon(): boolean {
  return useSyncExternalStore(subscribeCompact, readCompact, () => false);
}

/** A round 44px tool in the phone toolbar. */
export const quickControl =
  "flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-full px-2 text-[14px] leading-5 text-foreground outline-none transition-colors active:bg-foreground/[0.1] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-primary/15 aria-pressed:text-primary data-popup-open:bg-foreground/[0.08]";

/** A labelled tile in the tools sheet. */
export const sheetTile =
  "flex min-h-16 min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl bg-background px-1.5 py-2 text-center text-[12px] leading-tight text-foreground ring-1 ring-foreground/[0.07] outline-none transition-colors active:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-primary/15 aria-pressed:text-primary aria-pressed:ring-primary/30 data-popup-open:bg-foreground/[0.06]";

/** Pins a menu or popover to the bottom of the screen as a sheet on phones. */
export const sheetPositioner =
  "!fixed !inset-x-0 !top-auto !bottom-0 !left-0 !right-0 !h-auto !w-auto ![transform:none]";

/** The sheet look of a menu or popover on phones, with roomy rows. */
export const sheetPopup =
  "!w-full !max-w-none max-h-[min(70dvh,34rem)] rounded-t-2xl rounded-b-none px-2 pt-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] ps-[max(0.5rem,env(safe-area-inset-left))] pe-[max(0.5rem,env(safe-area-inset-right))] shadow-[0_-12px_40px_-16px_rgb(0_0_0/0.35)] data-open:zoom-in-100 data-open:slide-in-from-bottom-10 data-closed:zoom-out-100 data-closed:slide-out-to-bottom-10 [&_[role=menuitem]]:min-h-11 [&_[role=menuitem]]:text-[15px] [&_[role=menuitemradio]]:min-h-11 [&_[role=menuitemradio]]:text-[15px] [&_[role=menuitemcheckbox]]:min-h-11";

const SWIPE_CLOSE = 72;

/**
 * Lets a sheet follow a downward drag from its grip and close past a short distance, or spring
 * back. `sheet` is the element that moves.
 */
export function useSwipeToClose(sheet: RefObject<HTMLElement | null>, onClose: () => void) {
  const start = useRef<{ y: number; id: number } | null>(null);
  const latest = useRef(onClose);
  latest.current = onClose;

  const move = useCallback(
    (offset: number) => {
      const node = sheet.current;
      if (!node) return;
      node.style.transition = offset ? "none" : "";
      node.style.translate = offset ? `0 ${offset}px` : "";
    },
    [sheet],
  );

  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      start.current = { y: event.clientY, id: event.pointerId };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      if (start.current?.id !== event.pointerId) return;
      move(Math.max(0, event.clientY - start.current.y));
    },
    onPointerUp(event: ReactPointerEvent<HTMLElement>) {
      if (start.current?.id !== event.pointerId) return;
      const offset = event.clientY - start.current.y;
      start.current = null;
      move(0);
      if (offset > SWIPE_CLOSE) latest.current();
    },
    onPointerCancel() {
      start.current = null;
      move(0);
    },
  };
}

/** The bar at the top of a sheet: drag it down to close. */
export function SheetGrip({
  sheet,
  onClose,
}: {
  sheet: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const swipe = useSwipeToClose(sheet, onClose);
  return (
    <div
      aria-hidden="true"
      data-sheet-grip=""
      className="-mx-2 flex h-6 shrink-0 cursor-grab touch-none items-center justify-center"
      {...swipe}
    >
      <span className="h-1.5 w-10 rounded-full bg-foreground/20" />
    </div>
  );
}
