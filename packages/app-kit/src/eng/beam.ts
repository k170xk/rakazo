import { linspace, luDecompose, luSolve } from "./numeric.js";

/**
 * Straight prismatic beam analysis (Euler–Bernoulli, small deflections) by the stiffness method.
 * Units: lengths m, forces kN (downward loads positive), moments kNm, EI kN·m², deflection mm.
 * Reactions and nodal deflections are exact (consistent nodal loads); shear and moment come from
 * statics at every station, so diagrams and maxima match hand calculations.
 */

export type SupportType = "pin" | "roller" | "fixed";
export type Support = { x: number; type: SupportType };

export type Load =
  /** Point load P (kN, downward positive) at x. */
  | { type: "point"; x: number; P: number }
  /** Uniform load w (kN/m, downward positive) from `from` to `to` (default the whole beam). */
  | { type: "udl"; w: number; from?: number; to?: number }
  /** Load varying linearly from w1 at `from` to w2 at `to` (kN/m, downward positive). */
  | { type: "linear"; w1: number; w2: number; from: number; to: number }
  /** Applied couple M (kNm, clockwise positive) at x. */
  | { type: "moment"; x: number; M: number };

export type BeamInput = {
  length: number;
  supports: Support[];
  loads: Load[];
  /** Flexural rigidity, kN·m². Without it deflections are not worked out (reactions do not need it for a uniform beam). */
  EI?: number;
  /** Evenly spaced segments for the diagrams (default 100). */
  segments?: number;
};

/** A reaction on the beam: V upward positive (kN); M anticlockwise positive (kNm), fixed supports only. */
export type Reaction = { x: number; type: SupportType; V: number; M: number };
export type Extreme = { value: number; x: number };

export type BeamResult = {
  /** Stations along the beam (m); a station repeats where shear or moment jumps, left value first. */
  x: number[];
  /** Shear force (kN): the sum of upward forces to the left of the section. */
  shear: number[];
  /** Bending moment (kNm), sagging positive. */
  moment: number[];
  /** Vertical deflection (mm), upward positive, or null without EI. */
  deflection: number[] | null;
  reactions: Reaction[];
  max: { shear: Extreme; sagging: Extreme; hogging: Extreme; deflection: Extreme | null };
};

type Span = { from: number; to: number; w1: number; w2: number };

const spanOf = (load: Load, length: number): Span | null => {
  if (load.type === "udl")
    return { from: load.from ?? 0, to: load.to ?? length, w1: load.w, w2: load.w };
  if (load.type === "linear") return { from: load.from, to: load.to, w1: load.w1, w2: load.w2 };
  return null;
};

/** Intensity of a distributed load at s (kN/m). */
const intensity = (span: Span, s: number) =>
  span.to === span.from
    ? span.w1
    : span.w1 + ((span.w2 - span.w1) * (s - span.from)) / (span.to - span.from);

function solveFe(input: BeamInput, nodes: number[], spans: Span[]) {
  const n = nodes.length;
  const size = 2 * n;
  const EI = input.EI ?? 1;
  const K: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const F = new Array<number>(size).fill(0);
  const index = new Map(nodes.map((x, i) => [x, i]));
  for (let e = 0; e < n - 1; e++) {
    const l = nodes[e + 1]! - nodes[e]!;
    const k = EI / l ** 3;
    const local = [
      [12, 6 * l, -12, 6 * l],
      [6 * l, 4 * l * l, -6 * l, 2 * l * l],
      [-12, -6 * l, 12, -6 * l],
      [6 * l, 2 * l * l, -6 * l, 4 * l * l],
    ];
    const dofs = [2 * e, 2 * e + 1, 2 * e + 2, 2 * e + 3];
    for (let a = 0; a < 4; a++)
      for (let b = 0; b < 4; b++) K[dofs[a]!]![dofs[b]!]! += k * local[a]![b]!;
    const mid = (nodes[e]! + nodes[e + 1]!) / 2;
    for (const span of spans) {
      if (mid <= span.from || mid >= span.to) continue;
      const w1 = intensity(span, nodes[e]!);
      const w2 = intensity(span, nodes[e + 1]!);
      F[2 * e]! -= (l * (7 * w1 + 3 * w2)) / 20;
      F[2 * e + 1]! -= (l * l * (3 * w1 + 2 * w2)) / 60;
      F[2 * e + 2]! -= (l * (3 * w1 + 7 * w2)) / 20;
      F[2 * e + 3]! += (l * l * (2 * w1 + 3 * w2)) / 60;
    }
  }
  for (const load of input.loads) {
    if (load.type === "point") F[2 * index.get(load.x)!]! -= load.P;
    if (load.type === "moment") F[2 * index.get(load.x)! + 1]! -= load.M;
  }
  const fixed = new Set<number>();
  for (const support of input.supports) {
    const i = index.get(support.x)!;
    fixed.add(2 * i);
    if (support.type === "fixed") fixed.add(2 * i + 1);
  }
  const free = Array.from({ length: size }, (_, i) => i).filter((i) => !fixed.has(i));
  let lu: ReturnType<typeof luDecompose>;
  try {
    lu = luDecompose(free.map((i) => free.map((j) => K[i]![j]!)));
  } catch {
    throw new Error("The beam is unstable: add or fix supports.");
  }
  const solved = luSolve(
    lu,
    free.map((i) => F[i]!),
  );
  const u = new Array<number>(size).fill(0);
  free.forEach((dof, k) => {
    u[dof] = solved[k]!;
  });
  const reactionAt = (dof: number) =>
    K[dof]!.reduce((sum, kij, j) => sum + kij * u[j]!, 0) - F[dof]!;
  const reactions: Reaction[] = input.supports.map((support) => {
    const i = index.get(support.x)!;
    return {
      x: support.x,
      type: support.type,
      V: reactionAt(2 * i),
      M: support.type === "fixed" ? reactionAt(2 * i + 1) : 0,
    };
  });
  return { u, reactions };
}

/** Shear and moment at x from statics, counting what acts exactly at x only when `inclusive`. */
function sectionForces(
  x: number,
  inclusive: boolean,
  loads: Load[],
  spans: Span[],
  reactions: Reaction[],
) {
  let V = 0;
  let M = 0;
  const left = (at: number) => (inclusive ? at <= x : at < x);
  for (const r of reactions) {
    if (!left(r.x)) continue;
    V += r.V;
    M += r.V * (x - r.x) - r.M;
  }
  for (const load of loads) {
    if (load.type === "point" && left(load.x)) {
      V -= load.P;
      M -= load.P * (x - load.x);
    } else if (load.type === "moment" && left(load.x)) {
      M += load.M;
    }
  }
  for (const span of spans) {
    if (x <= span.from) continue;
    const t = Math.min(x, span.to) - span.from;
    const k = span.to === span.from ? 0 : (span.w2 - span.w1) / (span.to - span.from);
    const arm = x - span.from;
    V -= span.w1 * t + (k * t * t) / 2;
    M -= span.w1 * (arm * t - (t * t) / 2) + k * ((arm * t * t) / 2 - (t * t * t) / 3);
  }
  return { V, M };
}

function extreme(xs: number[], values: number[], pick: (a: number, b: number) => boolean): Extreme {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (pick(values[i]!, values[best]!)) best = i;
  return { value: values[best] ?? 0, x: xs[best] ?? 0 };
}

export function analyseBeam(input: BeamInput): BeamResult {
  const { length, supports, loads } = input;
  if (!(length > 0)) throw new Error("The beam needs a positive length.");
  if (!supports.length) throw new Error("The beam needs at least one support.");
  const inside = (x: number, what: string) => {
    if (!(x >= 0 && x <= length)) throw new Error(`${what} at ${x} m is off the ${length} m beam.`);
    return x;
  };
  const spans = loads.flatMap((load) => {
    const span = spanOf(load, length);
    if (!span) return [];
    inside(span.from, "A load start");
    inside(span.to, "A load end");
    return span.to > span.from ? [span] : [];
  });
  const keys = new Set<number>([0, length]);
  for (const support of supports) keys.add(inside(support.x, "A support"));
  for (const load of loads)
    if (load.type === "point" || load.type === "moment") keys.add(inside(load.x, "A load"));
  for (const span of spans) {
    keys.add(span.from);
    keys.add(span.to);
  }
  const keyNodes = [...keys].sort((a, b) => a - b);
  const { reactions } = solveFe(input, keyNodes, spans);
  const scale =
    loads.reduce(
      (sum, load) => sum + Math.abs("P" in load ? load.P : "M" in load ? load.M : 0),
      0,
    ) +
    spans.reduce(
      (sum, span) => sum + (Math.abs(span.w1) + Math.abs(span.w2)) * (span.to - span.from),
      0,
    ) +
    1;
  const tidy = (value: number) => (Math.abs(value) < scale * length * 1e-11 ? 0 : value);
  for (const r of reactions) {
    r.V = tidy(r.V);
    r.M = tidy(r.M);
  }

  // Moment peaks sit where shear crosses zero, so those points join the stations.
  const extra = linspace(0, length, (input.segments ?? 100) + 1);
  for (let i = 0; i < keyNodes.length - 1; i++) {
    const a = keyNodes[i]!;
    const b = keyNodes[i + 1]!;
    const shearAt = (x: number) => sectionForces(x, true, loads, spans, reactions).V;
    let lo = a + (b - a) * 1e-9;
    let hi = b - (b - a) * 1e-9;
    let flo = shearAt(lo);
    if (flo * shearAt(hi) >= 0) continue;
    for (let k = 0; k < 100 && hi - lo > length * 1e-13; k++) {
      const mid = (lo + hi) / 2;
      const fm = shearAt(mid);
      if (fm * flo > 0) {
        lo = mid;
        flo = fm;
      } else hi = mid;
    }
    extra.push((lo + hi) / 2);
  }
  // Stations a rounding error away from a key point would make a zero-length element.
  const gap = length * 1e-9;
  const nodes = [...keyNodes];
  for (const at of extra.sort((a, b) => a - b)) {
    if (!nodes.some((node) => Math.abs(node - at) < gap)) nodes.push(at);
  }
  nodes.sort((a, b) => a - b);
  const fe = input.EI ? solveFe(input, nodes, spans) : null;

  const x: number[] = [];
  const shear: number[] = [];
  const moment: number[] = [];
  const deflection: number[] = [];
  nodes.forEach((at, i) => {
    const before = sectionForces(at, false, loads, spans, reactions);
    const after = sectionForces(at, true, loads, spans, reactions);
    const v = fe ? fe.u[2 * i]! * 1000 : 0;
    const jump =
      Math.abs(before.V - after.V) > scale * 1e-12 || Math.abs(before.M - after.M) > scale * 1e-12;
    for (const forces of jump ? [before, after] : [after]) {
      x.push(at);
      shear.push(tidy(forces.V));
      moment.push(tidy(forces.M));
      deflection.push(v);
    }
  });
  const absMax = (a: number, b: number) => Math.abs(a) > Math.abs(b) + 1e-12;
  return {
    x,
    shear,
    moment,
    deflection: fe ? deflection : null,
    reactions,
    max: {
      shear: extreme(x, shear, absMax),
      sagging: extreme(x, moment, (a, b) => a > b + 1e-12),
      hogging: extreme(x, moment, (a, b) => a < b - 1e-12),
      deflection: fe ? extreme(x, deflection, absMax) : null,
    },
  };
}
