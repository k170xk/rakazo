import { Trans, useLingui } from "@lingui/react/macro";
import type { Announcement } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@rakazo/ui-web";
import { RotateCw, Sparkles } from "lucide-react";
import { formatRelativeTime } from "../../lib/relative-time";

type Props = {
  announcement: Pick<Announcement, "title" | "body" | "image" | "offerReload" | "createdAt" | "authorName">;
  open: boolean;
  /** "1 of 3" when several are waiting. */
  position?: { index: number; count: number };
  busy?: boolean;
  onDismiss: () => void;
  onReload: () => void;
};

/** A company update as everyone sees it; the admin page shows the same dialog as a preview. */
export function AnnouncementDialog({ announcement, open, position, busy, onDismiss, onReload }: Props) {
  const { t } = useLingui();
  const when = formatRelativeTime(announcement.createdAt);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onDismiss()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl" data-testid="company-announcement">
        {announcement.image ? (
          <div className="max-h-[55vh] overflow-auto border-b border-border bg-muted/40">
            <img src={announcement.image} alt="" className="block w-full" />
          </div>
        ) : null}
        <div className="space-y-4 p-6">
          <DialogHeader className="space-y-2 text-start">
            <p className="flex items-center gap-1.5 text-xs font-medium text-success">
              <Sparkles size={14} aria-hidden="true" />
              <Trans>What's new</Trans>
              {position && position.count > 1 ? (
                <span className="text-muted-foreground">
                  {" · "}
                  <Trans>
                    {position.index + 1} of {position.count}
                  </Trans>
                </span>
              ) : null}
            </p>
            <DialogTitle className="text-lg">{announcement.title}</DialogTitle>
            <DialogDescription className="text-xs">
              {announcement.authorName ? t`From ${announcement.authorName} · ${when}` : when}
            </DialogDescription>
          </DialogHeader>
          {announcement.body ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{announcement.body}</p>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" disabled={busy} onClick={onDismiss}>
              {position && position.index + 1 < position.count ? <Trans>Next</Trans> : <Trans>Dismiss</Trans>}
            </Button>
            {announcement.offerReload ? (
              <Button disabled={busy} onClick={onReload}>
                <RotateCw aria-hidden="true" />
                <Trans>Reload to update</Trans>
              </Button>
            ) : null}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
