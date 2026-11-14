import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { usePageSession } from "../../lib/pages";
import type { StudioCard } from "../../lib/studio-activity";
import { StudioActivityButton, StudioWorkingLine } from "./StudioActivity";

/**
 * Room the floating composer, plus the working line while the assistant runs, covers at the
 * bottom of a studio. The canvas runs underneath it, so scrollers pad their end by `--studio-dock-space`.
 */
export function studioDockStyle(chatOpen: boolean, running: boolean): CSSProperties {
  const space = chatOpen ? "0px" : running ? "7rem" : "5.5rem";
  return { "--studio-dock-space": space } as CSSProperties;
}

/** Lifts the docked composer bar and its context chip off the canvas while they float. */
const FLOATING = [
  "[&_[data-testid=composer-bar]]:bg-card/85",
  "[&_[data-testid=composer-bar]]:backdrop-blur-xl",
  "[&_[data-testid=composer-bar]]:shadow-[0_10px_30px_-12px_rgb(0_0_0/0.3)]",
  "[&_[data-testid=composer-studio-context]]:mb-1",
  "[&_[data-testid=composer-studio-context]]:ps-2",
  "[&_[data-testid=studio-context-chip]]:h-[22px]",
  "[&_[data-testid=studio-context-chip]]:py-0",
  "[&_[data-testid=studio-context-chip]]:px-2",
  "[&_[data-testid=studio-context-chip]]:text-[12px]",
  "[&_[data-testid=studio-context-chip]]:border",
  "[&_[data-testid=studio-context-chip]]:border-foreground/[0.08]",
  "[&_[data-testid=studio-context-chip]]:bg-background/80",
  "[&_[data-testid=studio-context-chip]]:shadow-[0_4px_14px_-8px_rgb(0_0_0/0.3)]",
  "[&_[data-testid=studio-context-chip]]:backdrop-blur-md",
].join(" ");

/**
 * The composer floating over the canvas while the chat column is closed, with a button for the
 * latest messages and actions beside it on desktop (and in the composer's plus menu on phones)
 * and a slim working line above it during a run.
 */
export function StudioFloatingDock({
  className = "inset-x-0",
  lift = "0px",
  activity = [],
  running = false,
  onOpenChat,
  children,
}: {
  /** Horizontal placement; defaults to the full width. */
  className?: string;
  /** Keeps the dock above a bar along the canvas's bottom edge, such as sheet tabs. */
  lift?: string;
  activity?: readonly StudioCard[];
  running?: boolean;
  /** Opens the chat column; without it there is no activity button or working line. */
  onOpenChat?: () => void;
  children: ReactNode;
}) {
  const session = usePageSession();
  const showButton = Boolean(onOpenChat) && (running || activity.length > 0);
  const openChatRef = useRef(onOpenChat);
  openChatRef.current = onOpenChat;

  const canOpenChat = Boolean(onOpenChat);
  useEffect(() => {
    if (!canOpenChat) {
      session?.dock.setOpenChat(null);
      return;
    }
    // One stable opener so each studio render does not re-subscribe the composer.
    const open = () => openChatRef.current?.();
    session?.dock.setOpenChat(open);
    return () => session?.dock.setOpenChat(null);
  }, [session, canOpenChat]);

  return (
    <div
      data-testid="studio-floating-dock"
      style={{ bottom: `calc(max(12px, env(safe-area-inset-bottom)) + ${lift})` }}
      className={`pointer-events-none absolute z-20 flex justify-center px-3 print:hidden ${className}`}
    >
      <div className={`pointer-events-auto flex w-full max-w-[551px] flex-col ${FLOATING}`}>
        {onOpenChat ? (
          <StudioWorkingLine cards={activity} running={running} onOpen={onOpenChat} />
        ) : null}
        <div className="flex items-end gap-1.5">
          {showButton && onOpenChat ? (
            <StudioActivityButton
              cards={activity}
              running={running}
              onOpen={onOpenChat}
              className="max-md:hidden"
            />
          ) : null}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </div>
  );
}
