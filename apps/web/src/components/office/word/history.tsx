import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { addedText, DiffCard, NoChanges, removedText, Segments } from "../history/DiffParts";
import type { HistoryFormat } from "../history/format";
import type { WordDiff, WordSnapshot } from "./diff";
import { diffWord, readWordSnapshot } from "./diff";

/** Kept paragraphs shown around each change, so it can be found in the document. */
const CONTEXT = 1;
/** Beyond this many changed paragraphs, the rest are counted, not shown. */
const SHOWN_MAX = 200;

function summary(diff: WordDiff): string {
  const parts: string[] = [];
  if (diff.changed)
    parts.push(plural(diff.changed, { one: "# paragraph edited", other: "# paragraphs edited" }));
  if (diff.added)
    parts.push(plural(diff.added, { one: "# paragraph added", other: "# paragraphs added" }));
  if (diff.removed)
    parts.push(plural(diff.removed, { one: "# paragraph removed", other: "# paragraphs removed" }));
  return parts.length ? parts.join(", ") : t`No text changes`;
}

function WordDiffView({ diff }: { diff: WordDiff }) {
  const { changes } = diff;
  if (diff.added + diff.removed + diff.changed === 0)
    return (
      <NoChanges>
        <Trans>
          The text is the same as in the version before; only formatting or layout changed.
        </Trans>
      </NoChanges>
    );
  const near = new Set<number>();
  changes.forEach((change, index) => {
    if (change.kind === "same") return;
    for (let i = index - CONTEXT; i <= index + CONTEXT; i++) near.add(i);
  });
  let shown = 0;
  const rows: ReactNode[] = [];
  let gap = false;
  changes.forEach((change, index) => {
    if (!near.has(index)) {
      gap = true;
      return;
    }
    if (change.kind !== "same" && ++shown > SHOWN_MAX) return;
    if (gap && rows.length)
      rows.push(
        <div key={`gap-${index}`} className="text-center text-muted-foreground">
          ⋯
        </div>,
      );
    gap = false;
    rows.push(
      change.kind === "same" ? (
        <p key={index} className="text-muted-foreground">
          {change.after}
        </p>
      ) : change.kind === "added" ? (
        <p key={index} className={`${addedText} px-1`} data-diff="added">
          {change.after}
        </p>
      ) : change.kind === "removed" ? (
        <p key={index} className={`${removedText} px-1`} data-diff="removed">
          {change.before}
        </p>
      ) : (
        <p key={index} data-diff="changed">
          <Segments segments={change.segments} />
        </p>
      ),
    );
  });
  const hidden = diff.added + diff.removed + diff.changed - SHOWN_MAX;
  return (
    <DiffCard title={summary(diff)}>
      {rows}
      {hidden > 0 ? (
        <p className="text-muted-foreground">
          {plural(hidden, {
            one: "… and # more changed paragraph",
            other: "… and # more changed paragraphs",
          })}
        </p>
      ) : null}
    </DiffCard>
  );
}

export const wordHistory: HistoryFormat<WordSnapshot, WordDiff> & { id: string } = {
  id: "docx",
  read: readWordSnapshot,
  compare: diffWord,
  summary,
  View: WordDiffView,
};
