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
  hasSeenBrowserNotificationsPrompt,
  markBrowserNotificationsPromptSeen,
  requestBrowserNotificationPermission,
  shouldOfferBrowserNotificationsPrompt,
} from "../lib/browser-notifications";
import {
  nativePushAvailable,
  nativePushPermissionState,
  requestNativePushPermission,
  syncNativePushUser,
} from "../lib/capacitor-push";
import { rpc } from "../lib/rpc";

const OFFER_DELAY_MS = 1_200;

/**
 * First-run dialogue that explains notifications, then asks for permission from the Enable
 * click (required user gesture). Capacitor uses the native prompt; browsers use Notification.
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
  const native = nativePushAvailable();

  useEffect(() => {
    if (!ready || !userId || open) return;
    let cancelled = false;
    let timer: number | undefined;
    void (async () => {
      const permission: BrowserNotificationPermission | undefined = native
        ? await nativePushPermissionState()
        : typeof Notification === "undefined"
          ? undefined
          : Notification.permission;
      const unseen = !hasSeenBrowserNotificationsPrompt(userId);
      // A native "denied" before the person has answered is often the plugin reporting
      // that it cannot ask yet. Still show the invitation once. A real OS refusal is
      // handled from Enable, which opens system settings when the prompt cannot appear.
      const offer =
        shouldOfferBrowserNotificationsPrompt({
          userId,
          permission,
          blockedByOverlay,
        }) || Boolean(native && permission === "denied" && unseen && !blockedByOverlay);
      if (cancelled || !offer) return;
      timer = window.setTimeout(() => setOpen(true), OFFER_DELAY_MS);
    })();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [ready, userId, blockedByOverlay, open, native]);

  if (!userId) return null;

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
        await rpc.notifications
          .updatePreferences({ inApp: true, push: true })
          .catch(() => undefined);
        if (native) {
          const granted = await requestNativePushPermission();
          if (granted) await syncNativePushUser(userId).catch(() => undefined);
        } else {
          await requestBrowserNotificationPermission();
        }
        onEnabled?.();
      } finally {
        setBusy(false);
        setOpen(false);
      }
    })();
  };

  return (
    <AlertDialog
      open={open}
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
            <Trans>Stay in the loop</Trans>
          </AlertDialogTitle>
          <AlertDialogDescription>
            <Trans>Get notified when a bot needs you or finishes important work.</Trans>
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
            {busy ? <Trans>Turning on…</Trans> : <Trans>Enable notifications</Trans>}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
