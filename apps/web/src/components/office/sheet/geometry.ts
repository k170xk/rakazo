/**
 * Where rows and columns sit on screen. Sizes are summed once so finding the item under a pixel
 * is a binary search, which keeps a sheet of half a million rows smooth to scroll.
 */
export type Axis = {
  /** `offsets[i]` is where item `i + 1` starts; `offsets[count]` is the total length. */
  offsets: Float64Array;
  count: number;
  total: number;
};

export function buildAxis(count: number, size: (index: number) => number): Axis {
  const offsets = new Float64Array(count + 1);
  for (let index = 1; index <= count; index += 1) {
    offsets[index] = offsets[index - 1]! + Math.max(0, size(index));
  }
  return { offsets, count, total: offsets[count]! };
}

export function startOf(axis: Axis, index: number): number {
  return axis.offsets[Math.min(Math.max(index, 1), axis.count + 1) - 1] ?? axis.total;
}

export function sizeOf(axis: Axis, index: number): number {
  if (index < 1 || index > axis.count) return 0;
  return axis.offsets[index]! - axis.offsets[index - 1]!;
}

/** The 1-based item under pixel `px`, clamped to the axis. Zero-size items are never returned. */
export function indexAt(axis: Axis, px: number): number {
  if (axis.count === 0) return 1;
  if (px <= 0) return firstShown(axis, 1);
  if (px >= axis.total) return lastShown(axis, axis.count);
  let low = 1;
  let high = axis.count;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (axis.offsets[mid]! <= px) low = mid + 1;
    else high = mid;
  }
  return low;
}

function firstShown(axis: Axis, from: number): number {
  for (let index = from; index <= axis.count; index += 1) if (sizeOf(axis, index) > 0) return index;
  return from;
}

function lastShown(axis: Axis, from: number): number {
  for (let index = from; index >= 1; index -= 1) if (sizeOf(axis, index) > 0) return index;
  return from;
}

/**
 * The items drawn in a scrolling pane: those between `from` and `to` pixels plus a few either
 * side, never before `min`. `last < first` when nothing is left to draw.
 */
export function span(
  axis: Axis,
  from: number,
  to: number,
  min: number,
  overscan = 2,
): { first: number; last: number } {
  if (min > axis.count || to <= from) return { first: min, last: min - 1 };
  const first = Math.max(min, indexAt(axis, from) - overscan);
  const last = Math.min(axis.count, indexAt(axis, to) + overscan);
  return { first, last };
}

/**
 * How far a pane must scroll so the item is fully in view. `frozen` is the length the frozen
 * items take at the start, `viewport` the pane's visible length including them.
 */
export function scrollToShow(
  axis: Axis,
  index: number,
  scroll: number,
  frozen: number,
  viewport: number,
): number {
  const start = startOf(axis, index);
  const end = start + sizeOf(axis, index);
  if (start < frozen) return scroll;
  if (start < frozen + scroll) return Math.max(0, start - frozen);
  if (end > scroll + viewport) return Math.max(0, Math.min(start - frozen, end - viewport));
  return scroll;
}
