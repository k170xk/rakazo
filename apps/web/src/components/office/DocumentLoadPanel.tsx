import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { Loader2, RefreshCw, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { type DocumentLoadState, formatLoadBytes, loadPercent } from "./document-load";

type DocumentLoadPanelProps = {
  state: DocumentLoadState;
  /** Noun for the file type in error copy, already translated. */
  fileLabel: string;
  onRetry: () => void;
  /** Optional secondary action (e.g. download the raw file). */
  secondary?: ReactNode;
};

/**
 * Full-studio loading and error surface for Word, PowerPoint and Excel — progress on slow links,
 * clear retry when the network stalls or drops.
 */
export function DocumentLoadPanel({
  state,
  fileLabel,
  onRetry,
  secondary,
}: DocumentLoadPanelProps) {
  const { t } = useLingui();
  if (state.status === "idle") return null;

  if (state.status === "error") {
    const message =
      state.reason === "stalled"
        ? t`The download stalled on a slow connection. Check your network and try again.`
        : state.reason === "truncated" || state.reason === "network"
          ? t`The ${fileLabel} didn't finish downloading. Check your connection and try again.`
          : t`This ${fileLabel} couldn't be opened. Check your connection and try again.`;
    return (
      <div className="grid size-full place-items-center p-6" data-testid="office-load-error">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <WifiOff className="size-5 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
          <p className="text-[14px] text-muted-foreground">{message}</p>
          {state.attempt > 1 ? (
            <p className="text-[12px] text-muted-foreground">
              <Trans>
                Tried {state.attempt} of {state.attempts} times
              </Trans>
            </p>
          ) : null}
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" size="sm" onClick={onRetry} data-testid="office-load-retry">
              <RefreshCw className="size-4" />
              <Trans>Try again</Trans>
            </Button>
            {secondary}
          </div>
        </div>
      </div>
    );
  }

  const percent = loadPercent(state.received, state.total);
  const detail =
    state.phase === "opening"
      ? t`Opening…`
      : percent !== null
        ? t`${percent}% · ${formatLoadBytes(state.received)} of ${formatLoadBytes(state.total!)}`
        : state.received > 0
          ? t`${formatLoadBytes(state.received)} downloaded`
          : t`Starting download…`;
  const slow = state.phase === "fetching" && state.attempt > 1;

  return (
    <div className="grid size-full place-items-center p-6" data-testid="office-load-progress">
      <div className="flex w-full max-w-xs flex-col items-center gap-3 text-center">
        <Loader2
          className="size-5 animate-spin text-muted-foreground"
          strokeWidth={1.7}
          aria-label={t`Loading`}
        />
        <p className="text-[14px] font-medium text-foreground">
          {slow ? <Trans>Still loading on a slow connection…</Trans> : <Trans>Loading…</Trans>}
        </p>
        <p className="text-[12px] text-muted-foreground" aria-live="polite">
          {detail}
        </p>
        {percent !== null ? (
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
        ) : state.received > 0 ? (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/70" />
          </div>
        ) : null}
        {state.attempt > 1 ? (
          <p className="text-[12px] text-muted-foreground">
            <Trans>
              Attempt {state.attempt} of {state.attempts}
            </Trans>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Compact overlay while a newer version loads over the open document. */
export function DocumentLoadOverlay({ state }: { state: DocumentLoadState }) {
  const { t } = useLingui();
  if (state.status !== "loading") return null;
  const percent = loadPercent(state.received, state.total);
  const label =
    state.phase === "opening"
      ? t`Opening…`
      : percent !== null
        ? t`Loading ${percent}%`
        : state.received > 0
          ? t`Loading ${formatLoadBytes(state.received)}`
          : t`Loading…`;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-12 z-10 flex justify-center">
      <span
        className="flex items-center gap-1.5 rounded-full bg-background/95 px-3 py-1 text-[12px] font-medium text-foreground shadow-sm ring-1 ring-border"
        aria-live="polite"
        data-testid="office-load-overlay"
      >
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        {label}
      </span>
    </div>
  );
}
