import type { ComponentType } from "react";

/** How one file type is read and compared for the version history. */
export type HistoryFormat<S, D> = {
  /** Reads what is compared from a version's bytes. */
  read: (bytes: Uint8Array) => Promise<S>;
  /** What `after` changed against `before`; `before` is null for the first version. */
  compare: (before: S | null, after: S) => D;
  /** A short line such as "3 paragraphs changed", in the person's language. */
  summary: (diff: D) => string;
  /** The changes in full. */
  View: ComponentType<{ diff: D }>;
};

const SNAPSHOTS_KEPT = 12;

/**
 * Parsed versions, newest use last. Versions never change once saved, so a version read once is
 * reused until a few newer ones push it out.
 */
export function createSnapshotCache<S>() {
  const kept = new Map<string, Promise<S>>();
  return (artifactId: string, load: () => Promise<S>): Promise<S> => {
    const hit = kept.get(artifactId);
    if (hit) {
      kept.delete(artifactId);
      kept.set(artifactId, hit);
      return hit;
    }
    const next = load();
    kept.set(artifactId, next);
    next.catch(() => kept.delete(artifactId));
    while (kept.size > SNAPSHOTS_KEPT) {
      const oldest = kept.keys().next().value;
      if (oldest === undefined) break;
      kept.delete(oldest);
    }
    return next;
  };
}
