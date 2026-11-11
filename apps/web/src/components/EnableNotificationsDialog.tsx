import { Trans } from "@lingui/react/macro";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@rakazo/ui-web";
import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import type { BrowserNotificationPermission } from "../lib/browser-notifications";
import {
  markBrowserNotificationsPromptSeen,
  requestBrowserNotificationPermission,
  shouldOfferBrowserNotificationsPrompt,
} from "../lib/browser-notifications";

const OFFER_DELAY_MS = 1_200;

/**
 * First-run dialogue that explains desktop notifications, then asks the browser for permission
 * from the Enable click (required user gesture).
 */
export function EnableNotificationsDialog({
  userId,
  blockedByOverlay = false,
  ready = true,
  onEnabled,
}: {
  userId: string | undefined;
  /** Hide while another shell overlay is open so prompts do not stack. */
  blockedByOverlay?: boolean;
  /** Wait until the shell has finished its first paint (bots loaded). */
  ready?: boolean;
  /** Flush any notifications held while permission was still default. */
  onEnabled?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready || !userId || open) return;
    const permission: BrowserNotificationPermission | undefined =
      typeof Notification === "undefined" ? undefined : Notification.permission;
    if (
      !shouldOfferBrowserNotificationsPrompt({
        userId,
        permission,
        blockedByOverlay,
      })
    ) {
      return;
    }
    const timer = window.setTimeout(() => setOpen(true), OFFER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [ready, userId, blockedByOverlay, open]);

  if (!open || !userId) return null;

  const dismiss = () => {
    markBrowserNotificationsPromptSeen(userId);
    setOpen(false);
  };

  const enable = () => {
    if (busy) return;
    setBusy(true);
    markBrowserNotificationsPromptSeen(userId);
    void (async () => {
      try {
        await requestBrowserNotificationPermission();
        onEnabled?.();
      } finally {
        setBusy(false);
        setOpen(false);
      }
    })();
  };

  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) dismiss();
      }}
    >
      <AlertDialogContent data-testid="enable-notifications-dialog">
        <AlertDialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Bell className="size-5" aria-hidden />
          </div>
          <AlertDialogTitle>
            <Trans>Stay up to date</Trans>
          </AlertDialogTitle>
          <AlertDialogDescription>
            <Trans>
              Get notified when your work finishes, an agent needs your input, or a routine
              completes — even when you are in another tab.
            </Trans>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={busy}
            data-testid="enable-notifications-not-now"
            onClick={dismiss}
          >
            <Trans>Not now</Trans>
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            data-testid="enable-notifications-enable"
            onClick={(event) => {
              event.preventDefault();
              enable();
            }}
          >
            {busy ? <Trans>Turning on…</Trans> : <Trans>Turn on notifications</Trans>}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
