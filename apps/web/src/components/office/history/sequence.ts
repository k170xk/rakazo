import { diffLines } from "../../../lib/line-diff";

/** One item of a before/after comparison; a removed item followed by an added one is "changed". */
export type SequenceChange<T> =
  | { kind: "same"; before: T; after: T; beforeIndex: number; afterIndex: number }
  | { kind: "added"; after: T; afterIndex: number }
  | { kind: "removed"; before: T; beforeIndex: number }
  | { kind: "changed"; before: T; after: T; beforeIndex: number; afterIndex: number };

/** A run of words, kept, added or removed. */
export type WordSegment = { kind: "same" | "added" | "removed"; text: string };

function keyed(keys: readonly string[]): string {
  return keys.map((key) => `${key.replace(/\n/g, " ")}\n`).join("");
}

/**
 * The two lists lined up by `key`: kept items, and the items added or removed between them.
 * Removals right before additions are paired up as changes, so an edited paragraph reads as one.
 */
export function diffSequence<T>(
  before: readonly T[],
  after: readonly T[],
  key: (item: T) => string,
  { pair = true }: { pair?: boolean } = {},
): SequenceChange<T>[] {
  const { lines } = diffLines(keyed(before.map(key)), keyed(after.map(key)));
  const out: SequenceChange<T>[] = [];
  let removed: { item: T; index: number }[] = [];
  let added: { item: T; index: number }[] = [];
  const flush = () => {
    const pairs = pair ? Math.min(removed.length, added.length) : 0;
    for (let i = 0; i < pairs; i++) {
      out.push({
        kind: "changed",
        before: removed[i]!.item,
        after: added[i]!.item,
        beforeIndex: removed[i]!.index,
        afterIndex: added[i]!.index,
      });
    }
    for (const r of removed.slice(pairs))
      out.push({ kind: "removed", before: r.item, beforeIndex: r.index });
    for (const a of added.slice(pairs))
      out.push({ kind: "added", after: a.item, afterIndex: a.index });
    removed = [];
    added = [];
  };
  for (const line of lines) {
    if (line.kind === "removed") {
      removed.push({ item: before[line.oldLine - 1]!, index: line.oldLine - 1 });
    } else if (line.kind === "added") {
      added.push({ item: after[line.newLine - 1]!, index: line.newLine - 1 });
    } else {
      flush();
      out.push({
        kind: "same",
        before: before[line.oldLine - 1]!,
        after: after[line.newLine - 1]!,
        beforeIndex: line.oldLine - 1,
        afterIndex: line.newLine - 1,
      });
    }
  }
  flush();
  return out;
}

/** Word-level highlights between two versions of one text. */
export function wordSegments(before: string, after: string): WordSegment[] {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  const out: WordSegment[] = [];
  const push = (kind: WordSegment["kind"], text: string) => {
    const last = out.at(-1);
    if (last?.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  for (const change of diffSequence(a, b, (word) => word)) {
    if (change.kind === "same") push("same", change.after);
    else if (change.kind === "added") push("added", change.after);
    else if (change.kind === "removed") push("removed", change.before);
    else {
      push("removed", change.before);
      push("added", change.after);
    }
  }
  return out;
}
