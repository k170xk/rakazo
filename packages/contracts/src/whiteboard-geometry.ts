export type GeometryPoint = { x: number; y: number };
export type GeometryEnd = GeometryPoint | { item: string };
export type PortSide = "top" | "right" | "bottom" | "left";

export type GeometryItem = {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  section?: string;
  from?: GeometryEnd;
  to?: GeometryEnd;
};

export type RoutedArrow = {
  id: string;
  points: GeometryPoint[];
  startSide?: PortSide;
  endSide?: PortSide;
  label?: { x: number; y: number; w: number; h: number };
};

const OBSTACLE_KINDS = new Set([
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

const isPoint = (end: GeometryEnd | undefined): end is GeometryPoint => !!end && "x" in end;

export function measureArrowLabel(text: string | undefined): { w: number; h: number } | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  const rawLines = trimmed.split("\n");
  const lines: string[] = [];
  for (const line of rawLines) {
    if (line.length <= 26) {
      lines.push(line);
      continue;
    }
    const words = line.split(/\s+/);
    let current = "";
    for (const word of words) {
      if (!current) current = word;
      else if (current.length + 1 + word.length <= 26) current += ` ${word}`;
      else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  const longest = Math.max(2, ...lines.map((l) => l.length));
  const w = Math.round(Math.min(216, Math.max(48, longest * 7.2 + 22)));
  const h = Math.round(Math.max(24, lines.length * 16 + 10));
  return { w, h };
}

export function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  pad = 0,
): boolean {
  return (
    a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y
  );
}

function overlapArea(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ox * oy;
}

export function segmentHitsRect(
  a: GeometryPoint,
  b: GeometryPoint,
  rect: { x: number; y: number; w: number; h: number },
  inset = 4,
): boolean {
  const rx1 = rect.x + inset;
  const ry1 = rect.y + inset;
  const rx2 = rect.x + rect.w - inset;
  const ry2 = rect.y + rect.h - inset;
  if (rx2 <= rx1 || ry2 <= ry1) return false;

  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  if (maxX <= rx1 || minX >= rx2 || maxY <= ry1 || minY >= ry2) return false;

  // Exact check for axis-aligned segments
  if (Math.abs(a.x - b.x) < 0.5) {
    return a.x > rx1 && a.x < rx2 && maxY > ry1 && minY < ry2;
  }
  if (Math.abs(a.y - b.y) < 0.5) {
    return a.y > ry1 && a.y < ry2 && maxX > rx1 && minX < rx2;
  }

  for (let step = 1; step < 12; step++) {
    const t = step / 12;
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    if (px > rx1 && px < rx2 && py > ry1 && py < ry2) return true;
  }
  return false;
}

/** Exact boundary point on a shape's side at fraction `t` in [0..1] (0.5 = centre of side). */
export function portPointOnShape(item: GeometryItem, side: PortSide, t = 0.5): GeometryPoint {
  const clamped = Math.min(0.82, Math.max(0.18, t));
  const { x, y, w, h, kind } = item;

  if (kind === "diamond") {
    if (side === "left" || side === "right") {
      const py = y + h * clamped;
      const dyNorm = Math.abs(clamped - 0.5) * 2;
      const insetX = (w / 2) * dyNorm;
      return { x: side === "right" ? x + w - insetX : x + insetX, y: py };
    }
    const px = x + w * clamped;
    const dxNorm = Math.abs(clamped - 0.5) * 2;
    const insetY = (h / 2) * dxNorm;
    return { x: px, y: side === "bottom" ? y + h - insetY : y + insetY };
  }

  if (kind === "ellipse") {
    const rx = w / 2;
    const ry = h / 2;
    const cx = x + rx;
    const cy = y + ry;
    if (side === "left" || side === "right") {
      const py = y + h * clamped;
      const norm = Math.min(0.96, Math.abs((py - cy) / (ry || 1)));
      const dx = rx * Math.sqrt(Math.max(0, 1 - norm * norm));
      return { x: side === "right" ? cx + dx : cx - dx, y: py };
    }
    const px = x + w * clamped;
    const norm = Math.min(0.96, Math.abs((px - cx) / (rx || 1)));
    const dy = ry * Math.sqrt(Math.max(0, 1 - norm * norm));
    return { x: px, y: side === "bottom" ? cy + dy : cy - dy };
  }

  if (side === "left") return { x, y: y + h * clamped };
  if (side === "right") return { x: x + w, y: y + h * clamped };
  if (side === "top") return { x: x + w * clamped, y };
  return { x: x + w * clamped, y: y + h };
}

function stepFromPort(pt: GeometryPoint, side: PortSide, dist: number): GeometryPoint {
  if (side === "left") return { x: pt.x - dist, y: pt.y };
  if (side === "right") return { x: pt.x + dist, y: pt.y };
  if (side === "top") return { x: pt.x, y: pt.y - dist };
  return { x: pt.x, y: pt.y + dist };
}

function chooseSides(
  a: GeometryItem,
  b: GeometryItem,
  obstacles: readonly GeometryItem[],
): { startSide: PortSide; endSide: PortSide } {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;

  const clearVerticalGap = a.y + a.h + 24 <= b.y || b.y + b.h + 24 <= a.y;
  const clearHorizontalGap = a.x + a.w + 24 <= b.x || b.x + b.w + 24 <= a.x;

  // Prefer horizontal left<->right ports whenever there is a clean horizontal gap,
  // unless target is backwards to the left across a vertical row break.
  if (clearHorizontalGap && !(clearVerticalGap && dx < -40)) {
    const right = dx >= 0;
    const probeStart = right ? { x: a.x + a.w, y: ac.y } : { x: a.x, y: ac.y };
    const probeEnd = right ? { x: b.x, y: bc.y } : { x: b.x + b.w, y: bc.y };
    const midX = (probeStart.x + probeEnd.x) / 2;
    const blockedHorizontally = obstacles.some(
      (obs) =>
        obs.id !== a.id &&
        obs.id !== b.id &&
        (segmentHitsRect(probeStart, { x: midX, y: probeStart.y }, obs, -2) ||
          segmentHitsRect({ x: midX, y: probeEnd.y }, probeEnd, obs, -2)),
    );
    if (!blockedHorizontally) {
      return right
        ? { startSide: "right", endSide: "left" }
        : { startSide: "left", endSide: "right" };
    }
    if (!clearVerticalGap) {
      return dy < -20
        ? { startSide: "top", endSide: "top" }
        : { startSide: "bottom", endSide: "bottom" };
    }
  }

  if (clearVerticalGap) {
    // Check whether entering vertically on target b (`top` or `bottom`) is blocked by another shape stacked above/below b!
    const down = dy >= 0;
    const vEntry = down ? { x: bc.x, y: b.y - 26 } : { x: bc.x, y: b.y + b.h + 26 };
    const vTargetBlocked = obstacles.some(
      (obs) =>
        obs.id !== a.id &&
        obs.id !== b.id &&
        segmentHitsRect(vEntry, { x: bc.x, y: down ? b.y : b.y + b.h }, obs, -4),
    );
    if (vTargetBlocked) {
      // Enter cleanly from the exposed outer horizontal side (left or right) via a 2-bend alley!
      const blockedLeft = obstacles.some(
        (obs) =>
          obs.id !== a.id &&
          obs.id !== b.id &&
          segmentHitsRect({ x: b.x - 40, y: bc.y }, { x: b.x, y: bc.y }, obs, -4),
      );
      return {
        startSide: down ? "bottom" : "top",
        endSide: !blockedLeft ? "left" : "right",
      };
    }
    return down ? { startSide: "bottom", endSide: "top" } : { startSide: "top", endSide: "bottom" };
  }

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { startSide: "right", endSide: "left" }
      : { startSide: "left", endSide: "right" };
  }
  return dy >= 0
    ? { startSide: "bottom", endSide: "top" }
    : { startSide: "top", endSide: "bottom" };
}

function simplifyOrthogonal(pts: GeometryPoint[]): GeometryPoint[] {
  const dedup: GeometryPoint[] = [];
  for (const p of pts) {
    const prev = dedup[dedup.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) >= 0.5) {
      dedup.push({ x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 });
    }
  }
  if (dedup.length <= 2) return dedup;
  const out: GeometryPoint[] = [dedup[0]!];
  for (let i = 1; i < dedup.length - 1; i++) {
    const prev = out[out.length - 1]!;
    const curr = dedup[i]!;
    const next = dedup[i + 1]!;
    const collinearX = Math.abs(prev.x - curr.x) < 0.5 && Math.abs(curr.x - next.x) < 0.5;
    const collinearY = Math.abs(prev.y - curr.y) < 0.5 && Math.abs(curr.y - next.y) < 0.5;
    if (!collinearX && !collinearY) out.push(curr);
  }
  out.push(dedup[dedup.length - 1]!);
  return out;
}

function buildCandidates(
  start: GeometryPoint,
  finish: GeometryPoint,
  startSide: PortSide,
  endSide: PortSide,
  obstacles: readonly GeometryItem[],
  sections: readonly GeometryItem[],
): GeometryPoint[][] {
  const STUB = 22;
  const sOut = stepFromPort(start, startSide, STUB);
  const fOut = stepFromPort(finish, endSide, STUB);
  const candidates: GeometryPoint[][] = [];

  const sHoriz = startSide === "left" || startSide === "right";
  const fHoriz = endSide === "left" || endSide === "right";

  if (sHoriz && fHoriz) {
    if (
      Math.abs(start.y - finish.y) <= 4 &&
      ((startSide === "right" && endSide === "left" && finish.x > start.x + 12) ||
        (startSide === "left" && endSide === "right" && finish.x < start.x - 12))
    ) {
      candidates.push([start, finish]);
    }
    const midXs = new Set<number>([Math.round((sOut.x + fOut.x) / 2)]);
    for (const sec of sections) {
      midXs.add(Math.round(sec.x - 28));
      midXs.add(Math.round(sec.x + sec.w + 28));
    }
    for (const obs of obstacles) {
      midXs.add(Math.round(obs.x - 24));
      midXs.add(Math.round(obs.x + obs.w + 24));
    }
    for (const mx of midXs) {
      if (startSide === "right" && mx < sOut.x - 2) continue;
      if (startSide === "left" && mx > sOut.x + 2) continue;
      if (endSide === "left" && mx > fOut.x + 2) continue;
      if (endSide === "right" && mx < fOut.x - 2) continue;
      candidates.push([start, { x: mx, y: start.y }, { x: mx, y: finish.y }, finish]);
    }
    // Detour alleys above or below local band
    const minBandY = Math.min(start.y, finish.y) - 90;
    const maxBandY = Math.max(start.y, finish.y) + 90;
    const localObs = obstacles.filter((o) => o.y + o.h >= minBandY && o.y <= maxBandY);
    const topAlley = Math.min(start.y, finish.y, ...localObs.map((o) => o.y)) - 32;
    const bottomAlley = Math.max(start.y, finish.y, ...localObs.map((o) => o.y + o.h)) + 32;
    for (const ay of [bottomAlley, topAlley]) {
      candidates.push([start, sOut, { x: sOut.x, y: ay }, { x: fOut.x, y: ay }, fOut, finish]);
    }
  } else if (!sHoriz && !fHoriz) {
    if (
      Math.abs(start.x - finish.x) <= 4 &&
      ((startSide === "bottom" && endSide === "top" && finish.y > start.y + 12) ||
        (startSide === "top" && endSide === "bottom" && finish.y < start.y - 12))
    ) {
      candidates.push([start, finish]);
    }
    const midYs = new Set<number>([Math.round((sOut.y + fOut.y) / 2)]);
    for (const sec of sections) {
      midYs.add(Math.round(sec.y - 28));
      midYs.add(Math.round(sec.y + sec.h + 28));
    }
    for (const obs of obstacles) {
      midYs.add(Math.round(obs.y - 24));
      midYs.add(Math.round(obs.y + obs.h + 24));
    }
    for (const my of midYs) {
      if (startSide === "bottom" && my < sOut.y - 2) continue;
      if (startSide === "top" && my > sOut.y + 2) continue;
      if (endSide === "top" && my > fOut.y + 2) continue;
      if (endSide === "bottom" && my < fOut.y - 2) continue;
      candidates.push([start, { x: start.x, y: my }, { x: finish.x, y: my }, finish]);
    }
    const minBandX = Math.min(start.x, finish.x) - 90;
    const maxBandX = Math.max(start.x, finish.x) + 90;
    const localObs = obstacles.filter((o) => o.x + o.w >= minBandX && o.x <= maxBandX);
    const leftAlley = Math.min(start.x, finish.x, ...localObs.map((o) => o.x)) - 32;
    const rightAlley = Math.max(start.x, finish.x, ...localObs.map((o) => o.x + o.w)) + 32;
    for (const ax of [rightAlley, leftAlley]) {
      candidates.push([start, sOut, { x: ax, y: sOut.y }, { x: ax, y: fOut.y }, fOut, finish]);
    }
  } else if (sHoriz && !fHoriz) {
    // L-bend or 3-segment bend
    const cornerOk =
      ((startSide === "right" && finish.x >= sOut.x) ||
        (startSide === "left" && finish.x <= sOut.x)) &&
      ((endSide === "top" && start.y <= fOut.y) || (endSide === "bottom" && start.y >= fOut.y));
    if (cornerOk) {
      candidates.push([start, { x: finish.x, y: start.y }, finish]);
    }
    candidates.push([start, sOut, { x: sOut.x, y: fOut.y }, fOut, finish]);
    candidates.push([start, { x: sOut.x, y: start.y }, { x: finish.x, y: start.y }, finish]);
  } else {
    const cornerOk =
      ((startSide === "bottom" && finish.y >= sOut.y) ||
        (startSide === "top" && finish.y <= sOut.y)) &&
      ((endSide === "left" && start.x <= fOut.x) || (endSide === "right" && start.x >= fOut.x));
    if (cornerOk) {
      candidates.push([start, { x: start.x, y: finish.y }, finish]);
    }
    candidates.push([start, sOut, { x: fOut.x, y: sOut.y }, fOut, finish]);
    candidates.push([start, { x: start.x, y: sOut.y }, { x: start.x, y: finish.y }, finish]);
    // Outer margin / section-alley channels so vertical-to-horizontal bends never graze section borders
    const alleyYs = new Set<number>();
    for (const sec of sections) {
      alleyYs.add(Math.round(sec.y - 36));
      alleyYs.add(Math.round(sec.y + sec.h + 36));
    }
    const alleyXs = new Set<number>([Math.round(fOut.x)]);
    for (const sec of sections) {
      alleyXs.add(Math.round(sec.x - 24));
      alleyXs.add(Math.round(sec.x + sec.w + 24));
    }
    for (const ay of alleyYs) {
      if (startSide === "bottom" && ay < sOut.y) continue;
      if (startSide === "top" && ay > sOut.y) continue;
      for (const ax of alleyXs) {
        if (endSide === "left" && ax > fOut.x + 2) continue;
        if (endSide === "right" && ax < fOut.x - 2) continue;
        candidates.push([
          start,
          { x: start.x, y: ay },
          { x: ax, y: ay },
          { x: ax, y: finish.y },
          finish,
        ]);
      }
    }
  }

  return candidates.map(simplifyOrthogonal).filter((pts) => pts.length >= 2);
}

function scoreCandidate(
  pts: GeometryPoint[],
  fromId: string | undefined,
  toId: string | undefined,
  fromSecId: string | undefined,
  toSecId: string | undefined,
  obstacles: readonly GeometryItem[],
  sections: readonly GeometryItem[],
): number {
  let score = 0;
  let length = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    length += Math.hypot(b.x - a.x, b.y - a.y);
    for (const obs of obstacles) {
      if (obs.id === fromId || obs.id === toId) continue;
      if (segmentHitsRect(a, b, obs, -8)) score += 120_000;
    }
    for (const sec of sections) {
      // Avoid slicing across a section's 48px title header band
      const headerRect = { x: sec.x + 8, y: sec.y + 4, w: Math.max(20, sec.w - 16), h: 44 };
      if (segmentHitsRect(a, b, headerRect, 0)) score += 35_000;
      // Avoid routing through a completely unrelated section
      if (sec.id !== fromSecId && sec.id !== toSecId && segmentHitsRect(a, b, sec, 6)) {
        score += 18_000;
      }
      // Avoid running collinearly right along a section border stroke
      if (Math.abs(a.x - b.x) < 0.5) {
        if (Math.abs(a.x - sec.x) < 12 || Math.abs(a.x - (sec.x + sec.w)) < 12) score += 6_000;
      }
      if (Math.abs(a.y - b.y) < 0.5) {
        if (Math.abs(a.y - sec.y) < 12 || Math.abs(a.y - (sec.y + sec.h)) < 12) score += 6_000;
      }
    }
  }
  const bends = Math.max(0, pts.length - 2);
  return score + bends * 130 + length;
}

function separateParallelChannels(routed: RoutedArrow[], obstacles: readonly GeometryItem[]): void {
  const TRACK_GAP = 14;

  // Vertical interior segments
  type SegRef = { arrowIdx: number; segIdx: number; coord: number; min: number; max: number };
  const vSegs: SegRef[] = [];
  const hSegs: SegRef[] = [];

  routed.forEach((arrow, arrowIdx) => {
    const pts = arrow.points;
    for (let i = 1; i < pts.length - 2; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 12) {
        vSegs.push({
          arrowIdx,
          segIdx: i,
          coord: a.x,
          min: Math.min(a.y, b.y),
          max: Math.max(a.y, b.y),
        });
      } else if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 12) {
        hSegs.push({
          arrowIdx,
          segIdx: i,
          coord: a.y,
          min: Math.min(a.x, b.x),
          max: Math.max(a.x, b.x),
        });
      }
    }
  });

  const spreadGroup = (segs: SegRef[], vertical: boolean) => {
    const used = new Set<number>();
    for (let i = 0; i < segs.length; i++) {
      if (used.has(i)) continue;
      const base = segs[i]!;
      const cluster = [i];
      used.add(i);
      for (let j = i + 1; j < segs.length; j++) {
        if (used.has(j)) continue;
        const other = segs[j]!;
        const closeCoord = Math.abs(other.coord - base.coord) < TRACK_GAP;
        const spanOverlap = Math.min(base.max, other.max) - Math.max(base.min, other.min) > 8;
        if (closeCoord && spanOverlap) {
          cluster.push(j);
          used.add(j);
        }
      }
      if (cluster.length < 2) continue;
      cluster.sort((ia, ib) => segs[ia]!.min - segs[ib]!.min || ia - ib);
      const mean = cluster.reduce((sum, idx) => sum + segs[idx]!.coord, 0) / cluster.length;
      cluster.forEach((segIndex, rank) => {
        const ref = segs[segIndex]!;
        const shifted = Math.round(mean + (rank - (cluster.length - 1) / 2) * TRACK_GAP);
        const pts = routed[ref.arrowIdx]!.points;
        const p1 = vertical
          ? { x: shifted, y: pts[ref.segIdx]!.y }
          : { x: pts[ref.segIdx]!.x, y: shifted };
        const p2 = vertical
          ? { x: shifted, y: pts[ref.segIdx + 1]!.y }
          : { x: pts[ref.segIdx + 1]!.x, y: shifted };
        const hitsObs = obstacles.some((obs) => segmentHitsRect(p1, p2, obs, -2));
        if (!hitsObs) {
          pts[ref.segIdx] = p1;
          pts[ref.segIdx + 1] = p2;
        }
      });
    }
  };

  spreadGroup(vSegs, true);
  spreadGroup(hSegs, false);
}

function placeLabelsNonOverlapping(
  routed: RoutedArrow[],
  arrowsById: ReadonlyMap<string, GeometryItem>,
  obstacles: readonly GeometryItem[],
  sections: readonly GeometryItem[],
): void {
  const placedLabels: Array<{ x: number; y: number; w: number; h: number }> = [];

  for (const r of routed) {
    const item = arrowsById.get(r.id);
    const size = measureArrowLabel(item?.text);
    if (!size || r.points.length < 2) continue;

    // Rank segments longest-first so labels prefer roomy segments
    const segOrder = Array.from({ length: r.points.length - 1 }, (_, idx) => {
      const a = r.points[idx]!;
      const b = r.points[idx + 1]!;
      return { idx, a, b, len: Math.hypot(b.x - a.x, b.y - a.y) };
    }).sort((x, y) => y.len - x.len);

    let bestBox: { x: number; y: number; w: number; h: number } | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const seg of segOrder) {
      if (seg.len < 16 && segOrder[0]!.len >= 16) continue;
      const horiz = Math.abs(seg.a.y - seg.b.y) <= Math.abs(seg.a.x - seg.b.x);
      for (const t of [0.5, 0.36, 0.64, 0.24, 0.76]) {
        const bx = seg.a.x + (seg.b.x - seg.a.x) * t;
        const by = seg.a.y + (seg.b.y - seg.a.y) * t;
        for (const nudge of [0, -18, 18, -32, 32]) {
          const cx = horiz ? bx : bx + nudge;
          const cy = horiz ? by + nudge : by;
          const box = {
            x: Math.round(cx - size.w / 2),
            y: Math.round(cy - size.h / 2),
            w: size.w,
            h: size.h,
          };

          let penalty = Math.abs(t - 0.5) * 90 + Math.abs(nudge) * 3;
          if (seg.idx !== segOrder[0]!.idx) penalty += 140;

          for (const obs of obstacles) {
            if (rectsOverlap(box, obs, 4)) {
              penalty += 60_000 + overlapArea(box, obs) * 10;
            }
          }
          for (const sec of sections) {
            const header = { x: sec.x, y: sec.y, w: sec.w, h: 50 };
            if (rectsOverlap(box, header, 2)) penalty += 35_000;
          }
          for (const other of placedLabels) {
            if (rectsOverlap(box, other, 6)) {
              penalty += 120_000 + overlapArea(box, other) * 20;
            }
          }
          for (const otherArrow of routed) {
            if (otherArrow.id === r.id) continue;
            for (let k = 0; k < otherArrow.points.length - 1; k++) {
              if (segmentHitsRect(otherArrow.points[k]!, otherArrow.points[k + 1]!, box, -2)) {
                penalty += 3_500;
              }
            }
          }

          if (penalty < bestScore) {
            bestScore = penalty;
            bestBox = box;
          }
        }
      }
    }

    if (bestBox) {
      // Final hard guarantee: if in an ultra-dense cluster it still touches a previous label, shift down cleanly
      let guard = 0;
      while (placedLabels.some((prev) => rectsOverlap(bestBox!, prev, 4)) && guard < 8) {
        bestBox = { ...bestBox, y: bestBox.y + size.h + 6 };
        guard++;
      }
      r.label = bestBox;
      placedLabels.push(bestBox);
    }
  }
}

/**
 * Computes multi-port, obstacle-avoiding, parallel-channel-separated orthogonal arrow paths and
 * non-overlapping label pills for every arrow on a board.
 */
export function computeBoardArrows(items: readonly GeometryItem[]): Map<string, RoutedArrow> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const obstacles = items.filter((item) => OBSTACLE_KINDS.has(item.kind));
  const sections = items.filter((item) => item.kind === "section");
  const arrows = items.filter((item) => item.kind === "arrow");
  const arrowsById = new Map(arrows.map((a) => [a.id, a]));

  type EndpointPort = {
    arrowId: string;
    which: "from" | "to";
    itemId: string;
    side: PortSide;
    sortCoord: number;
  };
  const portRequests = new Map<string, EndpointPort[]>();
  const chosenSides = new Map<string, { startSide: PortSide; endSide: PortSide }>();

  for (const arrow of arrows) {
    const aItem = arrow.from && !isPoint(arrow.from) ? byId.get(arrow.from.item) : undefined;
    const bItem = arrow.to && !isPoint(arrow.to) ? byId.get(arrow.to.item) : undefined;
    if (aItem && bItem) {
      const sides = chooseSides(aItem, bItem, obstacles);
      chosenSides.set(arrow.id, sides);
      const ac = { x: aItem.x + aItem.w / 2, y: aItem.y + aItem.h / 2 };
      const bc = { x: bItem.x + bItem.w / 2, y: bItem.y + bItem.h / 2 };
      const addReq = (
        which: "from" | "to",
        item: GeometryItem,
        side: PortSide,
        other: GeometryPoint,
      ) => {
        const key = `${item.id}:${side}`;
        const list = portRequests.get(key) ?? [];
        list.push({
          arrowId: arrow.id,
          which,
          itemId: item.id,
          side,
          sortCoord: side === "left" || side === "right" ? other.y : other.x,
        });
        portRequests.set(key, list);
      };
      addReq("from", aItem, sides.startSide, bc);
      addReq("to", bItem, sides.endSide, ac);
    }
  }

  // Resolve distributed port coordinates so multiple arrows on one side never share the same pixel
  const portCoords = new Map<string, GeometryPoint>();
  for (const [, list] of portRequests) {
    list.sort((x, y) => x.sortCoord - y.sortCoord || x.arrowId.localeCompare(y.arrowId));
    const count = list.length;
    list.forEach((req, index) => {
      const target = byId.get(req.itemId);
      if (!target) return;
      const t = count === 1 ? 0.5 : 0.24 + (0.52 * index) / (count - 1);
      portCoords.set(`${req.arrowId}:${req.which}`, portPointOnShape(target, req.side, t));
    });
  }

  const routedList: RoutedArrow[] = [];
  for (const arrow of arrows) {
    const aItem = arrow.from && !isPoint(arrow.from) ? byId.get(arrow.from.item) : undefined;
    const bItem = arrow.to && !isPoint(arrow.to) ? byId.get(arrow.to.item) : undefined;

    if (aItem && bItem) {
      const sides = chosenSides.get(arrow.id)!;
      const start =
        portCoords.get(`${arrow.id}:from`) ?? portPointOnShape(aItem, sides.startSide, 0.5);
      const finish =
        portCoords.get(`${arrow.id}:to`) ?? portPointOnShape(bItem, sides.endSide, 0.5);
      const candidates = buildCandidates(
        start,
        finish,
        sides.startSide,
        sides.endSide,
        obstacles,
        sections,
      );
      let best = candidates[0] ?? [start, finish];
      let bestCost = Number.POSITIVE_INFINITY;
      for (const cand of candidates) {
        const cost = scoreCandidate(
          cand,
          aItem.id,
          bItem.id,
          aItem.section,
          bItem.section,
          obstacles,
          sections,
        );
        if (cost < bestCost) {
          bestCost = cost;
          best = cand;
        }
      }
      routedList.push({
        id: arrow.id,
        points: best,
        startSide: sides.startSide,
        endSide: sides.endSide,
      });
      continue;
    }

    // Point-to-item or point-to-point arrow (including live drag preview)
    const freePoint = (
      end: GeometryEnd | undefined,
      toward: GeometryPoint,
    ): GeometryPoint | null => {
      if (!end) return null;
      if (isPoint(end)) return end;
      const item = byId.get(end.item);
      if (!item) return null;
      const cx = item.x + item.w / 2;
      const cy = item.y + item.h / 2;
      const dx = toward.x - cx;
      const dy = toward.y - cy;
      const side: PortSide =
        Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "bottom" : "top";
      return portPointOnShape(item, side, 0.5);
    };
    const guessA = isPoint(arrow.from)
      ? arrow.from
      : aItem
        ? { x: aItem.x + aItem.w / 2, y: aItem.y + aItem.h / 2 }
        : null;
    const guessB = isPoint(arrow.to)
      ? arrow.to
      : bItem
        ? { x: bItem.x + bItem.w / 2, y: bItem.y + bItem.h / 2 }
        : null;
    if (!guessA || !guessB) continue;
    const pA = freePoint(arrow.from, guessB);
    const pB = freePoint(arrow.to, guessA);
    if (pA && pB) {
      routedList.push({ id: arrow.id, points: [pA, pB] });
    }
  }

  separateParallelChannels(routedList, obstacles);
  placeLabelsNonOverlapping(routedList, arrowsById, obstacles, sections);

  return new Map(routedList.map((r) => [r.id, r]));
}

export function roundedOrthogonalPath(rawPoints: GeometryPoint[], radius = 12): string {
  const points: GeometryPoint[] = [];
  for (const pt of rawPoints) {
    const prev = points[points.length - 1];
    if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) >= 1) {
      points.push(pt);
    }
  }
  if (points.length < 2) {
    if (rawPoints.length >= 2) {
      return `M${rawPoints[0]!.x},${rawPoints[0]!.y} L${rawPoints[rawPoints.length - 1]!.x},${rawPoints[rawPoints.length - 1]!.y}`;
    }
    return "";
  }
  if (points.length === 2) {
    return `M${points[0]!.x},${points[0]!.y} L${points[1]!.x},${points[1]!.y}`;
  }
  let d = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const next = points[i + 1]!;
    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const v2 = { x: next.x - curr.x, y: next.y - curr.y };
    const len1 = Math.hypot(v1.x, v1.y);
    const len2 = Math.hypot(v2.x, v2.y);
    const r = Math.min(radius, len1 / 2, len2 / 2);
    if (r < 2) {
      d += ` L${curr.x},${curr.y}`;
      continue;
    }
    const pStart = { x: curr.x - (v1.x / len1) * r, y: curr.y - (v1.y / len1) * r };
    const pEnd = { x: curr.x + (v2.x / len2) * r, y: curr.y + (v2.y / len2) * r };
    d += ` L${pStart.x},${pStart.y} Q${curr.x},${curr.y} ${pEnd.x},${pEnd.y}`;
  }
  const last = points[points.length - 1]!;
  d += ` L${last.x},${last.y}`;
  return d;
}
