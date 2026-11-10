import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  dismissOffer,
  FRAME_HELLO,
  FRAME_HOST,
  FRAME_OPEN_STANDALONE,
  heldInstallPrompt,
  installOffer,
  offerDismissed,
  promptInstall,
  subscribeInstallPrompt,
} from "../pwa/install";

/** The page framing the app, once it has said it can open the app in a signed-in window. */
function useFrameHost(framed: boolean): string | null {
  const [hostOrigin, setHostOrigin] = useState<string | null>(null);
  useEffect(() => {
    if (!framed) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== FRAME_HOST) return;
      if (event.data.openStandalone === true) setHostOrigin(event.origin);
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: FRAME_HELLO }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [framed]);
  return hostOrigin;
}

/**
 * Offers to install OCSC Intelligence as its own app, or, inside another page's frame, to open
 * it in its own window where it can be installed.
 */
export function InstallAppBanner() {
  const { t } = useLingui();
  const prompt = useSyncExternalStore(subscribeInstallPrompt, heldInstallPrompt, () => null);
  const offer = installOffer(window, prompt);
  const hostOrigin = useFrameHost(offer === "open-standalone");
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!offer || hidden || offerDismissed(offer)) return null;

  const close = () => {
    dismissOffer(offer);
    setHidden(true);
  };

  const openStandalone = () => {
    if (hostOrigin) {
      window.parent.postMessage(
        { type: FRAME_OPEN_STANDALONE, path: `${location.pathname}${location.search}` },
        hostOrigin,
      );
    } else {
      window.open(`${location.origin}/`, "_blank", "noopener");
    }
    setHidden(true);
  };

  const install = async () => {
    setBusy(true);
    try {
      if (await promptInstall()) setHidden(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label={t`Install OCSC Intelligence`}
      data-testid="install-app-banner"
      className="fixed inset-x-3 bottom-3 z-50 sm:inset-x-auto sm:end-4 sm:bottom-4 sm:w-96"
    >
      <div className="flex gap-3 rounded-xl border border-border bg-card p-3 text-card-foreground shadow-lg">
        <img src="/icon-192.png" alt="" className="size-10 flex-none rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {offer === "open-standalone" ? (
              <Trans>Use OCSC Intelligence as an app</Trans>
            ) : (
              <Trans>Install OCSC Intelligence</Trans>
            )}
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {offer === "open-standalone" ? (
              <Trans>
                Open it in its own window, then install it to get its own icon and window.
              </Trans>
            ) : offer === "prompt" ? (
              <Trans>Get its own icon and window, and open it straight from your desktop.</Trans>
            ) : offer === "ios" ? (
              <Trans>Tap Share, then Add to Home Screen.</Trans>
            ) : (
              <Trans>In Safari's File menu, choose Add to Dock.</Trans>
            )}
          </p>
          {offer === "open-standalone" || offer === "prompt" ? (
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={offer === "prompt" ? () => void install() : openStandalone}
              >
                {offer === "prompt" ? (
                  <Trans>Install</Trans>
                ) : (
                  <Trans>Open in its own window</Trans>
                )}
              </Button>
              <Button size="sm" variant="ghost" onClick={close}>
                <Trans>Not now</Trans>
              </Button>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={close}
          aria-label={t`Close`}
          className="flex size-6 flex-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
