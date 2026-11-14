import type { History } from "../ribbon/history";
import { createHistory, HISTORY_LIMIT } from "../ribbon/history";
import type { Workbook } from "./workbook";

/** Above this many cells, fewer steps are kept so undo copies do not crowd memory. */
const LARGE_WORKBOOK_CELLS = 200_000;
const LARGE_WORKBOOK_STEPS = 5;

function cellCount(wb: Workbook): number {
  let count = 0;
  for (const ref of wb.sheets) {
    const rows = (ref.sheet as { rows?: Map<number, Map<number, unknown>> }).rows;
    if (!rows) continue;
    for (const row of rows.values()) count += row.size;
  }
  return count;
}

/**
 * Puts `target` back to `snapshot` without replacing the object, so everything holding the
 * workbook (the save queue, the grid) sees the restored state.
 */
export function restoreWorkbook(target: Workbook, snapshot: Workbook): void {
  const record = target as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) delete record[key];
  Object.assign(record, snapshot);
}

export type WorkbookUndo = {
  history: History<Workbook>;
  /** A copy of the workbook as it is now, to `record` once a change has gone through. */
  snapshot: () => Workbook;
  record: (before: Workbook) => void;
  /** Runs a change and makes it one step to undo when it reports that something changed. */
  track: <T>(run: () => T, changed?: (result: T) => boolean) => T;
  undo: () => boolean;
  redo: () => boolean;
};

/** Undo over whole copies of the workbook, taken before each change. */
export function createWorkbookUndo(wb: Workbook): WorkbookUndo {
  const history = createHistory<Workbook>(
    cellCount(wb) > LARGE_WORKBOOK_CELLS ? LARGE_WORKBOOK_STEPS : HISTORY_LIMIT,
  );
  const move = (step: (now: Workbook) => Workbook | null) => {
    const target = step(structuredClone(wb));
    if (!target) return false;
    restoreWorkbook(wb, target);
    return true;
  };
  return {
    history,
    snapshot: () => structuredClone(wb),
    record: (before) => history.record(before),
    track(run, changed = Boolean) {
      const before = structuredClone(wb);
      const result = run();
      if (changed(result)) history.record(before);
      return result;
    },
    undo: () => move(history.undo),
    redo: () => move(history.redo),
  };
}
