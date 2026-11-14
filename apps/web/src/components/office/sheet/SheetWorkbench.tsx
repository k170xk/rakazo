import { Trans, useLingui } from "@lingui/react/macro";
import { getCell, getMaxCol, getMaxRow } from "@office-kit/xlsx/worksheet";
import { toast } from "@rakazo/ui-web";
import { BarChart3 } from "lucide-react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CellPos, CellRange } from "./address";
import { MAX_COLS, MAX_ROWS, parseRangeRef, qualifiedRef, rangeRef, rangeSize } from "./address";
import { gridlinesShown, sheetZoom } from "./commands";
import { SheetGrid } from "./SheetGrid";
import { SheetRibbon } from "./SheetRibbon";
import type { Selection } from "./selection";
import { cellsIn, moveSelection, ownerCell, selectCell, selectionRange } from "./selection";
import { createWorkbookUndo } from "./undo";
import type { LockReason, SavedExpectation, Workbook } from "./workbook";
import {
  applyInput,
  clearRange,
  FormulaInputError,
  firstSheetTitle,
  freezeCounts,
  gridExtent,
  hasDrawings,
  lockAt,
  lockedRanges,
  mergedRanges,
  parsePastedText,
  rangeText,
  rawInput,
  setColumnPx,
  setFreeze,
  sheetTabs,
  worksheetOf,
} from "./workbook";

/** The most cells one paste or clear re-checks after saving; larger changes still save. */
const CHECKED_CELLS = 2000;
const PASTE_LIMIT = 50_000;

export type SheetView = {
  sheet: string;
  selection: Selection;
  ref: string;
  /** The selected cells, merged cells included. */
  range?: CellRange;
  /** The cells on screen, once the grid has measured itself. */
  visible?: CellRange | null;
};

export type SheetWorkbenchProps = {
  wb: Workbook;
  readOnly: boolean;
  /** Where the person was before the file reloaded. */
  initialView: SheetView | null;
  highlight: { sheet: string; cells: ReadonlySet<string> } | null;
  onEdit: (checks: SavedExpectation[]) => void;
  onView: (view: SheetView) => void;
};

type Editing = { draft: string; where: "cell" | "bar" };

const NO_CELLS: ReadonlySet<string> = new Set();
const ORIGIN = selectCell({ row: 1, col: 1 });

function roundUp(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

/** One workbook on screen: sheet tabs, the formula bar and the grid, editing cell by cell. */
export function SheetWorkbench({
  wb,
  readOnly,
  initialView,
  highlight,
  onEdit,
  onView,
}: SheetWorkbenchProps) {
  const { t } = useLingui();
  const [tick, setTick] = useState(0);
  const tabs = useMemo(() => sheetTabs(wb).filter((tab) => !tab.hidden), [wb, tick]);
  const [sheet, setSheet] = useState(() =>
    initialView && tabs.some((tab) => tab.title === initialView.sheet)
      ? initialView.sheet
      : (firstSheetTitle(wb) ?? ""),
  );
  const [selection, setSelection] = useState<Selection>(() =>
    initialView && initialView.sheet === sheet ? initialView.selection : ORIGIN,
  );
  const [editing, setEditing] = useState<Editing | null>(null);
  const [nameBox, setNameBox] = useState<string | null>(null);
  const draft = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLInputElement>(null);
  const scope = useRef<HTMLDivElement>(null);
  const perSheet = useRef(new Map<string, Selection>());
  const undo = useMemo(() => createWorkbookUndo(wb), [wb]);

  const ws = worksheetOf(wb, sheet);
  const [zoom, setZoom] = useState(() => (ws ? sheetZoom(ws) : 1));
  const bump = () => setTick((n) => n + 1);
  const merges = useMemo(() => (ws ? mergedRanges(ws) : []), [ws, tick]);
  const locked = useMemo(() => (ws ? lockedRanges(ws) : []), [ws]);
  const frozen = useMemo(() => (ws ? freezeCounts(ws) : { rows: 0, cols: 0 }), [ws, tick]);
  const base = useMemo(() => (ws ? gridExtent(ws) : { rows: 1, cols: 1 }), [ws, tick]);
  const range = selectionRange(selection, merges);
  const extent = {
    rows: Math.min(MAX_ROWS, Math.max(base.rows, roundUp(selection.focus.row + 50, 100))),
    cols: Math.min(MAX_COLS, Math.max(base.cols, roundUp(selection.focus.col + 5, 10))),
  };
  const active = ownerCell(merges, selection.anchor);
  const activeCell = ws ? getCell(ws, active.row, active.col) : undefined;
  const activeRaw = rawInput(wb, activeCell);

  const [visible, setVisible] = useState<CellRange | null>(null);
  useEffect(() => {
    onView({ sheet, selection, ref: qualifiedRef(sheet, range), range, visible });
  }, [sheet, selection, onView, visible]);

  const lockText = useCallback(
    (reason: LockReason) =>
      reason === "shared"
        ? t`This cell's formula is shared with other cells, so it can only be changed in a spreadsheet app.`
        : reason === "array"
          ? t`This cell is part of an array formula, so it can only be changed in a spreadsheet app.`
          : t`Table headers can only be renamed in a spreadsheet app.`,
    [t],
  );

  function check(pos: CellPos): SavedExpectation {
    const cell = ws ? getCell(ws, pos.row, pos.col) : undefined;
    return { sheet, pos, raw: rawInput(wb, cell) };
  }

  function focusGrid() {
    gridRef.current?.focus({ preventScroll: true });
  }

  function startEdit(initial: string | null, where: Editing["where"] = "cell") {
    if (readOnly || !ws) return;
    const reason = lockAt(locked, active);
    if (reason) {
      toast(lockText(reason));
      return;
    }
    const text = initial ?? activeRaw;
    draft.current = text;
    setEditing({ draft: text, where });
  }

  function setDraft(text: string) {
    draft.current = text;
    setEditing((prev) => (prev ? { ...prev, draft: text } : prev));
  }

  function cancel() {
    draft.current = null;
    setEditing(null);
    focusGrid();
  }

  /** Stores the typed text in the active cell, then moves like Enter or Tab would. */
  function commit(dRow: number, dCol: number, refocus = true) {
    const text = draft.current;
    if (text === null || !ws) return;
    try {
      if (undo.track(() => applyInput(wb, ws, active, text))) {
        onEdit([check(active)]);
        bump();
      }
    } catch (error) {
      if (!(error instanceof FormulaInputError)) throw error;
      toast.error(t`That formula couldn't be read. Check it and try again.`);
      if (refocus) return;
    }
    draft.current = null;
    setEditing(null);
    if (dRow || dCol) setSelection(moveSelection(selectCell(active), dRow, dCol, false, merges));
    if (refocus) focusGrid();
  }

  function choose(next: Selection) {
    if (draft.current !== null) commit(0, 0, false);
    setSelection(next);
  }

  function chooseRange(next: CellRange) {
    choose({
      anchor: { row: next.top, col: next.left },
      focus: { row: next.bottom, col: next.right },
    });
  }

  function switchSheet(title: string) {
    if (title === sheet) return;
    if (draft.current !== null) commit(0, 0, false);
    perSheet.current.set(sheet, selection);
    setSheet(title);
    setSelection(perSheet.current.get(title) ?? ORIGIN);
  }

  function clear() {
    if (readOnly || !ws) return;
    if (!undo.track(() => clearRange(ws, range, locked) > 0)) return;
    onEdit(rangeSize(range) <= CHECKED_CELLS ? [...cellsIn(range)].map(check) : []);
    bump();
  }

  function copy(cut: boolean) {
    if (!ws) return;
    void navigator.clipboard?.writeText(rangeText(wb, ws, range)).catch(() => {
      toast.error(t`Couldn't copy those cells.`);
    });
    if (cut) clear();
  }

  function paste(event: ClipboardEvent<HTMLDivElement>) {
    if (editing || readOnly || !ws) return;
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    const rows = parsePastedText(text);
    const before = undo.snapshot();
    const checks: SavedExpectation[] = [];
    let changed = 0;
    let skipped = 0;
    let count = 0;
    const start = { row: range.top, col: range.left };
    let right = start.col;
    rows.forEach((values, dRow) => {
      values.forEach((value, dCol) => {
        const pos = { row: start.row + dRow, col: start.col + dCol };
        if (pos.row > MAX_ROWS || pos.col > MAX_COLS || count >= PASTE_LIMIT) return;
        count += 1;
        right = Math.max(right, pos.col);
        if (lockAt(locked, pos)) {
          skipped += 1;
          return;
        }
        try {
          if (applyInput(wb, ws, pos, value)) {
            changed += 1;
            if (checks.length < CHECKED_CELLS) checks.push(check(pos));
          }
        } catch {
          skipped += 1;
        }
      });
    });
    if (skipped) toast(t`Some cells couldn't be pasted into and were left as they were.`);
    if (!changed) return;
    undo.record(before);
    onEdit(checks);
    bump();
    setSelection({
      anchor: start,
      focus: { row: Math.min(MAX_ROWS, start.row + rows.length - 1), col: right },
    });
  }

  function onGridKey(event: KeyboardEvent<HTMLDivElement>, pageRows: number) {
    if (event.target !== gridRef.current || !ws) return;
    const mod = event.metaKey || event.ctrlKey;
    const shift = event.shiftKey;
    const key = event.key;
    const step = (dRow: number, dCol: number) => {
      event.preventDefault();
      setSelection(
        shift
          ? moveSelection(selection, dRow, dCol, true, merges)
          : moveSelection(selectCell(active), dRow, dCol, false, merges),
      );
    };
    const jump = (pos: CellPos) => {
      event.preventDefault();
      setSelection(shift ? { anchor: selection.anchor, focus: pos } : selectCell(pos));
    };
    const from = shift ? selection.focus : active;
    switch (key) {
      case "ArrowUp":
        return mod ? jump({ row: 1, col: from.col }) : step(-1, 0);
      case "ArrowDown":
        return mod ? jump({ row: Math.max(1, getMaxRow(ws)), col: from.col }) : step(1, 0);
      case "ArrowLeft":
        return mod ? jump({ row: from.row, col: 1 }) : step(0, -1);
      case "ArrowRight":
        return mod ? jump({ row: from.row, col: Math.max(1, getMaxCol(ws)) }) : step(0, 1);
      case "PageDown":
        return step(pageRows, 0);
      case "PageUp":
        return step(-pageRows, 0);
      case "Home":
        return jump(mod ? { row: 1, col: 1 } : { row: from.row, col: 1 });
      case "Enter":
        event.preventDefault();
        setSelection(moveSelection(selectCell(active), shift ? -1 : 1, 0, false, merges));
        return;
      case "Tab":
        event.preventDefault();
        setSelection(moveSelection(selectCell(active), 0, shift ? -1 : 1, false, merges));
        return;
      case "F2":
        event.preventDefault();
        startEdit(null);
        return;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        clear();
        return;
    }
    if (mod && !event.altKey) {
      const letter = key.toLowerCase();
      if (letter === "c" || letter === "x") {
        event.preventDefault();
        copy(letter === "x");
      } else if (letter === "a") {
        event.preventDefault();
        setSelection({ anchor: { row: 1, col: 1 }, focus: { row: extent.rows, col: extent.cols } });
      }
      return;
    }
    if (key.length === 1 && !event.altKey && !readOnly) {
      event.preventDefault();
      startEdit(key);
    }
  }

  function onEditorKey(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      commit(event.shiftKey ? -1 : 1, 0);
    } else if (event.key === "Tab") {
      event.preventDefault();
      commit(0, event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  }

  function resizeColumn(col: number, px: number) {
    if (readOnly || !ws) return;
    undo.track(() => {
      setColumnPx(ws, col, px);
      return true;
    });
    onEdit([]);
    bump();
  }

  function freeze(rows: number, cols: number) {
    if (readOnly || !ws) return;
    undo.track(() => {
      setFreeze(ws, rows, cols);
      return true;
    });
    onEdit([]);
    bump();
  }

  /** After sheets were added, renamed or removed, keeps a sheet that still exists in view. */
  function keepSheet() {
    if (!sheetTabs(wb).some((tab) => tab.title === sheet && !tab.hidden)) {
      setSheet(firstSheetTitle(wb) ?? "");
      setSelection(ORIGIN);
    }
  }

  function change(run: () => boolean) {
    if (readOnly) return;
    if (draft.current !== null) commit(0, 0, false);
    if (!undo.track(run)) return;
    keepSheet();
    onEdit([]);
    bump();
  }

  function step(back: boolean) {
    if (readOnly) return;
    if (draft.current !== null) {
      draft.current = null;
      setEditing(null);
    }
    if (!(back ? undo.undo() : undo.redo())) return;
    keepSheet();
    onEdit([]);
    bump();
  }

  /** Opens the formula bar on the active cell with `text` in it, ready to finish typing. */
  function openFormula(text: string) {
    if (readOnly || !ws) return;
    draft.current = null;
    setEditing(null);
    startEdit(text, "bar");
    requestAnimationFrame(() => {
      const bar = barRef.current;
      bar?.focus();
      bar?.setSelectionRange(text.length, text.length);
    });
  }

  function goTo(text: string) {
    const target = parseRangeRef(text);
    setNameBox(null);
    if (!target) {
      toast(t`Type a cell like B2 or a range like B2:D9.`);
      return;
    }
    chooseRange(target);
    focusGrid();
  }

  const formula = activeRaw.startsWith("=");
  const cellEditor =
    editing?.where === "cell"
      ? {
          draft: editing.draft,
          onDraft: setDraft,
          onKeyDown: onEditorKey,
          onBlur: () => commit(0, 0, false),
        }
      : null;

  return (
    <div ref={scope} className="flex size-full min-h-0 flex-col" data-testid="sheet-workbench">
      <SheetRibbon
        scope={scope}
        wb={wb}
        ws={ws}
        sheet={sheet}
        range={range}
        active={active}
        readOnly={readOnly}
        canUndo={undo.history.canUndo()}
        canRedo={undo.history.canRedo()}
        onUndo={() => step(true)}
        onRedo={() => step(false)}
        onChange={change}
        onFormula={openFormula}
        formulaText={editing ? editing.draft : activeRaw}
        onSwitchSheet={switchSheet}
        frozen={frozen}
        onFreeze={freeze}
        zoom={zoom}
        onZoom={setZoom}
      />
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
        <input
          aria-label={t`Cell or range`}
          data-testid="sheet-name-box"
          className="h-8 w-[84px] shrink-0 rounded-md border border-border bg-background px-2 font-mono text-[12px] outline-none focus:border-primary sm:w-[110px]"
          value={nameBox ?? rangeRef(range)}
          onChange={(event) => setNameBox(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => setNameBox(null)}
          onKeyDown={(event) => {
            if (event.key === "Enter") goTo(event.currentTarget.value);
            if (event.key === "Escape") {
              setNameBox(null);
              focusGrid();
            }
          }}
        />
        <span
          className="shrink-0 px-1 font-serif text-[13px] italic text-muted-foreground"
          aria-hidden="true"
        >
          fx
        </span>
        <input
          ref={barRef}
          aria-label={t`Cell contents`}
          data-testid="sheet-formula-bar"
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-[13px] outline-none focus:border-primary read-only:bg-muted/50"
          readOnly={readOnly || !ws}
          value={editing ? editing.draft : activeRaw}
          onFocus={() => {
            if (!editing) startEdit(null, "bar");
          }}
          onChange={(event) => {
            if (draft.current === null) startEdit(event.target.value, "bar");
            else setDraft(event.target.value);
          }}
          onBlur={() => {
            if (editing?.where === "bar") commit(0, 0, false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit(1, 0);
            } else if (event.key === "Tab") {
              event.preventDefault();
              commit(0, event.shiftKey ? -1 : 1);
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
        />
      </div>
      {formula ? (
        <p
          className="shrink-0 border-b border-border bg-muted/40 px-3 py-1 text-[12px] text-muted-foreground"
          data-testid="sheet-formula-hint"
        >
          <Trans>Formula results update when the file is opened in a spreadsheet app.</Trans>
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        {ws ? (
          <SheetGrid
            key={sheet}
            wb={wb}
            ws={ws}
            tick={tick}
            extent={extent}
            frozen={frozen}
            merges={merges}
            selection={selection}
            range={range}
            highlight={highlight?.sheet === sheet ? highlight.cells : NO_CELLS}
            editor={cellEditor}
            readOnly={readOnly}
            label={t`Sheet ${sheet}`}
            gridRef={gridRef}
            onSelect={(next, extend) => choose(extend ? next : selectCell(next.focus))}
            onSelectRange={chooseRange}
            onActivate={() => startEdit(null)}
            onKeyDown={onGridKey}
            onPaste={paste}
            onResizeColumn={resizeColumn}
            onVisible={setVisible}
            zoom={zoom}
            gridlines={gridlinesShown(ws)}
          />
        ) : (
          <div className="grid size-full place-items-center p-6 text-center">
            <p className="flex max-w-sm flex-col items-center gap-2 text-[14px] text-muted-foreground">
              <BarChart3 className="size-6" strokeWidth={1.6} aria-hidden="true" />
              <Trans>This sheet holds a chart. Download the file to see it.</Trans>
            </p>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-border bg-muted/40">
        <div className="flex min-w-0 flex-1 overflow-x-auto" role="tablist" aria-label={t`Sheets`}>
          {tabs.map((tab) => (
            <button
              key={tab.title}
              type="button"
              role="tab"
              aria-selected={tab.title === sheet}
              data-testid="sheet-tab"
              onClick={() => switchSheet(tab.title)}
              className={`flex h-9 shrink-0 items-center gap-1.5 border-r border-border px-3 text-[13px] ${
                tab.title === sheet
                  ? "bg-background font-medium text-foreground"
                  : "text-muted-foreground hover:bg-foreground/[0.04]"
              }`}
            >
              {tab.kind === "chartsheet" ? (
                <BarChart3 className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
              ) : null}
              {tab.title}
            </button>
          ))}
        </div>
        {ws && hasDrawings(ws) ? (
          <span className="shrink-0 truncate pr-3 text-[12px] text-muted-foreground max-sm:hidden">
            <Trans>Charts and pictures on this sheet are kept but not shown here.</Trans>
          </span>
        ) : null}
      </div>
    </div>
  );
}
