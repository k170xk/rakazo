import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { addedText, DiffCard, NoChanges, removedText, Segments } from "../history/DiffParts";
import type { HistoryFormat } from "../history/format";
import type { DeckDiff, DeckSnapshot, SlideSnapshot } from "./diff";
import { diffDeck, readDeckSnapshot } from "./diff";

function summary(diff: DeckDiff): string {
  const edited = diff.changes.filter((c) => c.kind === "changed").length;
  const parts: string[] = [];
  if (edited) parts.push(plural(edited, { one: "# slide edited", other: "# slides edited" }));
  if (diff.added) parts.push(plural(diff.added, { one: "# slide added", other: "# slides added" }));
  if (diff.removed)
    parts.push(plural(diff.removed, { one: "# slide removed", other: "# slides removed" }));
  if (diff.moved) parts.push(plural(diff.moved, { one: "# slide moved", other: "# slides moved" }));
  return parts.length ? parts.join(", ") : t`No text changes`;
}

function slideText(slide: SlideSnapshot): string {
  return [slide.title, ...slide.texts].filter(Boolean).join(" / ") || t`(no text)`;
}

function DeckDiffView({ diff }: { diff: DeckDiff }) {
  if (diff.changes.length === 0)
    return (
      <NoChanges>
        <Trans>
          The slides' text and notes are the same as in the version before; only design or layout
          changed.
        </Trans>
      </NoChanges>
    );
  return (
    <div className="flex flex-col gap-2">
      {diff.changes.map((change, index) => {
        if (change.kind === "added")
          return (
            <DiffCard key={index} title={t`Slide ${change.at + 1} added`}>
              <p className={`${addedText} px-1`}>{slideText(change.slide)}</p>
            </DiffCard>
          );
        if (change.kind === "removed")
          return (
            <DiffCard key={index} title={t`Slide ${change.from + 1} removed`}>
              <p className={`${removedText} px-1`}>{slideText(change.slide)}</p>
            </DiffCard>
          );
        if (change.kind === "moved")
          return (
            <DiffCard
              key={index}
              title={t`Slide ${change.from + 1} moved to position ${change.at + 1}`}
            >
              <p className="text-muted-foreground">{slideText(change.slide)}</p>
            </DiffCard>
          );
        return (
          <DiffCard
            key={index}
            title={
              change.from === change.at
                ? t`Slide ${change.at + 1}`
                : t`Slide ${change.at + 1} (was ${change.from + 1})`
            }
          >
            {change.text ? (
              <p>
                <Segments segments={change.text} />
              </p>
            ) : null}
            {change.notes ? (
              <p>
                <span className="text-muted-foreground">{t`Notes:`} </span>
                <Segments segments={change.notes} />
              </p>
            ) : null}
            {change.hidden ? (
              <p className="text-muted-foreground">
                {change.after.hidden
                  ? t`Hidden in the slide show`
                  : t`Shown in the slide show again`}
              </p>
            ) : null}
          </DiffCard>
        );
      })}
    </div>
  );
}

export const deckHistory: HistoryFormat<DeckSnapshot, DeckDiff> & { id: string } = {
  id: "pptx",
  read: readDeckSnapshot,
  compare: diffDeck,
  summary,
  View: DeckDiffView,
};
