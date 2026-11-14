import type { SequenceChange, WordSegment } from "../history/sequence";
import { diffSequence, wordSegments } from "../history/sequence";

/** A version's body as the history compares it: one entry per paragraph or table row. */
export type WordSnapshot = { paragraphs: string[] };

export type ParagraphChange =
  | Exclude<SequenceChange<string>, { kind: "changed" }>
  | (Extract<SequenceChange<string>, { kind: "changed" }> & { segments: WordSegment[] });

export type WordDiff = {
  changes: ParagraphChange[];
  added: number;
  removed: number;
  changed: number;
};

/** The body text of a .docx, accepted view, without headers, footers or empty paragraphs. */
export async function readWordSnapshot(bytes: Uint8Array): Promise<WordSnapshot> {
  const { extractDocxText } = await import("@stll/folio-core/docx/server/extractDocxText");
  const text = await extractDocxText(bytes);
  return {
    paragraphs: text.paragraphs
      .filter((p) => p.source === "body")
      .map((p) => p.text.replace(/\s+/g, " ").trim())
      .filter((text) => !/^[\s|:-]*$/.test(text)),
  };
}

/** Paragraph by paragraph, with word highlights inside each changed one. */
export function diffWord(before: WordSnapshot | null, after: WordSnapshot): WordDiff {
  const changes: ParagraphChange[] = diffSequence(
    before?.paragraphs ?? [],
    after.paragraphs,
    (p) => p,
  ).map((change) =>
    change.kind === "changed"
      ? { ...change, segments: wordSegments(change.before, change.after) }
      : change,
  );
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const change of changes) {
    if (change.kind === "added") added++;
    else if (change.kind === "removed") removed++;
    else if (change.kind === "changed") changed++;
  }
  return { changes, added, removed, changed };
}
