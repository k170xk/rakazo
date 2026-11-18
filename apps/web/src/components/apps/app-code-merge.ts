export type AppFiles = Record<string, string>;

/**
 * This person's edits carried onto a newer version someone else saved (the AI, usually): a file
 * only they changed keeps their text, a file only the other side changed takes the newer text,
 * and a file both changed differently is a conflict, kept as theirs for now.
 */
export function mergeAppFiles(
  base: AppFiles,
  mine: AppFiles,
  newer: AppFiles,
): { files: AppFiles; conflicts: string[] } {
  const files: AppFiles = {};
  const conflicts: string[] = [];
  const names = new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(newer)]);
  for (const name of names) {
    const was = base[name];
    const ours = mine[name];
    const theirs = newer[name];
    let pick: string | undefined;
    if (ours === was) pick = theirs;
    else if (theirs === was || theirs === ours) pick = ours;
    else {
      conflicts.push(name);
      pick = theirs;
    }
    if (pick !== undefined) files[name] = pick;
  }
  return { files, conflicts: conflicts.sort() };
}
