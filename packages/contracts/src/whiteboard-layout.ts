import type { BoardItem } from "./whiteboard.js";
import { computeBoardArrows, rectsOverlap, segmentHitsRect } from "./whiteboard-geometry.js";

const SECTION_TOP = 64;
const SECTION_PAD_X = 36;
const SECTION_PAD_BOTTOM = 36;
const NODE_GAP_X = 84;
const NODE_GAP_Y = 56;
const SECTION_GAP_X = 96;
const SECTION_GAP_Y = 84;
const GRID_COLS = 3;

export type BoardDirection = "right" | "down" | "lanes" | "grid";

export type BoardLayoutSummary = {
  bounds: { x: number; y: number; w: number; h: number };
  sections: number;
  blocks: number;
  arrows: number;
  containedInSection: string[];
  overlaps: string[];
  headerClashes: string[];
  outsideSection: string[];
  textClipping: string[];
  arrowCrossings: string[];
  labelClashes: string[];
  note?: string;
};

const BOX_KINDS = new Set([
  "sticky",
  "text",
  "rect",
  "ellipse",
  "diamond",
  "cylinder",
  "document",
  "cloud",
  "queue",
  "image",
]);

/** Minimum readable width and height for text inside each shape kind, so words never clip. */
export function fitBoardItemSize(item: BoardItem, normalize = false): { w: number; h: number } {
  if (item.kind === "arrow" || item.kind === "pen" || item.kind === "section") {
    return { w: item.w, h: item.h };
  }
  if (item.kind === "image") {
    const hasCaption = Boolean((item.text ?? "").trim());
    if (item.w > 40 && item.h > 40) return { w: item.w, h: item.h };
    return { w: 360, h: hasCaption ? 236 : 202 };
  }
  const text = (item.text ?? "").trim();
  if (!text) return normalize ? { w: 180, h: 150 } : { w: item.w, h: item.h };

  const lines = text.split("\n");
  const longestWord = Math.max(4, ...text.split(/\s+/).map((word) => word.length));

  if (item.kind === "text") {
    const charsPerLine = 26;
    const wrapped = lines.reduce(
      (sum, line) => sum + Math.max(1, Math.ceil(Math.max(1, line.length) / charsPerLine)),
      0,
    );
    const idealW = Math.min(480, Math.max(160, longestWord * 12 + 28, text.length * 10 + 28));
    const idealH = wrapped * 30 + 24;
    return {
      w: Math.round(normalize ? idealW : Math.max(item.w, idealW)),
      h: Math.round(normalize ? idealH : Math.max(item.h, idealH)),
    };
  }

  // Diamonds have 50% usable inner diamond area; cylinders have top cap; sticky notes use 16px font.
  const factor =
    item.kind === "diamond" ? 1.55 : item.kind === "ellipse" || item.kind === "cloud" ? 1.25 : 1;
  const minW = item.kind === "diamond" ? 200 : item.kind === "sticky" ? 190 : 180;
  const maxW = item.kind === "diamond" ? 320 : 300;
  const preferredW = Math.min(
    maxW,
    Math.max(
      minW,
      longestWord * 10 * factor + 40,
      Math.ceil(Math.sqrt(text.length * 190)) * factor,
    ),
  );
  const w = Math.round(normalize ? preferredW : Math.min(maxW + 60, Math.max(item.w, preferredW)));
  const innerW = Math.max(72, w / factor - 32);
  const charsPerLine = Math.max(10, Math.floor(innerW / 8.4));
  const wrappedLines = lines.reduce(
    (sum, line) => sum + Math.max(1, Math.ceil(Math.max(1, line.length) / charsPerLine)),
    0,
  );
  const lineH = item.kind === "sticky" ? 23 : 21;
  const extraY = item.kind === "cylinder" ? 46 : item.kind === "diamond" ? 56 : 34;
  const minH = item.kind === "diamond" ? 130 : item.kind === "sticky" ? 150 : 86;
  const idealH = Math.max(minH, Math.round(wrappedLines * lineH + extraY));
  const h = normalize ? idealH : Math.min(idealH + 80, Math.max(item.h, idealH));
  return { w, h };
}

function assignLayeredRanks(
  ids: string[],
  edges: Array<{ from: string; to: string }>,
): Map<string, number> {
  const set = new Set(ids);
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of ids) {
    outgoing.set(id, []);
    indegree.set(id, 0);
  }
  for (const edge of edges) {
    if (!set.has(edge.from) || !set.has(edge.to) || edge.from === edge.to) continue;
    outgoing.get(edge.from)!.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const rank = new Map<string, number>();
  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const visited = new Set<string>();
  if (!queue.length && ids.length) queue.push(ids[0]!);

  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const base = rank.get(current) ?? 0;
    rank.set(current, base);
    for (const next of outgoing.get(current) ?? []) {
      rank.set(next, Math.max(rank.get(next) ?? 0, base + 1));
      const left = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, left);
      if (left <= 0 && !visited.has(next)) queue.push(next);
    }
    if (!queue.length && visited.size < ids.length) {
      const remaining = ids.find((id) => !visited.has(id));
      if (remaining) queue.push(remaining);
    }
  }
  return rank;
}

function layoutGroupNodes(
  nodes: BoardItem[],
  edges: Array<{ from: string; to: string }>,
  direction: BoardDirection,
): { placed: Map<string, { x: number; y: number; w: number; h: number }>; w: number; h: number } {
  const placed = new Map<string, { x: number; y: number; w: number; h: number }>();
  if (!nodes.length) return { placed, w: 320, h: 180 };

  const sized = nodes.map((node) => ({ node, ...fitBoardItemSize(node, true) }));
  const nodeSet = new Set(nodes.map((node) => node.id));
  const internalEdges = edges.filter((edge) => nodeSet.has(edge.from) && nodeSet.has(edge.to));

  // Pure collections without arrows arrange cleanly in a balanced grid or vertical stack in lanes.
  if (direction === "grid" || (internalEdges.length === 0 && direction !== "lanes")) {
    const cols =
      direction === "down"
        ? 1
        : Math.min(GRID_COLS, Math.max(1, Math.ceil(Math.sqrt(sized.length))));
    const colWidths = new Array<number>(cols).fill(0);
    const rows = Math.ceil(sized.length / cols);
    const rowHeights = new Array<number>(rows).fill(0);
    sized.forEach((entry, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      colWidths[col] = Math.max(colWidths[col]!, entry.w);
      rowHeights[row] = Math.max(rowHeights[row]!, entry.h);
    });
    let y = 0;
    for (let row = 0; row < rows; row++) {
      let x = 0;
      for (let col = 0; col < cols; col++) {
        const entry = sized[row * cols + col];
        if (entry) {
          placed.set(entry.node.id, {
            x: Math.round(x + (colWidths[col]! - entry.w) / 2),
            y: Math.round(y + (rowHeights[row]! - entry.h) / 2),
            w: entry.w,
            h: entry.h,
          });
        }
        x += colWidths[col]! + NODE_GAP_X;
      }
      y += rowHeights[row]! + NODE_GAP_Y;
    }
    const totalW = colWidths.reduce((sum, w) => sum + w, 0) + Math.max(0, cols - 1) * NODE_GAP_X;
    const totalH = rowHeights.reduce((sum, h) => sum + h, 0) + Math.max(0, rows - 1) * NODE_GAP_Y;
    return { placed, w: totalW, h: totalH };
  }

  if (direction === "lanes" && internalEdges.length === 0) {
    let y = 0;
    const maxW = Math.max(...sized.map((entry) => entry.w));
    for (const entry of sized) {
      placed.set(entry.node.id, {
        x: Math.round((maxW - entry.w) / 2),
        y: Math.round(y),
        w: entry.w,
        h: entry.h,
      });
      y += entry.h + 28;
    }
    return { placed, w: maxW, h: Math.max(120, y - 28) };
  }

  // Layered Sugiyama-style rank assignment (using forward DAG edges so feedback loops don't scramble ranks).
  const nodeOrder = new Map(sized.map((entry, idx) => [entry.node.id, idx]));
  const forwardInternal = internalEdges.filter(
    (edge) => (nodeOrder.get(edge.from) ?? 0) < (nodeOrder.get(edge.to) ?? 0),
  );
  const ranks = assignLayeredRanks(
    sized.map((entry) => entry.node.id),
    forwardInternal.length > 0 ? forwardInternal : internalEdges,
  );
  const maxRank = Math.max(0, ...ranks.values());
  const layers: Array<typeof sized> = Array.from({ length: maxRank + 1 }, () => []);
  for (const entry of sized) {
    layers[ranks.get(entry.node.id) ?? 0]!.push(entry);
  }

  // Barycenter pass based on predecessor positions in previous layer.
  for (let r = 1; r <= maxRank; r++) {
    const prevOrder = new Map(layers[r - 1]!.map((entry, idx) => [entry.node.id, idx]));
    layers[r]!.sort((left, right) => {
      const preds = (id: string) =>
        internalEdges
          .filter((edge) => edge.to === id && prevOrder.has(edge.from))
          .map((edge) => prevOrder.get(edge.from)!);
      const lp = preds(left.node.id);
      const rp = preds(right.node.id);
      const lb = lp.length ? lp.reduce((a, b) => a + b, 0) / lp.length : Number.MAX_SAFE_INTEGER;
      const rb = rp.length ? rp.reduce((a, b) => a + b, 0) / rp.length : Number.MAX_SAFE_INTEGER;
      return lb - rb;
    });
  }

  const horizontal = direction === "right";
  const layerSpan = layers.map((layer) =>
    horizontal
      ? layer.reduce((sum, item) => sum + item.h, 0) + Math.max(0, layer.length - 1) * NODE_GAP_Y
      : layer.reduce((sum, item) => sum + item.w, 0) + Math.max(0, layer.length - 1) * NODE_GAP_X,
  );
  const maxCrossSpan = Math.max(120, ...layerSpan);
  const layerDepth = layers.map((layer) =>
    Math.max(80, ...layer.map((item) => (horizontal ? item.w : item.h))),
  );

  let primary = 0;
  layers.forEach((layer, r) => {
    let cross = (maxCrossSpan - layerSpan[r]!) / 2;
    const depth = layerDepth[r]!;
    for (const entry of layer) {
      const x = horizontal ? primary + (depth - entry.w) / 2 : cross;
      const y = horizontal ? cross : primary + (depth - entry.h) / 2;
      placed.set(entry.node.id, {
        x: Math.round(x),
        y: Math.round(y),
        w: entry.w,
        h: entry.h,
      });
      cross += (horizontal ? entry.h : entry.w) + (horizontal ? NODE_GAP_Y : NODE_GAP_X);
    }
    primary += depth + (horizontal ? NODE_GAP_X + 24 : NODE_GAP_Y + 20);
  });

  const totalPrimary =
    layerDepth.reduce((sum, d) => sum + d, 0) +
    Math.max(0, layers.length - 1) * (horizontal ? NODE_GAP_X + 24 : NODE_GAP_Y + 20);
  return horizontal
    ? { placed, w: totalPrimary, h: maxCrossSpan }
    : { placed, w: maxCrossSpan, h: totalPrimary };
}

function boxesOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  pad = 0,
): boolean {
  return (
    a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y
  );
}

/** Infers membership when an existing board used spatial containment instead of `section`. */
export function inferSectionMembership(items: readonly BoardItem[]): Map<string, string> {
  const sections = items
    .filter((item) => item.kind === "section")
    .slice()
    .sort((a, b) => a.w * a.h - b.w * b.h);
  const map = new Map<string, string>();
  for (const item of items) {
    if (!BOX_KINDS.has(item.kind)) continue;
    if (item.section && sections.some((sec) => sec.id === item.section)) {
      map.set(item.id, item.section);
      continue;
    }
    const cx = item.x + item.w / 2;
    const cy = item.y + item.h / 2;
    const hit = sections.find(
      (sec) =>
        cx >= sec.x &&
        cx <= sec.x + sec.w &&
        cy >= (item.kind === "text" ? sec.y + 44 : sec.y) &&
        cy <= sec.y + sec.h,
    );
    if (hit) map.set(item.id, hit.id);
  }
  return map;
}

/**
 * Arranges sections, headers, blocks and arrows into a clean, overlap-free diagram.
 * Sections wrap their children with generous padding, flows align along ranks, and banners sit at top.
 */
export function layoutBoardItems(
  items: readonly BoardItem[],
  direction: BoardDirection = "right",
): BoardItem[] {
  if (!items.length) return [];

  const membership = inferSectionMembership(items);
  const sections = items.filter((item) => item.kind === "section");
  const sectionIds = new Set(sections.map((sec) => sec.id));

  const edges: Array<{ from: string; to: string }> = [];
  for (const item of items) {
    if (item.kind !== "arrow") continue;
    const from = item.from && "item" in item.from ? item.from.item : null;
    const to = item.to && "item" in item.to ? item.to.item : null;
    if (from && to) edges.push({ from, to });
  }

  const connectedIds = new Set<string>();
  for (const edge of edges) {
    connectedIds.add(edge.from);
    connectedIds.add(edge.to);
  }

  // Standalone text items outside sections without arrows are treated as board title / banners.
  const banners = items.filter(
    (item) => item.kind === "text" && !membership.has(item.id) && !connectedIds.has(item.id),
  );
  const bannerIds = new Set(banners.map((b) => b.id));

  const coords = new Map<string, { x: number; y: number; w: number; h: number }>();
  let cursorY = 48;

  for (const banner of banners) {
    const size = fitBoardItemSize(banner, true);
    coords.set(banner.id, { x: 48, y: cursorY, w: size.w, h: size.h });
    cursorY += size.h + 28;
  }

  // Layout each section's inner items first so every section knows its exact width and height.
  const sectionLayouts = new Map<
    string,
    {
      w: number;
      h: number;
      children: Map<string, { x: number; y: number; w: number; h: number }>;
    }
  >();

  for (const sec of sections) {
    const children = items.filter(
      (item) => BOX_KINDS.has(item.kind) && membership.get(item.id) === sec.id,
    );
    const subDirection: BoardDirection =
      direction === "lanes" ? "lanes" : direction === "down" ? "right" : direction;
    const inner = layoutGroupNodes(children, edges, subDirection);
    const titleMinW = Math.min(520, Math.max(260, (sec.text?.length ?? 8) * 11 + 64));
    const secW = Math.max(titleMinW, inner.w + SECTION_PAD_X * 2);
    const secH = Math.max(180, inner.h + SECTION_TOP + SECTION_PAD_BOTTOM);
    sectionLayouts.set(sec.id, { w: secW, h: secH, children: inner.placed });
  }

  // Arrange sections relative to each other (using cross-section edges or lanes/flow).
  if (sections.length > 0) {
    const sectionEdges: Array<{ from: string; to: string }> = [];
    for (const edge of edges) {
      const fromSec = sectionIds.has(edge.from) ? edge.from : membership.get(edge.from);
      const toSec = sectionIds.has(edge.to) ? edge.to : membership.get(edge.to);
      if (fromSec && toSec && fromSec !== toSec) {
        sectionEdges.push({ from: fromSec, to: toSec });
      }
    }

    if (direction === "lanes" || (sectionEdges.length === 0 && direction !== "down")) {
      // Side-by-side columns (swimlanes / phases) or wrapped rows of up to 3 sections.
      const maxPerRow = direction === "lanes" ? Math.min(5, sections.length) : 3;
      let index = 0;
      while (index < sections.length) {
        const row = sections.slice(index, index + maxPerRow);
        const rowH = Math.max(...row.map((sec) => sectionLayouts.get(sec.id)!.h));
        let x = 48;
        for (const sec of row) {
          const layout = sectionLayouts.get(sec.id)!;
          const h = direction === "lanes" ? rowH : layout.h;
          coords.set(sec.id, { x, y: cursorY, w: layout.w, h });
          for (const [childId, rel] of layout.children) {
            const offsetX = Math.round((layout.w - SECTION_PAD_X * 2 - rel.w) / 2);
            coords.set(childId, {
              x: x + SECTION_PAD_X + (layout.children.size === 1 ? Math.max(0, offsetX) : rel.x),
              y: cursorY + SECTION_TOP + rel.y,
              w: rel.w,
              h: rel.h,
            });
          }
          x += layout.w + SECTION_GAP_X;
        }
        cursorY += rowH + SECTION_GAP_Y;
        index += maxPerRow;
      }
    } else {
      // Ranked flow of sections: preserve natural stage sequence (removing feedback back-edges)
      // so Stage 1 -> Stage 2 sit side-by-side on row 1, and Stage 3 -> Stage 4 sit on row 2.
      const orderIndex = new Map(sections.map((s, idx) => [s.id, idx]));
      const forwardSectionEdges = sectionEdges.filter(
        (e) => (orderIndex.get(e.from) ?? 0) < (orderIndex.get(e.to) ?? 0),
      );
      const secRanks = assignLayeredRanks(
        sections.map((s) => s.id),
        forwardSectionEdges,
      );
      const maxRank = Math.max(0, ...secRanks.values());
      const orderedSections = Array.from({ length: maxRank + 1 }, (_, r) =>
        sections.filter((s) => (secRanks.get(s.id) ?? 0) === r),
      ).flat();
      const perRow = direction === "down" ? 1 : orderedSections.length === 3 ? 3 : 2;
      const colWidths = new Array<number>(perRow).fill(0);
      orderedSections.forEach((sec, idx) => {
        const col = idx % perRow;
        colWidths[col] = Math.max(colWidths[col]!, sectionLayouts.get(sec.id)!.w);
      });
      for (let index = 0; index < orderedSections.length; index += perRow) {
        const row = orderedSections.slice(index, index + perRow);
        const rowH = Math.max(...row.map((sec) => sectionLayouts.get(sec.id)!.h));
        let x = 48;
        row.forEach((sec, col) => {
          const layout = sectionLayouts.get(sec.id)!;
          const w = perRow > 1 ? colWidths[col]! : layout.w;
          const extraShiftX = Math.max(0, Math.round((w - layout.w) / 2));
          coords.set(sec.id, { x, y: cursorY, w, h: rowH });
          for (const [childId, rel] of layout.children) {
            coords.set(childId, {
              x: x + SECTION_PAD_X + extraShiftX + rel.x,
              y: cursorY + SECTION_TOP + rel.y,
              w: rel.w,
              h: rel.h,
            });
          }
          x += w + SECTION_GAP_X;
        });
        cursorY += rowH + SECTION_GAP_Y;
      }
    }
  }

  // Free (unsectioned) blocks placed cleanly below or starting at cursorY.
  const freeNodes = items.filter(
    (item) => BOX_KINDS.has(item.kind) && !membership.has(item.id) && !bannerIds.has(item.id),
  );
  if (freeNodes.length > 0) {
    const freeLayout = layoutGroupNodes(
      freeNodes,
      edges,
      direction === "lanes" ? "right" : direction,
    );
    for (const [id, rel] of freeLayout.placed) {
      coords.set(id, {
        x: 48 + rel.x,
        y: cursorY + rel.y,
        w: rel.w,
        h: rel.h,
      });
    }
    cursorY += freeLayout.h + SECTION_GAP_Y;
  }

  // Keep pen strokes non-overlapping below if they collide with laid-out shapes.
  const occupied = [...coords.values()];
  for (const item of items) {
    if (item.kind !== "pen") continue;
    const box = { x: item.x, y: item.y, w: Math.max(24, item.w), h: Math.max(24, item.h) };
    if (occupied.some((other) => boxesOverlap(box, other, 16))) {
      coords.set(item.id, { x: 48, y: cursorY, w: item.w, h: item.h });
      cursorY += Math.max(40, item.h) + 32;
    }
  }

  return items.map((item) => {
    const placed = coords.get(item.id);
    const sec = membership.get(item.id);
    if (!placed) {
      return sec ? { ...item, section: sec } : item;
    }
    return {
      ...item,
      x: placed.x,
      y: placed.y,
      w: placed.w,
      h: placed.h,
      ...(sec ? { section: sec } : {}),
    };
  });
}

/** Ensures every section expands around its assigned children without touching unrelated blocks. */
export function settleBoardSections(items: readonly BoardItem[]): BoardItem[] {
  const next = items.map((item) => ({ ...item }));
  const byId = new Map(next.map((item) => [item.id, item]));
  for (const sec of next) {
    if (sec.kind !== "section") continue;
    const children = next.filter((item) => item.section === sec.id && BOX_KINDS.has(item.kind));
    if (!children.length) continue;
    const minX = Math.min(...children.map((c) => c.x)) - SECTION_PAD_X;
    const minY = Math.min(...children.map((c) => c.y)) - SECTION_TOP;
    const maxX = Math.max(...children.map((c) => c.x + c.w)) + SECTION_PAD_X;
    const maxY = Math.max(...children.map((c) => c.y + c.h)) + SECTION_PAD_BOTTOM;
    sec.x = Math.min(sec.x, minX);
    sec.y = Math.min(sec.y, minY);
    sec.w = Math.max(sec.w, maxX - sec.x);
    sec.h = Math.max(sec.h, maxY - sec.y);
    byId.set(sec.id, sec);
  }
  return next;
}

/** Orthogonal polyline waypoints between two items or points, routing around intermediate boxes. */
export function routeBoardArrow(
  arrow: Pick<BoardItem, "from" | "to"> & { id?: string; text?: string },
  byId: ReadonlyMap<string, BoardItem>,
  obstacles: readonly BoardItem[] = [],
): Array<{ x: number; y: number }> | null {
  const id = arrow.id ?? "_probe";
  const all: BoardItem[] = [
    ...obstacles.filter((o) => o.id !== id),
    ...[...byId.values()].filter((v) => !obstacles.some((o) => o.id === v.id) && v.id !== id),
    { id, kind: "arrow", x: 0, y: 0, w: 0, h: 0, from: arrow.from, to: arrow.to, text: arrow.text },
  ];
  const computed = computeBoardArrows(all).get(id);
  return computed ? computed.points : null;
}

function boxFullyInside(
  inner: { x: number; y: number; w: number; h: number },
  outer: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    inner.x >= outer.x + 2 &&
    inner.y >= outer.y + 2 &&
    inner.x + inner.w <= outer.x + outer.w - 2 &&
    inner.y + inner.h <= outer.y + outer.h - 2
  );
}

/** Audits a board for coordinate accuracy, valid section containment, overlaps, clipping and arrow crossings. */
export function inspectBoardLayout(items: readonly BoardItem[]): BoardLayoutSummary {
  const sections = items.filter((item) => item.kind === "section");
  const blocks = items.filter((item) => BOX_KINDS.has(item.kind));
  const arrows = items.filter((item) => item.kind === "arrow");
  const byId = new Map(items.map((item) => [item.id, item]));
  const membership = inferSectionMembership(items);

  const containedInSection: string[] = [];
  const headerClashes: string[] = [];
  const outsideSection: string[] = [];

  for (const block of blocks) {
    const secId = block.section ?? membership.get(block.id);
    if (!secId) continue;
    const sec = byId.get(secId);
    if (sec?.kind !== "section") continue;
    if (block.y < sec.y + 48 && block.y + block.h > sec.y) {
      headerClashes.push(
        `${block.id} (y=${Math.round(block.y)}) overlaps header band of section ${sec.id} (y=${Math.round(sec.y)}..${Math.round(sec.y + 48)}); set y >= ${Math.round(sec.y + 54)}`,
      );
    } else if (
      block.x < sec.x + 6 ||
      block.y < sec.y + 6 ||
      block.x + block.w > sec.x + sec.w - 6 ||
      block.y + block.h > sec.y + sec.h - 6
    ) {
      outsideSection.push(
        `${block.id} (${Math.round(block.x)},${Math.round(block.y)} ${Math.round(block.w)}x${Math.round(block.h)}) spills outside section ${sec.id} (${Math.round(sec.x)},${Math.round(sec.y)} ${Math.round(sec.w)}x${Math.round(sec.h)}); resize section or move block unless straddling intentionally`,
      );
    } else {
      containedInSection.push(`${block.id} in ${sec.id}`);
    }
  }

  const overlaps: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i]!;
      const b = blocks[j]!;
      const ox = Math.max(a.x, b.x);
      const oy = Math.max(a.y, b.y);
      const ow = Math.min(a.x + a.w, b.x + b.w) - ox;
      const oh = Math.min(a.y + a.h, b.y + b.h) - oy;
      if (ow > 2 && oh > 2) {
        overlaps.push(
          `${a.id} (${a.kind} ${Math.round(a.x)},${Math.round(a.y)} ${Math.round(a.w)}x${Math.round(a.h)}) overlaps ${b.id} (${b.kind} ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}) by ${Math.round(ow)}x${Math.round(oh)}px`,
        );
      }
    }
  }
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      const a = sections[i]!;
      const b = sections[j]!;
      if (boxFullyInside(a, b)) {
        containedInSection.push(`section ${a.id} nested in ${b.id}`);
        continue;
      }
      if (boxFullyInside(b, a)) {
        containedInSection.push(`section ${b.id} nested in ${a.id}`);
        continue;
      }
      const ox = Math.max(a.x, b.x);
      const oy = Math.max(a.y, b.y);
      const ow = Math.min(a.x + a.w, b.x + b.w) - ox;
      const oh = Math.min(a.y + a.h, b.y + b.h) - oy;
      if (ow > 2 && oh > 2) {
        overlaps.push(
          `section ${a.id} (${Math.round(a.x)},${Math.round(a.y)} ${Math.round(a.w)}x${Math.round(a.h)}) overlaps section ${b.id} (${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}) by ${Math.round(ow)}x${Math.round(oh)}px`,
        );
      }
    }
  }

  const textClipping: string[] = [];
  for (const block of blocks) {
    if (block.kind === "image" || !(block.text ?? "").trim()) continue;
    const needed = fitBoardItemSize(block, true);
    if (block.w + 16 < needed.w || block.h + 14 < needed.h) {
      textClipping.push(
        `${block.id} (${Math.round(block.w)}x${Math.round(block.h)}) may clip text; recommended >= ${needed.w}x${needed.h}`,
      );
    }
  }

  const routedMap = computeBoardArrows(items);
  const arrowCrossings: string[] = [];
  const labelClashes: string[] = [];
  const labelEntries: Array<{ id: string; box: { x: number; y: number; w: number; h: number } }> =
    [];

  for (const arrow of arrows) {
    const routed = routedMap.get(arrow.id);
    if (!routed || routed.points.length < 2) continue;
    const fromId = arrow.from && "item" in arrow.from ? arrow.from.item : undefined;
    const toId = arrow.to && "item" in arrow.to ? arrow.to.item : undefined;
    for (let s = 0; s < routed.points.length - 1; s++) {
      for (const block of blocks) {
        if (block.id === fromId || block.id === toId) continue;
        if (segmentHitsRect(routed.points[s]!, routed.points[s + 1]!, block, 4)) {
          arrowCrossings.push(`arrow ${arrow.id} crosses ${block.id}`);
          break;
        }
      }
    }
    if (routed.label) {
      for (const block of blocks) {
        if (rectsOverlap(routed.label, block, 0)) {
          labelClashes.push(`arrow ${arrow.id} label overlaps block ${block.id}`);
        }
      }
      for (const prev of labelEntries) {
        if (rectsOverlap(routed.label, prev.box, 2)) {
          labelClashes.push(`arrow ${arrow.id} label overlaps arrow ${prev.id} label`);
        }
      }
      labelEntries.push({ id: arrow.id, box: routed.label });
    }
  }

  const nonArrows = items.filter((item) => item.kind !== "arrow");
  const bounds = nonArrows.length
    ? {
        x: Math.min(...nonArrows.map((i) => i.x)),
        y: Math.min(...nonArrows.map((i) => i.y)),
        w: Math.max(...nonArrows.map((i) => i.x + i.w)) - Math.min(...nonArrows.map((i) => i.x)),
        h: Math.max(...nonArrows.map((i) => i.y + i.h)) - Math.min(...nonArrows.map((i) => i.y)),
      }
    : { x: 0, y: 0, w: 0, h: 0 };

  const hasFindings =
    overlaps.length > 0 ||
    headerClashes.length > 0 ||
    outsideSection.length > 0 ||
    textClipping.length > 0 ||
    arrowCrossings.length > 0 ||
    labelClashes.length > 0;

  return {
    bounds,
    sections: sections.length,
    blocks: blocks.length,
    arrows: arrows.length,
    containedInSection: containedInSection.slice(0, 24),
    overlaps: overlaps.slice(0, 12),
    headerClashes: headerClashes.slice(0, 12),
    outsideSection: outsideSection.slice(0, 12),
    textClipping: textClipping.slice(0, 12),
    arrowCrossings: arrowCrossings.slice(0, 12),
    labelClashes: labelClashes.slice(0, 12),
    ...(hasFindings
      ? {
          note: "Check any overlaps, headerClashes, outsideSection, textClipping, arrowCrossings or labelClashes above. Keep an overlap only if intentional (e.g. layered callouts/badges); otherwise adjust x/y/w/h via ops or pass layout ('right' | 'down' | 'lanes' | 'grid') to auto-arrange cleanly.",
        }
      : {}),
  };
}
