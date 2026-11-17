import type { DocumentVersion } from "@rakazo/contracts";

/** Pointer the office studios keep for the version on screen (and the save queue's base). */
export type StudioLatest = {
  artifactId: string;
  version: number;
  name: string;
  versions: DocumentVersion[];
};

type LoadedDetail = {
  latest: { artifactId: string; version: number };
  name: string;
  versions: DocumentVersion[];
};

/**
 * Advance the studio's version pointer only when this load is still the current one. Call after a
 * successful parse/open (Excel/PowerPoint) or after bytes are ready to show (Word) — never before
 * `stillCurrent` — so an aborted download while flicking chat↔studio cannot leave the pointer
 * ahead of what the editor shows.
 */
export function adoptLoadedVersion(
  latest: { current: StudioLatest | null },
  turn: number,
  stillCurrent: (turn: number) => boolean,
  detail: LoadedDetail,
): StudioLatest | null {
  if (!stillCurrent(turn)) return null;
  const next: StudioLatest = {
    artifactId: detail.latest.artifactId,
    version: detail.latest.version,
    name: detail.name,
    versions: detail.versions,
  };
  latest.current = next;
  return next;
}
