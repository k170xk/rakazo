/**
 * Cross-section shapes (dimensions in mm) and their elastic and plastic properties about the major
 * (x) axis. The same shapes feed SectionDrawing in @ocsc/plot, so the drawing and the numbers agree.
 */
export type Shape =
  | { type: "rect"; b: number; h: number }
  | { type: "circle"; d: number }
  | { type: "chs"; d: number; t: number }
  | { type: "rhs"; b: number; h: number; t: number }
  /** Doubly symmetric I or H section: overall depth h, flange width b, flange tf, web tw. */
  | { type: "i"; h: number; b: number; tf: number; tw: number }
  /** T section, flange at the top: overall depth h, flange width b, flange tf, web tw. */
  | { type: "t"; h: number; b: number; tf: number; tw: number };

export type SectionProps = {
  /** Area, mm². */
  A: number;
  /** Centroid from the bottom fibre, mm. */
  yc: number;
  /** Second moments of area, mm⁴. */
  Ix: number;
  Iy: number;
  /** Elastic moduli to the top and bottom fibres, mm³. */
  Zt: number;
  Zb: number;
  /** Plastic modulus about x, mm³. */
  Zp: number;
  /** Radii of gyration, mm. */
  rx: number;
  ry: number;
};

type Rect = { b: number; h: number; y: number };

/** Rectangles stacked up the section (b wide, h tall, bottom at y), centred on the y axis. */
function parts(shape: Shape): Rect[] {
  switch (shape.type) {
    case "rect":
      return [{ b: shape.b, h: shape.h, y: 0 }];
    case "i":
      return [
        { b: shape.b, h: shape.tf, y: 0 },
        { b: shape.tw, h: shape.h - 2 * shape.tf, y: shape.tf },
        { b: shape.b, h: shape.tf, y: shape.h - shape.tf },
      ];
    case "t":
      return [
        { b: shape.tw, h: shape.h - shape.tf, y: 0 },
        { b: shape.b, h: shape.tf, y: shape.h - shape.tf },
      ];
    default:
      return [];
  }
}

/** Depth of the section, mm. */
export function sectionDepth(shape: Shape): number {
  return shape.type === "circle" || shape.type === "chs" ? shape.d : shape.h;
}

/** Width of the section, mm. */
export function sectionWidth(shape: Shape): number {
  return shape.type === "circle" || shape.type === "chs" ? shape.d : shape.b;
}

/** Plastic modulus of stacked rectangles: the equal-area axis, then first moments either side. */
function plasticOf(rects: Rect[], area: number): number {
  let below = 0;
  let pna = 0;
  for (const r of rects) {
    if (below + r.b * r.h >= area / 2) {
      pna = r.y + (area / 2 - below) / r.b;
      break;
    }
    below += r.b * r.h;
  }
  let zp = 0;
  for (const r of rects) {
    const lowSpan = Math.max(0, Math.min(r.y + r.h, pna) - r.y);
    const highSpan = Math.max(0, r.y + r.h - Math.max(r.y, pna));
    zp += r.b * lowSpan * (pna - (r.y + lowSpan / 2));
    zp += r.b * highSpan * (Math.max(r.y, pna) + highSpan / 2 - pna);
  }
  return zp;
}

export function sectionProps(shape: Shape): SectionProps {
  let A: number;
  let yc: number;
  let Ix: number;
  let Iy: number;
  let Zp: number;
  const depth = sectionDepth(shape);
  if (shape.type === "circle" || shape.type === "chs") {
    const di = shape.type === "chs" ? shape.d - 2 * shape.t : 0;
    A = (Math.PI / 4) * (shape.d ** 2 - di ** 2);
    yc = shape.d / 2;
    Ix = (Math.PI / 64) * (shape.d ** 4 - di ** 4);
    Iy = Ix;
    Zp = (shape.d ** 3 - di ** 3) / 6;
  } else if (shape.type === "rhs") {
    const bi = shape.b - 2 * shape.t;
    const hi = shape.h - 2 * shape.t;
    A = shape.b * shape.h - bi * hi;
    yc = shape.h / 2;
    Ix = (shape.b * shape.h ** 3 - bi * hi ** 3) / 12;
    Iy = (shape.h * shape.b ** 3 - hi * bi ** 3) / 12;
    Zp = (shape.b * shape.h ** 2 - bi * hi ** 2) / 4;
  } else {
    const rects = parts(shape);
    A = rects.reduce((sum, r) => sum + r.b * r.h, 0);
    yc = rects.reduce((sum, r) => sum + r.b * r.h * (r.y + r.h / 2), 0) / A;
    Ix = rects.reduce((sum, r) => sum + (r.b * r.h ** 3) / 12 + r.b * r.h * (r.y + r.h / 2 - yc) ** 2, 0);
    Iy = rects.reduce((sum, r) => sum + (r.h * r.b ** 3) / 12, 0);
    Zp = plasticOf(rects, A);
  }
  return { A, yc, Ix, Iy, Zt: Ix / (depth - yc), Zb: Ix / yc, Zp, rx: Math.sqrt(Ix / A), ry: Math.sqrt(Iy / A) };
}

export type Bar = { x: number; y: number; d: number };

/**
 * n bars of diameter dia in one layer across a section b wide, with `cover` to the link and a
 * link of diameter `link`; y is the bar centre from the bottom (or, with top, from the top) fibre.
 */
export function barRow(
  { n, dia, b, h, cover, link = 0, top = false, layer = 0, gap }: { n: number; dia: number; b: number; h: number; cover: number; link?: number; top?: boolean; layer?: number; gap?: number },
): Bar[] {
  const edge = cover + link + dia / 2;
  const fromFace = edge + layer * (dia + (gap ?? Math.max(dia, 25)));
  const y = top ? h - fromFace : fromFace;
  const x0 = -b / 2 + edge;
  const span = b - 2 * edge;
  return Array.from({ length: n }, (_, i) => ({ x: n === 1 ? 0 : x0 + (span * i) / (n - 1), y, d: dia }));
}

/** Area of n bars of one diameter, mm². */
export const barArea = (n: number, dia: number) => (n * Math.PI * dia ** 2) / 4;
