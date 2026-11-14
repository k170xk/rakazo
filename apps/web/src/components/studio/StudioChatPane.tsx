import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useStudioChatResize } from "./studio-chat-width";

/** The chat column shared by the studios, opened at the main chat's width and dragged wider or narrower. */
export function StudioChatPane({ children }: { children: ReactNode }) {
  const { t } = useLingui();
  const { resizing, handleProps, style } = useStudioChatResize();
  return (
    <div
      style={style}
      data-resizing={resizing || undefined}
      className="absolute inset-0 z-30 flex min-h-0 sm:relative sm:inset-auto sm:z-30 sm:w-(--studio-chat-width) sm:shrink-0"
    >
      <aside
        aria-label={t`Chat`}
        className="flex min-h-0 min-w-0 flex-1 flex-col border-foreground/[0.06] bg-background sm:border-r print:hidden [&_[data-testid=transcript]]:px-3 [&_[data-testid=transcript]]:pt-3 [&_[data-testid=transcript]]:pb-4"
      >
        {children}
      </aside>
      {/* The pane stays positioned so this edge belongs to the chat, not the studio behind it. */}
      <hr
        {...handleProps}
        data-testid="studio-chat-edge"
        aria-label={t`Resize chat`}
        className="absolute inset-y-0 -end-1 z-30 m-0 hidden h-full w-2 border-0 cursor-col-resize touch-none select-none hover:bg-sidebar-border focus-visible:bg-sidebar-border focus-visible:outline-none sm:block"
      />
    </div>
  );
}
