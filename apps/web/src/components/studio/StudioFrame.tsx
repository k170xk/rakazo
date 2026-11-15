import { useLingui } from "@lingui/react/macro";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@rakazo/ui-web";
import { Ellipsis, Loader2, MessageSquare, X } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePageSession } from "../../lib/pages";
import type { StudioCard } from "../../lib/studio-activity";
import { StudioChatPane } from "./StudioChatPane";
import { StudioFloatingDock, studioDockStyle } from "./studio-dock";

/** Round header icon button; size it at the call site (`size-8 sm:size-[35px]`). */
export const control =
  "grid shrink-0 place-items-center rounded-full border border-foreground/[0.06] text-foreground outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-primary/15 aria-pressed:text-primary";
/** Header button with an icon and a label that hides on phones. */
export const pill =
  "flex h-8 items-center gap-1 rounded-full border border-foreground/[0.06] px-2 text-[12px] leading-4 text-foreground outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-foreground/[0.06] sm:h-[35px] sm:gap-1.5 sm:px-[15px] sm:text-[14px] sm:leading-5";

/**
 * Centred product name in a studio header (Evolve Word, Evolve PowerPoint, …). Hidden on phones
 * where the switcher and tools already fill the bar.
 */
export function StudioProductMark({ name }: { name: string }) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 hidden items-center justify-center sm:flex"
      aria-hidden="true"
      data-testid="studio-product-mark"
    >
      <span className="max-w-[40%] truncate text-center text-[12px] font-medium tracking-wide text-muted-foreground sm:text-[13px]">
        {name}
      </span>
    </div>
  );
}

/**
 * Phone-only More control for secondary studio tools. Pair with `max-sm:hidden` (or
 * `hidden sm:flex`) on the desktop tools it replaces so the header stays within ~375px.
 */
export function StudioMoreMenu({
  children,
  label,
}: {
  children: ReactNode;
  /** Accessible name; defaults to "More". */
  label?: string;
}) {
  const { t } = useLingui();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label ?? t`More`}
        data-testid="studio-more"
        className={`${control} size-8 data-popup-open:bg-foreground/[0.06] sm:hidden`}
      >
        <Ellipsis className="size-4" strokeWidth={1.7} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const idleSubscribe = () => () => {};
const NO_ACTIVITY: StudioCard[] = [];

export type StudioDock = {
  session: ReturnType<typeof usePageSession>;
  /** The chat's agent is answering. */
  running: boolean;
  /** Latest messages and actions, for the strip above a closed chat. */
  activity: readonly StudioCard[];
  chatOpen: boolean;
  setChatOpen: (next: boolean | ((open: boolean) => boolean)) => void;
  /** Where the chat transcript mounts while the chat column is open. */
  chatRef: (node: HTMLDivElement | null) => void;
  /** Where the chat composer mounts, docked or floating. */
  composer: ReactNode;
};

/**
 * Moves the open chat's transcript and composer into a studio and reads its run state. The chat
 * starts open on wide screens. Unmounting hands the transcript and composer back to the chat.
 */
export function useStudioDock(): StudioDock {
  const session = usePageSession();
  const [chatOpen, setChatOpen] = useState(
    () =>
      typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1024px)").matches,
  );
  const running = useSyncExternalStore(
    session?.dock.subscribe ?? idleSubscribe,
    () => session?.dock.get().running === true,
    () => false,
  );
  const activity = useSyncExternalStore(
    session?.dock.subscribe ?? idleSubscribe,
    () => session?.dock.get().activity ?? NO_ACTIVITY,
    () => NO_ACTIVITY,
  );
  const setDockNode = useCallback(
    (node: HTMLDivElement | null) => session?.dock.set({ node }),
    [session],
  );
  const chatRef = useCallback(
    (chat: HTMLDivElement | null) => session?.dock.set({ chat }),
    [session],
  );

  useEffect(
    () => () => {
      session?.dock.set({ page: null, node: null, chat: null });
    },
    [session],
  );

  return {
    session,
    running,
    activity,
    chatOpen,
    setChatOpen,
    chatRef,
    composer: <div ref={setDockNode} />,
  };
}

export type StudioFrameProps = {
  /** `data-testid` on the dialog. */
  testId: string;
  /** Screen-reader title of the dialog, usually the open item's name. */
  title: string;
  onClose: () => void;
  /** Accessible name of the close button. Defaults to "Close app". */
  closeLabel?: string;
  /** Lets the studio print its content with the page print styles. */
  printable?: boolean;
  /** After the close button: New, then the switcher or a rename field. */
  start?: ReactNode;
  /** Right of the spacer, before Share: the studio's own tools. */
  actions?: ReactNode;
  /** Share control, just before the Chat toggle. */
  share?: ReactNode;
  /** Shown in the header while `running`, e.g. "Working on your document…". Clicking opens the chat. */
  workingLabel?: string;
  /** From `useStudioDock()`. */
  dock: Pick<
    StudioDock,
    "running" | "activity" | "chatOpen" | "setChatOpen" | "chatRef" | "composer"
  >;
  /** Accessible name of the content pane; defaults to `title`. */
  paneLabel?: string;
  paneRef?: Ref<HTMLElement>;
  /** Raises the floating composer above a bar along the canvas's bottom edge. */
  dockLift?: string;
  /**
   * Centred product name in the header (e.g. "Evolve Word"). Shown from `sm` up so phones keep
   * room for the document switcher and tools.
   */
  product?: string;
  /** The studio's canvas, filling the space beside the chat. */
  children?: ReactNode;
};

/**
 * Full-screen studio chrome shared by Apps, Whiteboards and documents: a 48px header, an optional
 * chat column on the left with the composer under it, and the composer floating over the content
 * with the activity strip when the chat is closed.
 */
export function StudioFrame({
  testId,
  title,
  onClose,
  closeLabel,
  printable = false,
  start,
  actions,
  share,
  workingLabel,
  dock,
  paneLabel,
  paneRef,
  dockLift,
  product,
  children,
}: StudioFrameProps) {
  const { t } = useLingui();
  const closeButton = useRef<HTMLButtonElement>(null);
  const { running, activity, chatOpen, setChatOpen, chatRef, composer } = dock;

  return (
    <Dialog
      open
      // Full-screen studios: a phone tap that opens them must not count as an outside
      // press and close them again. Only the close control (or Escape) dismisses.
      disablePointerDismissal
      onOpenChange={(open, details) => {
        const target = details.event?.target;
        if (
          !open &&
          details.reason === "escape-key" &&
          target instanceof Element &&
          target.closest('[data-slot="popover-content"], [data-slot="dropdown-menu-content"]')
        ) {
          details.cancel();
          return;
        }
        if (!open) onClose();
      }}
    >
      <DialogContent
        overlay={false}
        showCloseButton={false}
        initialFocus={closeButton}
        data-testid={testId}
        data-page-print={printable ? "" : undefined}
        className="overflow-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] ps-[env(safe-area-inset-left)] pe-[env(safe-area-inset-right)]"
      >
        {/* Absolute children ignore the dialog's safe-area padding, so they sit in this box. */}
        <div className="relative size-full">
          <header className="absolute inset-x-0 top-0 z-10 flex h-10 items-center gap-1 overflow-hidden border-b border-border bg-muted px-1.5 sm:h-12 sm:gap-2 sm:px-2.5 print:hidden">
            <button
              type="button"
              aria-pressed={chatOpen}
              data-haptic="select"
              title={t`Show the chat beside the app`}
              aria-label={t`Chat`}
              onClick={() => setChatOpen((open) => !open)}
              className={`${control} relative size-8 sm:size-[35px]`}
            >
              <MessageSquare className="size-4 sm:size-[18px]" strokeWidth={1.7} />
              {running && !chatOpen ? (
                <span className="absolute end-1 top-1 size-1.5 rounded-full bg-primary sm:size-2" />
              ) : null}
            </button>
            <DialogTitle className="sr-only">{title}</DialogTitle>
            {start}
            {product ? <StudioProductMark name={product} /> : null}
            <div className="min-w-0 flex-1" />
            {running && workingLabel ? (
              <button
                type="button"
                onClick={() => setChatOpen(true)}
                data-haptic="tap"
                className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 text-[11px] font-medium text-primary sm:h-[28px] sm:gap-1.5 sm:px-2.5 sm:text-[12px]"
              >
                <Loader2
                  className="size-3 animate-spin sm:size-3.5"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <span className="max-sm:sr-only">{workingLabel}</span>
              </button>
            ) : null}
            {actions}
            {share}
            <DialogClose
              ref={closeButton}
              aria-label={closeLabel ?? t`Close app`}
              className={`${control} size-8 sm:size-[35px]`}
            >
              <X className="size-4 sm:size-[18px]" strokeWidth={1.7} />
            </DialogClose>
          </header>
          <div
            className="absolute inset-x-0 top-10 bottom-0 flex sm:top-12"
            style={studioDockStyle(chatOpen, running)}
          >
            {chatOpen ? (
              <StudioChatPane>
                <div ref={chatRef} className="flex min-h-0 flex-1 flex-col" />
                <div className="shrink-0 px-2 pb-2">{composer}</div>
              </StudioChatPane>
            ) : null}
            <section
              ref={paneRef}
              aria-label={paneLabel ?? title}
              className="relative min-w-0 flex-1 bg-background"
            >
              {children}
            </section>
          </div>
          {chatOpen ? null : (
            <StudioFloatingDock
              lift={dockLift}
              activity={activity}
              running={running}
              onOpenChat={() => setChatOpen(true)}
            >
              {composer}
            </StudioFloatingDock>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
