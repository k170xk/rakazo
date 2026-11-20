/**
 * Jantt prints full month names and a date badge on every task boundary whatever the zoom, so at
 * narrow day widths they pile on top of each other. These helpers shorten month names to fit their
 * column and hide the badges that would overlap a more important one.
 */

const MONTH_CELL_PAD = 12;
const TIGHT_MONTH_PAD = 3;
const TIGHT_BELOW_PX = 44;
const MARKER_GAP_PX = 2;

/** A month label from longest to shortest: "January", "Jan", "J", then nothing. */
function labelForms(full: string): string[] {
  const word = /^([A-Za-z]+)(?: (\d{4}))?$/.exec(full);
  if (!word) return [full, ""];
  const name = word[1]!;
  return word[2]
    ? [full, `${name.slice(0, 3)} '${word[2].slice(2)}`, name.slice(0, 3), name.slice(0, 1), ""]
    : [full, name.slice(0, 3), name.slice(0, 1), ""];
}

/**
 * Month labels shortened to one shared form ("Jan" for all, not "April" beside "Mar"). The first and
 * last columns can be cut off by the chart's range, so they may shorten further without shortening the rest.
 */
export function fitMonthLabels(
  months: ReadonlyArray<{ full: string; available: number }>,
  measure: (text: string) => number,
): string[] {
  const own = months.map(({ full, available }) => {
    const forms = labelForms(full);
    const index = forms.findIndex((label) => measure(label) <= available);
    return { forms, step: index < 0 ? forms.length - 1 : forms.length - 1 - index };
  });
  const interior = own.length > 2 ? own.slice(1, -1) : own;
  const shared = Math.min(...interior.map((month) => month.step));
  return own.map(({ forms, step }) => forms[forms.length - 1 - Math.min(step, shared)]!);
}

export type MarkerSlot = { center: number; width: number; priority: number };

/**
 * Which markers to keep so none overlap: lower `priority` wins (today before task dates before
 * month starts), then earlier dates. Returns the kept indices.
 */
export function visibleMarkers(slots: readonly MarkerSlot[], gap = MARKER_GAP_PX): Set<number> {
  const order = slots.map((_, index) => index).sort((a, b) => slots[a]!.priority - slots[b]!.priority || slots[a]!.center - slots[b]!.center);
  const placed: Array<[number, number]> = [];
  const kept = new Set<number>();
  for (const index of order) {
    const slot = slots[index]!;
    const left = slot.center - slot.width / 2;
    const right = slot.center + slot.width / 2;
    if (placed.some(([l, r]) => left < r + gap && right > l - gap)) continue;
    placed.push([left, right]);
    kept.add(index);
  }
  return kept;
}

let canvas: HTMLCanvasElement | undefined;

function textMeasurer(sample: Element): (text: string) => number {
  canvas ??= document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return (text) => text.length * 8;
  const style = getComputedStyle(sample);
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return (text) => context.measureText(text).width;
}

function markerPriority(marker: Element, cell: Element): number {
  if (marker.classList.contains("is-today-marker") || marker.classList.contains("is-selected-marker")) return 0;
  return cell.classList.contains("is-task-boundary") ? 1 : 2;
}

/** Shorten month names and thin out date badges in a rendered Jantt timeline header. */
export function fitTimelineHeader(root: HTMLElement) {
  const months = root.querySelectorAll<HTMLElement>(".jantt-month-cell");
  if (months.length) {
    const cells = [...months].flatMap((cell) => {
      const label = [...cell.childNodes].find((node): node is Text => node.nodeType === Node.TEXT_NODE);
      if (!label) return [];
      const width = cell.getBoundingClientRect().width;
      const tight = width < TIGHT_BELOW_PX;
      cell.classList.toggle("is-tight", tight);
      const full = (cell.dataset.fullLabel ??= label.data);
      return [{ label, full, available: width - (tight ? TIGHT_MONTH_PAD * 2 : MONTH_CELL_PAD + 4) }];
    });
    const texts = fitMonthLabels(cells, textMeasurer(months[0]!));
    cells.forEach(({ label }, index) => {
      if (label.data !== texts[index]) label.data = texts[index]!;
    });
  }

  const markers = [...root.querySelectorAll<HTMLElement>(".jantt-header-days .jantt-boundary-marker")];
  const slots = markers.map((marker) => {
    const cell = marker.parentElement!;
    const box = marker.getBoundingClientRect();
    const cellBox = cell.getBoundingClientRect();
    return { center: cellBox.left + cellBox.width / 2, width: box.width, priority: markerPriority(marker, cell) };
  });
  const kept = visibleMarkers(slots);
  markers.forEach((marker, index) => marker.classList.toggle("is-crowded", !kept.has(index)));
}
