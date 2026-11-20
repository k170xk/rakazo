import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";

export type SaveStatus = "saving" | "saved" | "failed" | null;

/** A save quicker than this never shows "Saving…", so autosaves don't flicker the pill. */
const SAVING_SHOWN_AFTER_MS = 600;

/**
 * A small, steady save indicator for a studio's header: a dot and one word. Quick saves keep it
 * on "Saved"; only a slow save or a failure changes it.
 */
export function SaveStatusPill({ status, testId }: { status: SaveStatus; testId?: string }) {
  const [shown, setShown] = useState<SaveStatus>(status === "saving" ? null : status);
  useEffect(() => {
    if (status !== "saving") {
      setShown(status);
      return;
    }
    const timer = window.setTimeout(() => setShown("saving"), SAVING_SHOWN_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  if (!shown) return null;
  const failed = shown === "failed";
  const label = shown === "saving" ? t`Saving…` : failed ? t`Not saved` : t`Saved`;
  const dot = shown === "saving" ? "bg-muted-foreground/40" : failed ? "bg-destructive" : "bg-success";
  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-foreground/[0.04] px-2.5 text-[11px] font-medium ring-1 ring-inset ring-foreground/[0.06] max-sm:hidden ${
        failed ? "text-destructive" : "text-muted-foreground"
      }`}
      data-testid={testId}
      aria-live="polite"
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full transition-colors duration-500 ${dot}`} />
      {label}
    </span>
  );
}
