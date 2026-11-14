/**
 * Undo and redo over whole snapshots of a document. `record` is given the state from before an
 * edit; `undo` is given the state now and hands back the one to restore, and `redo` the reverse.
 * Snapshots are opaque, so the same stack serves a cloned workbook or a saved presentation.
 */
export type History<T> = {
  /** Remembers the state from before an edit, and forgets anything that could be redone. */
  record: (before: T) => void;
  /** The state to go back to, given the state now; null when there is nothing to undo. */
  undo: (now: T) => T | null;
  /** The state to go forward to, given the state now; null when there is nothing to redo. */
  redo: (now: T) => T | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
  /** Called after every change to what can be undone or redone. */
  subscribe: (listener: () => void) => () => void;
};

export const HISTORY_LIMIT = 50;

export function createHistory<T>(limit = HISTORY_LIMIT): History<T> {
  const past: T[] = [];
  const future: T[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    record(before) {
      past.push(before);
      if (past.length > Math.max(1, limit)) past.splice(0, past.length - Math.max(1, limit));
      future.length = 0;
      notify();
    },
    undo(now) {
      const previous = past.pop();
      if (previous === undefined) return null;
      future.push(now);
      notify();
      return previous;
    },
    redo(now) {
      const next = future.pop();
      if (next === undefined) return null;
      past.push(now);
      notify();
      return next;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    clear() {
      if (past.length === 0 && future.length === 0) return;
      past.length = 0;
      future.length = 0;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
