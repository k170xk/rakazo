import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { addedText, DiffCard, NoChanges, removedText } from "../history/DiffParts";
import type { HistoryFormat } from "../history/format";
import type { SheetCellSnapshot, WorkbookDiff, WorkbookSnapshot } from "./diff";
import { diffWorkbook, readWorkbookSnapshot } from "./diff";

function summary(diff: WorkbookDiff): string {
  const sheets = diff.groups.length;
  if (diff.cells === 0 && sheets === 0) return t`No cell changes`;
  const cells = plural(diff.cells, { one: "# cell changed", other: "# cells changed" });
  return sheets > 1
    ? `${cells}, ${plural(sheets, { one: "on # sheet", other: "on # sheets" })}`
    : cells;
}

function CellValue({ cell, className }: { cell: SheetCellSnapshot | null; className: string }) {
  if (!cell) return <span className="text-muted-foreground">{t`(empty)`}</span>;
  return (
    <span className={`${className} px-1`}>
      {cell.formula ? <span className="font-mono">={cell.formula}</span> : cell.value}
      {cell.formula && cell.value ? (
        <span className="text-muted-foreground"> → {cell.value}</span>
      ) : null}
    </span>
  );
}

function WorkbookDiffView({ diff }: { diff: WorkbookDiff }) {
  if (diff.groups.length === 0)
    return (
      <NoChanges>
        <Trans>
          The cells are the same as in the version before; only formatting or layout changed.
        </Trans>
      </NoChanges>
    );
  return (
    <div className="flex flex-col gap-2">
      {diff.groups.map((group) => (
        <DiffCard
          key={group.sheet}
          title={
            group.status === "added"
              ? t`Sheet “${group.sheet}” added`
              : group.status === "removed"
                ? t`Sheet “${group.sheet}” removed`
                : t`Sheet “${group.sheet}”`
          }
        >
          {group.cells.map((cell) => (
            <div key={cell.ref} className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-2">
              <span className="font-mono text-[12px] text-muted-foreground">{cell.ref}</span>
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 break-words">
                {cell.before ? <CellValue cell={cell.before} className={removedText} /> : null}
                {cell.before ? <span className="text-muted-foreground">→</span> : null}
                <CellValue cell={cell.after} className={addedText} />
              </span>
            </div>
          ))}
          {group.total > group.cells.length ? (
            <p className="text-muted-foreground">
              {plural(group.total - group.cells.length, {
                one: "… and # more changed cell",
                other: "… and # more changed cells",
              })}
            </p>
          ) : null}
        </DiffCard>
      ))}
    </div>
  );
}

export const workbookHistory: HistoryFormat<WorkbookSnapshot, WorkbookDiff> & { id: string } = {
  id: "xlsx",
  read: readWorkbookSnapshot,
  compare: diffWorkbook,
  summary,
  View: WorkbookDiffView,
};
