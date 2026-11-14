import { Trans, useLingui } from "@lingui/react/macro";
import type { PageDetail } from "@rakazo/contracts";
import { Button, Dialog, DialogClose, DialogContent, DialogTitle } from "@rakazo/ui-web";
import { Pencil, X } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useRef } from "react";
import { ownerAppSource } from "../../lib/app-host";
import { useSpaceQueries } from "../../lib/query";
import { AppFrame } from "./AppFrame";

/**
 * The owner's app full screen, as the people using it see it. No code, data, chat or settings:
 * those stay in the editor.
 */
export function AppViewer({
  open,
  onOpenChange,
  page,
  ownerName,
  onEdit,
  returnFocus,
  notice = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: PageDetail | undefined;
  ownerName: string | null;
  onEdit: () => void;
  returnFocus?: () => boolean;
  notice?: ReactNode;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const closeButton = useRef<HTMLButtonElement>(null);
  const pageId = page?.id ?? null;
  const source = useMemo(
    () => (pageId ? ownerAppSource(queries, pageId, ownerName) : null),
    [queries, pageId, ownerName],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        initialFocus={closeButton}
        finalFocus={returnFocus}
        data-testid="app-viewer"
        className="top-0 left-0 block h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none bg-background p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] ps-[env(safe-area-inset-left)] pe-[env(safe-area-inset-right)] ring-0 sm:max-w-none data-open:duration-[260ms] data-open:zoom-in-[0.98] data-open:slide-in-from-bottom-3 data-closed:duration-150 motion-reduce:data-open:zoom-in-100"
      >
        <div className="relative size-full">
          <header className="absolute inset-x-0 top-0 z-10 flex h-12 items-center gap-2 px-2.5">
            <DialogClose
              ref={closeButton}
              aria-label={t`Close app`}
              className="grid size-[35px] shrink-0 place-items-center rounded-full border border-foreground/[0.06] text-foreground outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-[18px]" strokeWidth={1.7} />
            </DialogClose>
            <DialogTitle className="min-w-0 flex-1 truncate px-1 text-[14px] leading-5 font-medium text-foreground">
              {page?.title ?? t`App`}
            </DialogTitle>
            <Button size="sm" onClick={onEdit} data-testid="app-viewer-edit">
              <Pencil className="size-3.5" strokeWidth={1.8} />
              <Trans>Edit</Trans>
            </Button>
          </header>
          <div className="absolute inset-x-0 top-12 bottom-0">
            {notice ??
              (page && source ? (
                <AppFrame
                  document={page.code}
                  title={page.title}
                  app={{ id: page.id, version: page.version }}
                  source={source}
                  maps
                />
              ) : null)}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
