import { useEffect, useRef, useState } from "react";
import type { SaveQueue } from "./word/save-queue";

type Latest = { version: number };

/**
 * When the polled revision moves past what the studio shows, load that version — after any
 * in-progress save finishes, and without starting a second load that would cancel the first.
 *
 * Excel and PowerPoint also cap open failures (parse/open errors) so a permanently bad file does
 * not loop forever; Word omits the cap. Failure count only moves when a finished load left the
 * studio still behind, never when the effect re-runs for save-status flicker.
 */
export function useApplyNewerVersion(options: {
  newest: number | undefined;
  /** Re-enter when the save queue status changes (saving → saved / idle). */
  saveStatus: string | null | undefined;
  queue: { current: SaveQueue | null };
  latest: { current: Latest | null };
  loadNewer: () => void | Promise<void>;
  /**
   * Bumped by the studio after an open failure schedules another attempt. Word leaves this unset.
   */
  openFailureTick?: number;
  /** Open failures allowed for the aimed version. Omit for unlimited (Word). */
  maxOpenFailures?: number;
}): { resetOpenFailures: () => void } {
  const { newest, saveStatus, queue, latest, loadNewer, openFailureTick = 0, maxOpenFailures } =
    options;
  const inFlight = useRef(false);
  const aimed = useRef<number | undefined>(undefined);
  const failures = useRef(0);
  const loadRef = useRef(loadNewer);
  loadRef.current = loadNewer;
  /** Bumped when a load finishes while a newer aim arrived, so the effect runs again. */
  const [pass, setPass] = useState(0);

  useEffect(() => {
    if (newest !== aimed.current) {
      aimed.current = newest;
      failures.current = 0;
    }
    const shown = latest.current?.version;
    const saves = queue.current;
    if (newest === undefined || shown === undefined || newest <= shown || !saves) {
      if (shown !== undefined && newest !== undefined && newest <= shown) failures.current = 0;
      return;
    }
    const now = saves.state();
    // Re-checked when the save finishes, so a version that arrived mid-save is not dropped.
    if (now.status === "saving") return;
    // Unsaved edits go first; the server then answers with a conflict and the newest version loads.
    if (now.dirty) {
      void saves.flush();
      return;
    }
    if (inFlight.current) return;
    if (maxOpenFailures !== undefined && failures.current >= maxOpenFailures) return;

    const before = shown;
    const target = newest;
    inFlight.current = true;
    void (async () => {
      try {
        await loadRef.current();
      } finally {
        inFlight.current = false;
      }
      const after = latest.current?.version;
      if (aimed.current !== target) {
        // A newer revision arrived while this load ran; run again for the new aim.
        setPass((n) => n + 1);
        return;
      }
      // Still behind after the load finished → count a failure (open/parse/network).
      if (after === undefined || after < target) {
        if (after === before) failures.current += 1;
        return;
      }
      failures.current = 0;
    })();
    // loadNewer is read from a ref so a changing callback does not cancel or re-count a good load.
  }, [newest, saveStatus, openFailureTick, maxOpenFailures, queue, latest, pass]);

  return {
    resetOpenFailures: () => {
      failures.current = 0;
    },
  };
}
