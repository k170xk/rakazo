import type { CSSProperties, ReactNode } from "react";

/**
 * Room the floating composer, plus the strip when it is showing, covers at the bottom of a
 * studio. The canvas runs underneath it, so scrollers pad their end by `--studio-dock-space`.
 */
export function studioDockStyle(chatOpen: boolean, showActivity: boolean): CSSProperties {
  const space = chatOpen ? "0px" : showActivity ? "10.5rem" : "5.5rem";
  return { "--studio-dock-space": space } as CSSProperties;
}

/** Lifts the docked composer bar and its context chip off the canvas while they float. */
const FLOATING = [
  "[&_[data-testid=composer-bar]]:bg-card/85",
  "[&_[data-testid=composer-bar]]:backdrop-blur-xl",
  "[&_[data-testid=composer-bar]]:shadow-[0_10px_30px_-12px_rgb(0_0_0/0.3)]",
  "[&_[data-testid=composer-studio-context]]:mb-1.5",
  "[&_[data-testid=composer-studio-context]]:ps-2",
  "[&_[data-testid=studio-context-chip]]:border",
  "[&_[data-testid=studio-context-chip]]:border-foreground/[0.08]",
  "[&_[data-testid=studio-context-chip]]:bg-background/80",
  "[&_[data-testid=studio-context-chip]]:shadow-[0_4px_14px_-8px_rgb(0_0_0/0.3)]",
  "[&_[data-testid=studio-context-chip]]:backdrop-blur-md",
].join(" ");

/** The composer and activity strip floating over the canvas while the chat column is closed. */
export function StudioFloatingDock({
  className = "inset-x-0",
  lift = "0px",
  children,
}: {
  /** Horizontal placement; defaults to the full width. */
  className?: string;
  /** Keeps the dock above a bar along the canvas's bottom edge, such as sheet tabs. */
  lift?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid="studio-floating-dock"
      style={{ bottom: `calc(max(12px, env(safe-area-inset-bottom)) + ${lift})` }}
      className={`pointer-events-none absolute z-20 flex justify-center px-3 print:hidden ${className}`}
    >
      <div className={`pointer-events-auto flex w-full max-w-[551px] flex-col gap-1.5 ${FLOATING}`}>
        {children}
      </div>
    </div>
  );
}
