import type { CellPos, CellRange } from "./address";
import { MAX_COLS, MAX_ROWS, rangeContains, rangeOf, rangesOverlap } from "./address";

/** The cell the selection started from and the one it was dragged or shifted to. */
export type Selection = { anchor: CellPos; focus: CellPos };

export function selectCell(pos: CellPos): Selection {
  return { anchor: pos, focus: pos };
}

export function selectionRange(selection: Selection, merges: readonly CellRange[] = []): CellRange {
  return expandToMerges(rangeOf(selection.anchor, selection.focus), merges);
}

/** Grows a range until no merged block sticks out of it, as a spreadsheet selection does. */
export function expandToMerges(range: CellRange, merges: readonly CellRange[]): CellRange {
  let current = range;
  for (let changed = true; changed; ) {
    changed = false;
    for (const merge of merges) {
      if (!rangesOverlap(current, merge)) continue;
      const next = {
        top: Math.min(current.top, merge.top),
        left: Math.min(current.left, merge.left),
        bottom: Math.max(current.bottom, merge.bottom),
        right: Math.max(current.right, merge.right),
      };
      if (
        next.top !== current.top ||
        next.left !== current.left ||
        next.bottom !== current.bottom ||
        next.right !== current.right
      ) {
        current = next;
        changed = true;
      }
    }
  }
  return current;
}

export function mergeAt(merges: readonly CellRange[], pos: CellPos): CellRange | undefined {
  return merges.find((merge) => rangeContains(merge, pos));
}

/** The cell that holds a merged block's value: its top-left. */
export function ownerCell(merges: readonly CellRange[], pos: CellPos): CellPos {
  const merge = mergeAt(merges, pos);
  return merge ? { row: merge.top, col: merge.left } : pos;
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 1), max);
}

/**
 * One step from `pos`, stepping over a merged block as a whole and landing on the owner of the
 * block it enters.
 */
export function stepFrom(
  pos: CellPos,
  dRow: number,
  dCol: number,
  merges: readonly CellRange[] = [],
): CellPos {
  const here = mergeAt(merges, pos);
  let row = pos.row;
  let col = pos.col;
  if (here) {
    if (dRow > 0) row = here.bottom;
    if (dRow < 0) row = here.top;
    if (dCol > 0) col = here.right;
    if (dCol < 0) col = here.left;
  }
  const next = { row: clamp(row + dRow, MAX_ROWS), col: clamp(col + dCol, MAX_COLS) };
  const landed = mergeAt(merges, next);
  if (!landed) return next;
  // Keep the row (or column) being travelled along, so moving down a merged column stays in it.
  return {
    row: dRow !== 0 ? landed.top : next.row,
    col: dCol !== 0 ? landed.left : next.col,
  };
}

/** Arrow keys: move the cursor, or with Shift grow the range from its anchor. */
export function moveSelection(
  selection: Selection,
  dRow: number,
  dCol: number,
  extend: boolean,
  merges: readonly CellRange[] = [],
): Selection {
  if (extend) return { anchor: selection.anchor, focus: stepFrom(selection.focus, dRow, dCol) };
  const from = ownerCell(merges, selection.focus);
  return selectCell(ownerCell(merges, stepFrom(from, dRow, dCol, merges)));
}

/** Pointer drag or Shift+click: keep the anchor, move the focus. */
export function extendSelection(selection: Selection, to: CellPos): Selection {
  return { anchor: selection.anchor, focus: to };
}

/** Every cell of a range, row by row; for clearing and copying. */
export function* cellsIn(range: CellRange): Generator<CellPos> {
  for (let row = range.top; row <= range.bottom; row += 1) {
    for (let col = range.left; col <= range.right; col += 1) yield { row, col };
  }
}
