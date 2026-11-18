/** How the app bar lays out its tabs: one row on desktop, a row under the title on tablets and phones. */
export type NavMode = "phone" | "tablet" | "desktop";

/** Phone below 640px wide, tablet (iPad portrait and landscape) below 1024px, desktop beyond. */
export function navModeFor(width: number): NavMode {
  if (width < 640) return "phone";
  if (width < 1024) return "tablet";
  return "desktop";
}

export type NavPage<Item> = { kind: "page"; item: Item };
export type NavGroup<Item> = { kind: "group"; label: string; items: Item[] };
export type NavEntry<Item> = NavPage<Item> | NavGroup<Item>;

/**
 * Pages in order, with pages that share a `group` gathered into one entry where the first of them
 * stands, so the bar shows the group as a single dropdown.
 */
export function navEntries<Item extends { group?: unknown }>(items: Item[]): NavEntry<Item>[] {
  const entries: NavEntry<Item>[] = [];
  const groups = new Map<string, NavGroup<Item>>();
  for (const item of items) {
    const name = typeof item.group === "string" ? item.group.trim() : "";
    if (!name) {
      entries.push({ kind: "page", item });
      continue;
    }
    const known = groups.get(name.toLowerCase());
    if (known) {
      known.items.push(item);
      continue;
    }
    const group: NavGroup<Item> = { kind: "group", label: name, items: [item] };
    groups.set(name.toLowerCase(), group);
    entries.push(group);
  }
  // A group of one is just that page.
  return entries.map((entry) =>
    entry.kind === "group" && entry.items.length === 1
      ? { kind: "page", item: entry.items[0] as Item }
      : entry,
  );
}

/**
 * Which entries stay in the bar when `widths` (each entry's width, in order) do not all fit in
 * `available`; the rest go under a More button `moreWidth` wide. The selected entry always stays
 * in the bar. Returns the indices shown, in their original order, and those moved to More.
 */
export function fitNav(input: {
  widths: number[];
  moreWidth: number;
  available: number;
  gap: number;
  selected: number;
}): { shown: number[]; more: number[] } {
  const { widths, moreWidth, available, gap, selected } = input;
  const all = widths.map((_, index) => index);
  const span = (indices: number[]) =>
    indices.reduce((sum, index) => sum + (widths[index] ?? 0), 0) +
    gap * Math.max(0, indices.length - 1);
  if (span(all) <= available) return { shown: all, more: [] };
  const room = available - moreWidth - gap;
  for (let count = widths.length - 1; count >= 0; count -= 1) {
    let shown = all.slice(0, count);
    if (selected >= count && selected < widths.length) {
      shown = count > 0 ? [...all.slice(0, count - 1), selected] : [];
    }
    if (shown.length === 0 || span(shown) <= room) {
      if (shown.length === 0 && selected >= 0 && selected < widths.length) {
        const alone = [selected];
        if (span(alone) <= room) shown = alone;
      }
      const kept = new Set(shown);
      return { shown, more: all.filter((index) => !kept.has(index)) };
    }
  }
  return { shown: [], more: all };
}
