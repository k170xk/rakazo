/** Deterministic numerical methods: fixed tolerances and iteration limits, no randomness. */

export type OutOfRange = "error" | "clamp" | "extrapolate";

function bracket(xs: readonly number[], x: number, outside: OutOfRange, what: string): [number, number] {
  const n = xs.length;
  if (n < 2) throw new Error(`${what} needs at least two points.`);
  for (let i = 1; i < n; i++) {
    if (!(xs[i]! > xs[i - 1]!)) throw new Error(`${what}: x values must increase.`);
  }
  if (x < xs[0]! || x > xs[n - 1]!) {
    if (outside === "error") throw new RangeError(`${what}: ${x} is outside ${xs[0]}–${xs[n - 1]}.`);
    if (outside === "clamp") return x < xs[0]! ? [0, 0] : [n - 2, 1];
    return x < xs[0]! ? [0, (x - xs[0]!) / (xs[1]! - xs[0]!)] : [n - 2, (x - xs[n - 2]!) / (xs[n - 1]! - xs[n - 2]!)];
  }
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= x) lo = mid;
    else hi = mid;
  }
  return [lo, (x - xs[lo]!) / (xs[lo + 1]! - xs[lo]!)];
}

/**
 * Linear interpolation in a table, as codes of practice intend between tabulated values.
 * Outside the table it throws unless `outside` is "clamp" (end values) or "extrapolate".
 */
export function interpolate(xs: readonly number[], ys: readonly number[], x: number, outside: OutOfRange = "error"): number {
  if (xs.length !== ys.length) throw new Error("interpolate: xs and ys differ in length.");
  const [i, t] = bracket(xs, x, outside, "interpolate");
  if (t === 0) return ys[i]!;
  if (t === 1) return ys[i + 1]!;
  return ys[i]! + t * (ys[i + 1]! - ys[i]!);
}

/** Bilinear interpolation in a two-way table: table[row for y][column for x]. */
export function interpolate2d(
  xs: readonly number[],
  ys: readonly number[],
  table: readonly (readonly number[])[],
  x: number,
  y: number,
  outside: OutOfRange = "error",
): number {
  if (table.length !== ys.length || table.some((row) => row.length !== xs.length)) {
    throw new Error("interpolate2d: the table must have one row per y and one column per x.");
  }
  const [j, u] = bracket(ys, y, outside, "interpolate2d (y)");
  const low = interpolate(xs, table[j]!, x, outside);
  if (u === 0) return low;
  const high = interpolate(xs, table[j + 1]!, x, outside);
  return low + u * (high - low);
}

/** n evenly spaced values from a to b inclusive. */
export function linspace(a: number, b: number, n: number): number[] {
  if (n < 2) return [a];
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? b : a + ((b - a) * i) / (n - 1)));
}

export type RootOptions = { tol?: number; maxIter?: number };

function signsDiffer(fa: number, fb: number, a: number, b: number) {
  if (Number.isNaN(fa) || Number.isNaN(fb)) throw new Error("The function is not a number at the bracket ends.");
  if (fa * fb > 0) throw new RangeError(`No sign change between ${a} and ${b}; the root is not bracketed.`);
}

/** Bisection: slow but certain once the root is bracketed. Stops when the bracket is narrower than tol. */
export function bisect(f: (x: number) => number, a: number, b: number, { tol = 1e-12, maxIter = 200 }: RootOptions = {}): number {
  let fa = f(a);
  const fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  signsDiffer(fa, fb, a, b);
  let lo = a;
  let hi = b;
  for (let i = 0; i < maxIter; i++) {
    const mid = lo + (hi - lo) / 2;
    const fm = f(mid);
    if (fm === 0 || Math.abs(hi - lo) / 2 < tol) return mid;
    if (fa * fm < 0) hi = mid;
    else {
      lo = mid;
      fa = fm;
    }
  }
  return lo + (hi - lo) / 2;
}

/** Brent's method (inverse quadratic interpolation with bisection fallback), as in Numerical Recipes. */
export function brent(f: (x: number) => number, a: number, b: number, { tol = 1e-12, maxIter = 200 }: RootOptions = {}): number {
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  signsDiffer(fa, fb, a, b);
  let c = b;
  let fc = fb;
  let d = b - a;
  let e = d;
  for (let i = 0; i < maxIter; i++) {
    if (fb * fc > 0) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0) return b;
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number;
      let qq: number;
      if (a === c) {
        p = 2 * xm * s;
        qq = 1 - s;
      } else {
        const qa = fa / fc;
        const r = fb / fc;
        p = s * (2 * xm * qa * (qa - r) - (b - a) * (r - 1));
        qq = (qa - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) qq = -qq;
      p = Math.abs(p);
      if (2 * p < Math.min(3 * xm * qq - Math.abs(tol1 * qq), Math.abs(e * qq))) {
        e = d;
        d = p / qq;
      } else {
        d = xm;
        e = d;
      }
    } else {
      d = xm;
      e = d;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol1 ? d : xm >= 0 ? tol1 : -tol1;
    fb = f(b);
  }
  return b;
}

/** Composite Simpson's rule with n intervals (rounded up to even). Exact for cubics. */
export function simpson(f: (x: number) => number, a: number, b: number, n = 200): number {
  const m = Math.max(2, n + (n % 2));
  const h = (b - a) / m;
  let sum = f(a) + f(b);
  for (let i = 1; i < m; i++) sum += f(a + i * h) * (i % 2 ? 4 : 2);
  return (sum * h) / 3;
}

/** Area under sampled points by the trapezoidal rule (xs need not be evenly spaced). */
export function trapz(xs: readonly number[], ys: readonly number[]): number {
  let area = 0;
  for (let i = 1; i < xs.length; i++) area += ((xs[i]! - xs[i - 1]!) * (ys[i]! + ys[i - 1]!)) / 2;
  return area;
}

export type Matrix = number[][];

export type LU = { lu: Matrix; perm: number[]; sign: number };

/** LU factorisation with partial pivoting (Doolittle). Throws when the matrix is singular. */
export function luDecompose(matrix: readonly (readonly number[])[]): LU {
  const n = matrix.length;
  const lu = matrix.map((row) => {
    if (row.length !== n) throw new Error("The matrix must be square.");
    return [...row];
  });
  const perm = Array.from({ length: n }, (_, i) => i);
  let sign = 1;
  const scale = Math.max(1, ...lu.map((row) => Math.max(...row.map(Math.abs))));
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(lu[i]![k]!) > Math.abs(lu[pivot]![k]!)) pivot = i;
    if (Math.abs(lu[pivot]![k]!) <= scale * 1e-13) throw new Error("The matrix is singular (a mechanism, or a missing support).");
    if (pivot !== k) {
      [lu[k], lu[pivot]] = [lu[pivot]!, lu[k]!];
      [perm[k], perm[pivot]] = [perm[pivot]!, perm[k]!];
      sign = -sign;
    }
    const rowK = lu[k]!;
    for (let i = k + 1; i < n; i++) {
      const row = lu[i]!;
      const factor = row[k]! / rowK[k]!;
      if (factor === 0) continue;
      row[k] = factor;
      for (let j = k + 1; j < n; j++) row[j]! -= factor * rowK[j]!;
    }
  }
  return { lu, perm, sign };
}

/** Solves A x = b from an LU factorisation. */
export function luSolve({ lu, perm }: LU, b: readonly number[]): number[] {
  const n = lu.length;
  const x = perm.map((i) => b[i]!);
  for (let i = 0; i < n; i++) {
    const row = lu[i]!;
    let sum = x[i]!;
    for (let j = 0; j < i; j++) sum -= row[j]! * x[j]!;
    x[i] = sum;
  }
  for (let i = n - 1; i >= 0; i--) {
    const row = lu[i]!;
    let sum = x[i]!;
    for (let j = i + 1; j < n; j++) sum -= row[j]! * x[j]!;
    x[i] = sum / row[i]!;
  }
  return x;
}

/** Solves the dense system A x = b by LU with partial pivoting. */
export const solve = (a: readonly (readonly number[])[], b: readonly number[]) => luSolve(luDecompose(a), b);

/** Determinant by LU (0 for a singular matrix). */
export function det(a: readonly (readonly number[])[]): number {
  try {
    const { lu, sign } = luDecompose(a);
    return lu.reduce((product, row, i) => product * row[i]!, sign);
  } catch {
    return 0;
  }
}
