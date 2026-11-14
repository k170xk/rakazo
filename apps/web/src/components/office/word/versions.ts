import type { DocumentVersion } from "@rakazo/contracts";

/** Who made a version as the history shows it; `unknown` for versions saved before this was kept. */
export type VersionAuthor = "assistant" | "you" | "unknown";

export type VersionRow = {
  artifactId: string;
  version: number;
  createdAt: string;
  size: number;
  author: VersionAuthor;
  /** The newest version, which restore never offers. */
  latest: boolean;
  /** The version open in the studio. */
  open: boolean;
};

/** The history list: newest first, one row per version number. */
export function versionRows(
  versions: readonly DocumentVersion[],
  openVersion: number | null,
): VersionRow[] {
  const seen = new Set<number>();
  const rows = [...versions]
    .sort((a, b) => b.version - a.version || b.createdAt.localeCompare(a.createdAt))
    .filter((row) => {
      if (seen.has(row.version)) return false;
      seen.add(row.version);
      return true;
    });
  const newest = rows[0]?.version;
  return rows.map((row) => ({
    artifactId: row.artifactId,
    version: row.version,
    createdAt: row.createdAt,
    size: row.size,
    author: row.source === "assistant" ? "assistant" : row.source === "studio" ? "you" : "unknown",
    latest: row.version === newest,
    open: row.version === openVersion,
  }));
}

/** The family with a version saved here added, so history shows it before the next reload. */
export function withSavedVersion(
  versions: readonly DocumentVersion[],
  saved: { artifactId: string; version: number; size: number; createdAt: string },
): DocumentVersion[] {
  if (versions.some((row) => row.artifactId === saved.artifactId)) return [...versions];
  return [{ ...saved, source: "studio" }, ...versions];
}
