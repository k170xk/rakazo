import { getCell } from "@office-kit/xlsx/worksheet";
import type {
  CSSProperties,
  KeyboardEvent,
  ClipboardEvent as ReactClipboardEvent,
  ReactNode,
} from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CellPos, CellRange } from "./address";
import { cellRef, columnLetters, rangesOverlap } from "./address";
import type { Axis } from "./geometry";
import { buildAxis, indexAt, scrollToShow, sizeOf, span, startOf } from "./geometry";
import type { Selection } from "./selection";
import { mergeAt } from "./selection";
import type { Workbook, Worksheet } from "./workbook";
import { cellView, columnPx, rowPx, styleCache } from "./workbook";

const HEADER_W = 46;
const HEADER_H = 24;
const MIN_COLUMN_PX = 16;

export type GridEditor = {
  draft: string;
  onDraft: (text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
};

export type SheetGridProps = {
  wb: Workbook;
  ws: Worksheet;
  /** Bumped after every change to the sheet, so the grid draws it again. */
  tick: number;
  extent: { rows: number; cols: number };
  frozen: { rows: number; cols: number };
  merges: readonly CellRange[];
  selection: Selection;
  range: CellRange;
  /** Cells that changed in the version that just arrived, by A1 address. */
  highlight: ReadonlySet<string>;
  editor: GridEditor | null;
  readOnly: boolean;
  label: string;
  gridRef: React.RefObject<HTMLDivElement | null>;
  onSelect: (selection: Selection, extend: boolean) => void;
  onSelectRange: (range: CellRange) => void;
  onActivate: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, pageRows: number) => void;
  onPaste: (event: ReactClipboardEvent<HTMLDivElement>) => void;
  onResizeColumn: (col: number, px: number) => void;
  /** The cells on screen changed. */
  onVisible?: (range: CellRange) => void;
  /** Size of the cells, 1 being 100%; the headers keep their size. */
  zoom?: number;
  gridlines?: boolean;
};

type Pane = {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
  rows: { first: number; last: number };
  cols: { first: number; last: number };
  originX: number;
  originY: number;
};

function rect(cols: Axis, rows: Axis, range: CellRange, pane: Pane) {
  const left = startOf(cols, range.left) - pane.originX;
  const top = startOf(rows, range.top) - pane.originY;
  return {
    left,
    top,
    width: startOf(cols, range.right) + sizeOf(cols, range.right) - startOf(cols, range.left),
    height: startOf(rows, range.bottom) + sizeOf(rows, range.bottom) - startOf(rows, range.top),
  };
}

/**
 * The sheet as a grid that only draws what is on screen. Everything sits in one layer that stays
 * put while the scroll area moves beneath it, so frozen rows, frozen columns and the headers are
 * just panes drawn at a fixed place.
 */
export function SheetGrid(props: SheetGridProps) {
  const { wb, ws, tick, extent, frozen, merges, selection, range, editor, readOnly } = props;
  const scroller = props.gridRef;
  const [view, setView] = useState({ width: 0, height: 0, left: 0, top: 0 });
  const [resizing, setResizing] = useState<{ col: number; px: number } | null>(null);
  const drag = useRef<{
    pointerId: number;
    kind: "mouse" | "touch";
    x: number;
    y: number;
  } | null>(null);
  const frame = useRef(0);

  const zoom = props.zoom ?? 1;
  const styleOf = useMemo(() => styleCache(wb), [wb, tick]);
  const cols = useMemo(
    () =>
      buildAxis(extent.cols, (col) =>
        resizing?.col === col ? resizing.px : Math.round(columnPx(ws, col) * zoom),
      ),
    [ws, extent.cols, resizing, tick, zoom],
  );
  const rows = useMemo(
    () => buildAxis(extent.rows, (row) => Math.round(rowPx(ws, row) * zoom)),
    [ws, extent.rows, tick, zoom],
  );

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const measure = () =>
      setView((prev) => ({ ...prev, width: node.clientWidth, height: node.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [scroller]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const frozenRows = Math.min(frozen.rows, extent.rows);
  const frozenCols = Math.min(frozen.cols, extent.cols);
  const frozenH = startOf(rows, frozenRows + 1);
  const frozenW = startOf(cols, frozenCols + 1);
  const bodyW = Math.max(0, view.width - HEADER_W);
  const bodyH = Math.max(0, view.height - HEADER_H);

  // Keeps the cell being moved to in view.
  const focus = selection.focus;
  useEffect(() => {
    const node = scroller.current;
    if (!node || bodyW === 0) return;
    const left = scrollToShow(cols, focus.col, node.scrollLeft, frozenW, bodyW);
    const top = scrollToShow(rows, focus.row, node.scrollTop, frozenH, bodyH);
    if (left !== node.scrollLeft) node.scrollLeft = left;
    if (top !== node.scrollTop) node.scrollTop = top;
  }, [focus, cols, rows, frozenW, frozenH, bodyW, bodyH, scroller]);

  function onScroll() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const node = scroller.current;
      if (!node) return;
      setView((prev) =>
        prev.left === node.scrollLeft && prev.top === node.scrollTop
          ? prev
          : { ...prev, left: node.scrollLeft, top: node.scrollTop },
      );
    });
  }

  const bodyRows = span(rows, frozenH + view.top, view.top + bodyH, frozenRows + 1);
  const bodyCols = span(cols, frozenW + view.left, view.left + bodyW, frozenCols + 1);
  const topRows = { first: 1, last: frozenRows };
  const leftCols = { first: 1, last: frozenCols };

  // What is on screen, frozen rows and columns included, for the studio note.
  const onVisible = props.onVisible;
  const visibleTop = frozenRows > 0 ? 1 : bodyRows.first;
  const visibleLeft = frozenCols > 0 ? 1 : bodyCols.first;
  useEffect(() => {
    if (!onVisible || bodyW === 0 || bodyRows.last < visibleTop || bodyCols.last < visibleLeft)
      return;
    onVisible({ top: visibleTop, left: visibleLeft, bottom: bodyRows.last, right: bodyCols.last });
  }, [onVisible, bodyW, visibleTop, visibleLeft, bodyRows.last, bodyCols.last]);

  const scrollX = frozenW + view.left;
  const scrollY = frozenH + view.top;

  const panes: Pane[] = [
    {
      key: "body",
      left: HEADER_W + frozenW,
      top: HEADER_H + frozenH,
      width: Math.max(0, bodyW - frozenW),
      height: Math.max(0, bodyH - frozenH),
      rows: bodyRows,
      cols: bodyCols,
      originX: scrollX,
      originY: scrollY,
    },
    {
      key: "top",
      left: HEADER_W + frozenW,
      top: HEADER_H,
      width: Math.max(0, bodyW - frozenW),
      height: frozenH,
      rows: topRows,
      cols: bodyCols,
      originX: scrollX,
      originY: 0,
    },
    {
      key: "left",
      left: HEADER_W,
      top: HEADER_H + frozenH,
      width: frozenW,
      height: Math.max(0, bodyH - frozenH),
      rows: bodyRows,
      cols: leftCols,
      originX: 0,
      originY: scrollY,
    },
    {
      key: "corner",
      left: HEADER_W,
      top: HEADER_H,
      width: frozenW,
      height: frozenH,
      rows: topRows,
      cols: leftCols,
      originX: 0,
      originY: 0,
    },
  ];

  const active = mergeAt(merges, selection.anchor) ?? {
    top: selection.anchor.row,
    left: selection.anchor.col,
    bottom: selection.anchor.row,
    right: selection.anchor.col,
  };

  function renderPane(pane: Pane): ReactNode {
    if (pane.width <= 0 || pane.height <= 0) return null;
    if (pane.rows.last < pane.rows.first || pane.cols.last < pane.cols.first) return null;
    const visible = {
      top: pane.rows.first,
      left: pane.cols.first,
      bottom: pane.rows.last,
      right: pane.cols.last,
    };
    const blocks = merges.filter((merge) => rangesOverlap(merge, visible));
    const covered = (pos: CellPos) =>
      blocks.some(
        (m) => pos.row >= m.top && pos.row <= m.bottom && pos.col >= m.left && pos.col <= m.right,
      );
    const cells: ReactNode[] = [];
    const draw = (pos: CellPos, box: ReturnType<typeof rect>, key: string) => {
      const cell = getCell(ws, pos.row, pos.col);
      const shown = cell ? cellView(wb, cell) : null;
      const style: CSSProperties = {
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        lineHeight: `${Math.max(box.height - 1, 0)}px`,
        ...(zoom !== 1 ? { fontSize: `${13 * zoom}px` } : null),
        ...(cell ? styleOf(cell) : null),
      };
      if (shown?.numeric && !style.textAlign) style.textAlign = "right";
      const ref = cellRef(pos);
      cells.push(
        <div
          key={key}
          className={`absolute overflow-hidden whitespace-nowrap border-r border-b px-1 text-[13px] text-foreground ${
            props.gridlines === false ? "border-transparent" : "border-border/70"
          } ${props.highlight.has(ref) ? "bg-primary/15" : ""}`}
          style={style}
        >
          {shown?.text}
        </div>,
      );
    };
    for (let row = pane.rows.first; row <= pane.rows.last; row += 1) {
      if (sizeOf(rows, row) === 0) continue;
      for (let col = pane.cols.first; col <= pane.cols.last; col += 1) {
        if (sizeOf(cols, col) === 0) continue;
        const pos = { row, col };
        if (blocks.length > 0 && covered(pos)) continue;
        draw(
          pos,
          rect(cols, rows, { top: row, left: col, bottom: row, right: col }, pane),
          `${row}:${col}`,
        );
      }
    }
    for (const merge of blocks) {
      draw(
        { row: merge.top, col: merge.left },
        rect(cols, rows, merge, pane),
        `m${merge.top}:${merge.left}`,
      );
    }
    const chosen = rect(cols, rows, range, pane);
    const cursor = rect(cols, rows, active, pane);
    const showEditor =
      editor &&
      active.top >= visible.top &&
      active.top <= visible.bottom &&
      active.left >= visible.left &&
      active.left <= visible.right;
    return (
      <div
        key={pane.key}
        className="absolute overflow-hidden bg-background"
        style={{ left: pane.left, top: pane.top, width: pane.width, height: pane.height }}
      >
        {cells}
        {rangesOverlap(range, visible) ? (
          <div
            className="pointer-events-none absolute border border-primary bg-primary/10"
            style={chosen}
          />
        ) : null}
        <div
          className="pointer-events-none absolute border-2 border-primary"
          style={{
            ...cursor,
            left: cursor.left - 1,
            top: cursor.top - 1,
            width: cursor.width + 1,
            height: cursor.height + 1,
          }}
        />
        {showEditor ? (
          <input
            aria-label={props.label}
            className="absolute z-10 select-text border-2 border-primary bg-background px-1 text-[13px] text-foreground outline-none"
            style={{
              left: cursor.left - 1,
              top: cursor.top - 1,
              minWidth: cursor.width + 1,
              width: Math.max(cursor.width + 1, Math.min(editor.draft.length * 8 + 16, 480)),
              height: cursor.height + 1,
              ...(zoom !== 1 ? { fontSize: `${13 * zoom}px` } : null),
            }}
            // biome-ignore lint/a11y/noAutofocus: the editor opens because the person asked to type.
            autoFocus
            value={editor.draft}
            onChange={(event) => editor.onDraft(event.target.value)}
            onKeyDown={editor.onKeyDown}
            onBlur={editor.onBlur}
            onPointerDown={(event) => event.stopPropagation()}
          />
        ) : null}
      </div>
    );
  }

  function columnHeader(
    pane: { first: number; last: number },
    originX: number,
    left: number,
    width: number,
    key: string,
  ) {
    if (width <= 0 || pane.last < pane.first) return null;
    const items: ReactNode[] = [];
    for (let col = pane.first; col <= pane.last; col += 1) {
      const px = sizeOf(cols, col);
      if (px === 0) continue;
      const chosen = col >= range.left && col <= range.right;
      items.push(
        <div
          key={col}
          className={`absolute top-0 flex select-none items-center justify-center border-r border-b border-border text-[11px] ${
            chosen
              ? "bg-primary/15 font-semibold text-foreground"
              : "bg-muted text-muted-foreground"
          }`}
          style={{ left: startOf(cols, col) - originX, width: px, height: HEADER_H }}
          data-col={col}
        >
          {columnLetters(col)}
          {readOnly ? null : (
            <span
              aria-hidden="true"
              className="absolute top-0 -right-[4px] z-10 h-full w-[8px] cursor-col-resize touch-none"
              onPointerDown={(event) => startResize(event, col)}
            />
          )}
        </div>,
      );
    }
    return (
      <div
        key={key}
        className="absolute top-0 overflow-hidden"
        style={{ left, width, height: HEADER_H }}
      >
        {items}
      </div>
    );
  }

  function rowHeader(
    pane: { first: number; last: number },
    originY: number,
    top: number,
    height: number,
    key: string,
  ) {
    if (height <= 0 || pane.last < pane.first) return null;
    const items: ReactNode[] = [];
    for (let row = pane.first; row <= pane.last; row += 1) {
      const px = sizeOf(rows, row);
      if (px === 0) continue;
      const chosen = row >= range.top && row <= range.bottom;
      items.push(
        <div
          key={row}
          className={`absolute left-0 flex select-none items-center justify-center border-r border-b border-border text-[11px] ${
            chosen
              ? "bg-primary/15 font-semibold text-foreground"
              : "bg-muted text-muted-foreground"
          }`}
          style={{ top: startOf(rows, row) - originY, height: px, width: HEADER_W }}
        >
          {row}
        </div>,
      );
    }
    return (
      <div
        key={key}
        className="absolute left-0 overflow-hidden"
        style={{ top, height, width: HEADER_W }}
      >
        {items}
      </div>
    );
  }

  function startResize(event: React.PointerEvent<HTMLSpanElement>, col: number) {
    event.stopPropagation();
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startPx = sizeOf(cols, col);
    let px = startPx;
    const move = (next: PointerEvent) => {
      px = Math.max(MIN_COLUMN_PX, Math.round(startPx + next.clientX - startX));
      setResizing({ col, px });
    };
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      setResizing(null);
      if (px !== startPx) props.onResizeColumn(col, Math.round(px / zoom));
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  }

  /** What is under a point of the grid: a cell, a row or column header, or the corner. */
  function hit(clientX: number, clientY: number) {
    const node = scroller.current;
    if (!node) return null;
    const box = node.getBoundingClientRect();
    const x = clientX - box.left;
    const y = clientY - box.top;
    if (x > view.width || y > view.height) return null;
    const sx = x - HEADER_W;
    const sy = y - HEADER_H;
    const col = indexAt(cols, sx < frozenW ? sx : sx + node.scrollLeft);
    const row = indexAt(rows, sy < frozenH ? sy : sy + node.scrollTop);
    if (sx < 0 && sy < 0) return { kind: "corner" as const };
    if (sy < 0) return { kind: "column" as const, col };
    if (sx < 0) return { kind: "row" as const, row };
    return { kind: "cell" as const, pos: { row, col } };
  }

  function select(target: NonNullable<ReturnType<typeof hit>>, extend: boolean) {
    if (target.kind === "cell") {
      props.onSelect({ anchor: selection.anchor, focus: target.pos }, extend);
    } else if (target.kind === "column") {
      props.onSelectRange({ top: 1, bottom: extent.rows, left: target.col, right: target.col });
    } else if (target.kind === "row") {
      props.onSelectRange({ top: target.row, bottom: target.row, left: 1, right: extent.cols });
    } else {
      props.onSelectRange({ top: 1, left: 1, bottom: extent.rows, right: extent.cols });
    }
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = hit(event.clientX, event.clientY);
    if (!target) return;
    const mouse = event.pointerType === "mouse";
    drag.current = {
      pointerId: event.pointerId,
      kind: mouse ? "mouse" : "touch",
      x: event.clientX,
      y: event.clientY,
    };
    if (!mouse) return;
    // Dragging across cells must not start the browser's own text selection over the cells.
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    select(target, event.shiftKey);
    if (target.kind === "cell") event.currentTarget.setPointerCapture(event.pointerId);
    scroller.current?.focus({ preventScroll: true });
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const now = drag.current;
    if (now?.kind !== "mouse" || now.pointerId !== event.pointerId) return;
    if ((event.buttons & 1) === 0) return;
    const target = hit(event.clientX, event.clientY);
    if (target?.kind === "cell")
      props.onSelect({ anchor: selection.anchor, focus: target.pos }, true);
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const now = drag.current;
    drag.current = null;
    if (now?.kind !== "touch") return;
    if (Math.hypot(event.clientX - now.x, event.clientY - now.y) > 10) return;
    // A tap chooses a cell and a tap on the chosen cell opens it; a drag scrolls instead.
    const target = hit(event.clientX, event.clientY);
    if (!target) return;
    if (
      target.kind === "cell" &&
      target.pos.row >= active.top &&
      target.pos.row <= active.bottom &&
      target.pos.col >= active.left &&
      target.pos.col <= active.right
    ) {
      props.onActivate();
      return;
    }
    select(target, false);
  }

  function onDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = hit(event.clientX, event.clientY);
    if (target?.kind === "cell") props.onActivate();
  }

  const pageRows = Math.max(1, Math.floor(bodyH / (20 * zoom)) - 1);

  return (
    // biome-ignore lint/a11y/useSemanticElements: a windowed grid cannot be a table.
    <div
      ref={scroller}
      role="grid"
      aria-label={props.label}
      aria-rowcount={extent.rows}
      aria-colcount={extent.cols}
      aria-readonly={readOnly}
      tabIndex={0}
      data-testid="sheet-grid"
      className="relative size-full select-none overflow-auto overscroll-contain bg-background outline-none"
      onScroll={onScroll}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onDoubleClick={onDoubleClick}
      onKeyDown={(event) => props.onKeyDown(event, pageRows)}
      onPaste={props.onPaste}
    >
      <div
        style={{
          width: HEADER_W + cols.total,
          height: `calc(${HEADER_H + rows.total}px + var(--studio-dock-space, 0px))`,
        }}
      >
        <div
          className="sticky top-0 left-0 overflow-hidden"
          style={{ width: view.width, height: view.height }}
        >
          {panes.map(renderPane)}
          {frozenRows > 0 ? (
            <div
              className="pointer-events-none absolute z-[1] h-[2px] bg-foreground/25"
              style={{ left: 0, top: HEADER_H + frozenH - 1, width: view.width }}
            />
          ) : null}
          {frozenCols > 0 ? (
            <div
              className="pointer-events-none absolute z-[1] w-[2px] bg-foreground/25"
              style={{ top: 0, left: HEADER_W + frozenW - 1, height: view.height }}
            />
          ) : null}
          {columnHeader(bodyCols, scrollX, HEADER_W + frozenW, Math.max(0, bodyW - frozenW), "ch")}
          {columnHeader(leftCols, 0, HEADER_W, frozenW, "chf")}
          {rowHeader(bodyRows, scrollY, HEADER_H + frozenH, Math.max(0, bodyH - frozenH), "rh")}
          {rowHeader(topRows, 0, HEADER_H, frozenH, "rhf")}
          <div
            className="absolute top-0 left-0 border-r border-b border-border bg-muted"
            style={{ width: HEADER_W, height: HEADER_H }}
          />
        </div>
      </div>
    </div>
  );
}
