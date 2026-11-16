import type { Context } from "../engine.js";
import type { Node } from "../parse.js";
import type { Scalar, Value } from "../values.js";
import { DIV0, Matrix, NA, NUM, parseNumber, REF, Ref, VALUE, XlError } from "../values.js";
import * as D from "./distributions.js";
import type { Fn } from "./helpers.js";
import {
  check,
  collect,
  collectValue,
  criterion,
  evaluate,
  flat,
  num,
  numeric,
  single,
} from "./helpers.js";
import { sum, sumAdjusted } from "./math.js";

export { erfc } from "./distributions.js";

const mean = (values: number[]) => sum(values) / values.length;

/** Sum of squared deviations, two passes like Excel, so large offsets keep their digits. */
function devsq(values: number[]): number {
  const m = mean(values);
  let total = 0;
  for (const value of values) total += (value - m) ** 2;
  return total;
}

/**
 * VAR and STDEV and their .S/.P forms use the one-pass (nΣx² − (Σx)²) / (n(n − d)) as Excel
 * does, to its last digit; the A forms (`twoPass`) take deviations from the mean instead.
 */
function variance(values: number[], sample: boolean, twoPass = false): Scalar {
  const n = values.length;
  if (n < (sample ? 2 : 1)) return DIV0;
  if (twoPass) return devsq(values) / (n - (sample ? 1 : 0));
  let total = 0;
  let squares = 0;
  for (const value of values) {
    total += value;
    squares += value * value;
  }
  return Math.max(0, n * squares - total * total) / (n * (n - (sample ? 1 : 0)));
}

function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

function percentileInc(values: number[], p: number): Scalar {
  if (!values.length || p < 0 || p > 1) return NUM;
  const s = sorted(values);
  const rank = p * (s.length - 1);
  const low = Math.floor(rank);
  const fraction = rank - low;
  if (low + 1 >= s.length) return s[low]!;
  return s[low]! + fraction * (s[low + 1]! - s[low]!);
}

function percentileExc(values: number[], p: number): Scalar {
  const n = values.length;
  if (!n || p <= 0 || p >= 1) return NUM;
  const rank = p * (n + 1);
  if (rank < 1 || rank > n) return NUM;
  const s = sorted(values);
  const low = Math.floor(rank);
  const fraction = rank - low;
  if (low >= n) return s[n - 1]!;
  return s[low - 1]! + fraction * (s[low]! - s[low - 1]!);
}

/** Runs `fn`, turning a thrown Excel error into the result. */
function attempt<T>(fn: () => T): T | XlError {
  try {
    return fn();
  } catch (error) {
    if (error instanceof XlError) return error;
    throw error;
  }
}

/** `fn` on one value, or on each element of an array argument, each element failing on its own. */
function each(value: Value, ctx: Context, fn: (x: Scalar) => Scalar): Value {
  return ctx.engine.lift1(value, ctx, (x) => attempt(() => fn(x)));
}

const isNullError = (value: Scalar) => value instanceof XlError && value.code === "#NULL!";

/** The first error in a list, passing over #NULL! as Excel's paired and test functions do. */
function firstError(items: Scalar[]): XlError | null {
  for (const item of items) if (item instanceof XlError && !isNullError(item)) return item;
  return null;
}

const numbersIn = (items: Scalar[]) =>
  items.filter((item): item is number => typeof item === "number");

/**
 * Paired numbers from two ranges of the same size, kept only where both cells hold numbers. The
 * first error in a pair wins, the first range's before the second's, and a pair whose first value
 * is #NULL! is passed over.
 */
function paired(first: Value, second: Value, ctx: Context): [number[], number[]] | XlError {
  const a = flat(first, ctx);
  const b = flat(second, ctx);
  if (a.length !== b.length) return NA;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = b[i]!;
    if (isNullError(p)) continue;
    if (p instanceof XlError) return p;
    if (q instanceof XlError) return q;
    if (typeof p === "number" && typeof q === "number") {
      xs.push(p);
      ys.push(q);
    }
  }
  return [xs, ys];
}

function pairs(args: Node[], ctx: Context): [number[], number[]] | XlError {
  return paired(evaluate(args[0]!, ctx), evaluate(args[1]!, ctx), ctx);
}

function regression(ys: number[], xs: number[]) {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return { mx, my, sxy, sxx, syy, n: xs.length };
}

function counted(
  args: Node[],
  ctx: Context,
  test: (item: Scalar, fromRange: boolean) => boolean,
): number {
  let count = 0;
  for (const arg of args) {
    if (arg.k === "missing") {
      continue;
    }
    const value = evaluate(arg, ctx);
    if (value instanceof Ref) {
      for (const area of value.areas) {
        const matrix = ctx.engine.toMatrix(new Ref([area]), ctx);
        for (const item of matrix.data) if (test(item, true)) count++;
      }
    } else if (value instanceof Matrix) {
      for (const item of value.data) if (test(item, true)) count++;
    } else if (test(value, false)) count++;
  }
  return count;
}

/** Numbers for MODE: like collect, except that text typed as an argument is passed over. */
function modeValues(args: Node[], ctx: Context): number[] {
  const out: number[] = [];
  for (const arg of args) {
    if (arg.k === "missing") continue;
    const value = evaluate(arg, ctx);
    if (typeof value === "string") {
      const parsed = parseNumber(value);
      if (parsed !== null) out.push(parsed);
    } else collectValue(value, ctx, "plain", out);
  }
  return out;
}

/** The most frequent values, each the first time it reaches the top count; empty when none repeats. */
function modes(values: number[]): number[] {
  const counts = new Map<number, number>();
  let best = 1;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    best = Math.max(best, count);
  }
  if (best < 2) return [];
  const out: number[] = [];
  for (const value of values)
    if (counts.get(value) === best && !out.includes(value)) out.push(value);
  return out;
}

function kth(args: Node[], ctx: Context, largest: boolean): Value {
  let values: number[] | null = null;
  return each(evaluate(args[1]!, ctx), ctx, (k) => {
    if (k instanceof XlError) return k;
    const n = num(k);
    values ??= sorted(collect([args[0]!], ctx));
    const index = Math.floor(largest ? values.length - n + 1 : n);
    if (n < 1 || index < 1 || index > values.length) return NUM;
    return values[index - 1]!;
  });
}

type Percentile = (values: number[], p: number) => Scalar;

function percentile(args: Node[], ctx: Context, impl: Percentile, quartile: boolean): Value {
  let values: number[] | null = null;
  return each(evaluate(args[1]!, ctx), ctx, (k) => {
    if (k instanceof XlError) return k;
    let p = num(k);
    values ??= collect([args[0]!], ctx);
    if (quartile) {
      if (p < 0 || p >= 5) return NUM;
      p = Math.trunc(p) / 4;
    }
    return impl(values, p);
  });
}

function rank(args: Node[], ctx: Context, average: boolean): Value {
  let values: number[] | null = null;
  return each(evaluate(args[0]!, ctx), ctx, (x) => {
    if (x instanceof XlError) return x;
    const value = num(x);
    values ??= collect([args[1]!], ctx);
    const descending = !args[2] || num(check(single(args, 2, ctx) ?? 0)) === 0;
    let better = 0;
    let ties = 0;
    for (const v of values) {
      if (v === value) ties++;
      else if (descending ? v > value : v < value) better++;
    }
    if (!ties) return NA;
    return average ? better + (ties + 1) / 2 : better + 1;
  });
}

function percentRank(args: Node[], ctx: Context, exclusive: boolean): Scalar {
  const values = sorted(collect([args[0]!], ctx));
  const x = num(check(single(args, 1, ctx) ?? null));
  const significance = args[2] ? Math.trunc(num(check(single(args, 2, ctx) ?? 3))) : 3;
  if (!values.length || significance < 1) return NUM;
  if (x < values[0]! || x > values[values.length - 1]!) return NA;
  const n = values.length;
  let r: number;
  const index = values.findIndex((v) => v >= x);
  if (values[index] === x) {
    const below = values.filter((v) => v < x).length;
    r = exclusive ? (below + 1) / (n + 1) : below / (n - 1);
  } else {
    const lo = values[index - 1]!;
    const hi = values[index]!;
    const below = index - 1;
    const base = exclusive ? (below + 1) / (n + 1) : below / (n - 1);
    const next = exclusive ? (below + 2) / (n + 1) : (below + 1) / (n - 1);
    r = base + ((x - lo) / (hi - lo)) * (next - base);
  }
  const factor = 10 ** significance;
  return Math.floor(r * factor + 1e-9) / factor;
}

function correl(args: Node[], ctx: Context): Scalar {
  const data = pairs(args, ctx);
  if (data instanceof XlError) return data;
  const r = regression(...data);
  if (r.sxx === 0 || r.syy === 0) return DIV0;
  return r.sxy / Math.sqrt(r.sxx * r.syy);
}

function covariance(args: Node[], ctx: Context, sample: boolean): Scalar {
  const data = pairs(args, ctx);
  if (data instanceof XlError) return data;
  const r = regression(...data);
  if (r.n < (sample ? 2 : 1)) return DIV0;
  return r.sxy / (r.n - (sample ? 1 : 0));
}

/** FORECAST: the x value's error first, then the known values', each x in an array on its own. */
/** A reference to one empty cell, which FORECAST refuses instead of finding no pairs. */
function blankCell(value: Value, ctx: Context): boolean {
  const area = value instanceof Ref ? value.single : null;
  return (
    !!area &&
    area.r1 === area.r2 &&
    area.c1 === area.c2 &&
    ctx.engine.cellValue(area.sheet, area.r1, area.c1) === null
  );
}

function forecast(args: Node[], ctx: Context): Value {
  let fit: { slope: number; intercept: number } | XlError | null = null;
  return each(evaluate(args[0]!, ctx), ctx, (x) => {
    if (x instanceof XlError) return x;
    fit ??= (() => {
      const ys = evaluate(args[1]!, ctx);
      const xs = evaluate(args[2]!, ctx);
      if (blankCell(ys, ctx) || blankCell(xs, ctx)) return VALUE;
      const data = paired(ys, xs, ctx);
      if (data instanceof XlError) return data;
      const r = regression(...data);
      if (r.sxx === 0) return DIV0;
      const slope = r.sxy / r.sxx;
      return { slope, intercept: r.my - slope * r.mx };
    })();
    if (fit instanceof XlError) return fit;
    return fit.intercept + fit.slope * num(x);
  });
}

// ---------------------------------------------------------------------------------------------
// The *IF and *IFS family

type Grid = {
  rows: number;
  cols: number;
  usedRows: number;
  usedCols: number;
  at: (r: number, c: number) => Scalar;
};

/** A range or array as a grid of cells, with the part that can hold anything for iterating. */
function grid(value: Value, ctx: Context): Grid | XlError {
  if (value instanceof Ref) {
    const area = value.single;
    if (!area) return VALUE;
    const rows = area.r2 - area.r1 + 1;
    const cols = area.c2 - area.c1 + 1;
    return {
      rows,
      cols,
      usedRows: Math.min(rows, Math.max(0, ctx.engine.usedRows() - area.r1 + 1)),
      usedCols: Math.min(cols, Math.max(0, ctx.engine.usedCols() - area.c1 + 1)),
      at: (r, c) => ctx.engine.cellValue(area.sheet, area.r1 + r, area.c1 + c),
    };
  }
  if (value instanceof Matrix)
    return {
      rows: value.rows,
      cols: value.cols,
      usedRows: value.rows,
      usedCols: value.cols,
      at: (r, c) => (r < value.rows && c < value.cols ? value.get(r, c) : null),
    };
  return {
    rows: 1,
    cols: 1,
    usedRows: 1,
    usedCols: 1,
    at: (r, c) => (r === 0 && c === 0 ? value : null),
  };
}

/** `range` read from the top-left cell of `target` (as AVERAGEIF reads an average range of another size). */
function overlay(range: Grid, target: Value, ctx: Context): Grid | XlError {
  if (target instanceof Ref && target.single) {
    const area = target.single;
    return grid(
      new Ref([{ ...area, r2: area.r1 + range.rows - 1, c2: area.c1 + range.cols - 1 }]),
      ctx,
    );
  }
  return grid(target, ctx);
}

/**
 * COUNTIFS, AVERAGEIFS and friends: `pairs` lists each range's argument index, its criteria
 * following it. An array of criteria gives an array of results. A matching cell's error in the
 * values range is the result.
 */
function conditional(
  args: Node[],
  ctx: Context,
  pairs: number[],
  valuesAt: number | null,
  reduce: (values: number[]) => Scalar,
  resize = false,
): Value {
  const ranges: Grid[] = [];
  const criteria: Value[] = [];
  for (const index of pairs) {
    const range = grid(evaluate(args[index]!, ctx), ctx);
    if (range instanceof XlError) return range;
    ranges.push(range);
    const arg = args[index + 1];
    criteria.push(!arg || arg.k === "missing" ? null : evaluate(arg, ctx));
  }
  const first = ranges[0]!;
  let values: Grid | XlError | null = null;
  if (valuesAt !== null) {
    const target = evaluate(args[valuesAt] ?? args[pairs[0]!]!, ctx);
    values = resize ? overlay(first, target, ctx) : grid(target, ctx);
    if (values instanceof XlError) return values;
  }
  for (const range of values ? [...ranges, values] : ranges)
    if (range.rows !== first.rows || range.cols !== first.cols) return VALUE;
  const rows = Math.max(...ranges.map((range) => range.usedRows));
  const cols = Math.max(...ranges.map((range) => range.usedCols));
  return ctx.engine.liftN(criteria, ctx, (items) => {
    const tests = items.map((item) => criterion(item));
    const picked: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!tests.every((test, j) => test(ranges[j]!.at(r, c)))) continue;
        if (!values) {
          picked.push(1);
          continue;
        }
        const value = values.at(r, c);
        if (value instanceof XlError) return value;
        if (typeof value === "number") picked.push(value);
      }
    }
    return reduce(picked);
  });
}

const ifsPairs = (args: Node[], start: number) => {
  const out: number[] = [];
  for (let i = start; i < args.length; i += 2) out.push(i);
  return out;
};

// ---------------------------------------------------------------------------------------------
// Linear and exponential regression (LINEST, LOGEST, TREND, GROWTH)

type Fit = {
  /** One coefficient per x variable, 0 for a column dropped as collinear. */
  coefficients: number[];
  intercept: number;
  /** LINEST's five statistics rows. */
  stats: Scalar[][];
};

/** A y range and its x variables: one per column when y is a column, one per row when y is a row. */
function regressionData(
  args: Node[],
  ctx: Context,
  log: boolean,
): { y: number[]; x: number[][]; byRow: boolean } | XlError {
  const yValue = ctx.engine.toMatrix(evaluate(args[0]!, ctx), ctx);
  const n = yValue.data.length;
  const xArg = args[1];
  const xValue =
    xArg && xArg.k !== "missing" ? ctx.engine.toMatrix(evaluate(xArg, ctx), ctx) : undefined;
  const sameShape = !xValue || (xValue.rows === yValue.rows && xValue.cols === yValue.cols);
  const byColumn = !sameShape && yValue.cols === 1 && xValue!.rows === n;
  const byRow = sameShape
    ? yValue.rows === 1 && yValue.cols > 1
    : !byColumn && yValue.rows === 1 && xValue!.cols === n;
  if (!sameShape && !byColumn && !byRow) return REF;
  const y: number[] = [];
  for (const item of yValue.data) {
    if (typeof item !== "number") return VALUE;
    if (log && item <= 0) return NUM;
    y.push(log ? Math.log(item) : item);
  }
  if (!xValue) return { y, x: [y.map((_, i) => i + 1)], byRow };
  for (const item of xValue.data) if (typeof item !== "number") return VALUE;
  const xs = xValue.data as number[];
  if (sameShape) return { y, x: [xs.slice()], byRow };
  if (byColumn)
    return {
      y,
      x: Array.from({ length: xValue.cols }, (_, c) =>
        Array.from({ length: n }, (_, r) => xs[r * xValue.cols + c]!),
      ),
      byRow,
    };
  return {
    y,
    x: Array.from({ length: xValue.rows }, (_, r) => xs.slice(r * n, (r + 1) * n)),
    byRow,
  };
}

/**
 * Least squares the way Excel documents it (Microsoft KB 828533): centre y and the x columns and add
 * a column of 1s when there is a constant, then Householder QR that at each step brings forward the
 * column whose remaining part is longest, stopping when what is left adds nothing. Columns never
 * brought forward are collinear and get 0. The residual sum of squares is what the reflections
 * leave in y below the fitted rows.
 */
function leastSquares(y: number[], x: number[][], constant: boolean): Fit {
  const n = y.length;
  const k = x.length;
  const xMeans = x.map((column) => (constant ? mean(column) : 0));
  const yMean = constant ? mean(y) : 0;
  const a = x.map((column, j) => column.map((value) => value - xMeans[j]!));
  if (constant) a.push(new Array<number>(n).fill(1));
  const b = y.map((value) => value - yMean);
  const columns = a.length;
  const order = a.map((_, j) => j);
  const original = a.map((column) => sumOfSquares(column, 0));
  let rank = 0;
  for (let j = 0; j < Math.min(columns, n); j++) {
    let best = j;
    let longest = -1;
    let ratio = -1;
    for (let c = j; c < columns; c++) {
      const length = sumOfSquares(a[c]!, j);
      const r = original[c]! > 0 ? length / original[c]! : 0;
      if (r > ratio) {
        ratio = r;
        longest = length;
        best = c;
      }
    }
    if (longest <= 0 || longest <= original[best]! * 1e-26) break;
    [a[j], a[best]] = [a[best]!, a[j]!];
    [order[j], order[best]] = [order[best]!, order[j]!];
    [original[j], original[best]] = [original[best]!, original[j]!];
    const column = a[j]!;
    const norm = Math.sqrt(longest);
    const sign = column[j]! >= 0 ? 1 : -1;
    const v = column.slice();
    v[j]! += sign * norm;
    const vv = sumOfSquares(v, j);
    for (let c = j + 1; c < columns; c++) reflect(v, j, vv, a[c]!);
    reflect(v, j, vv, b);
    column[j] = -sign * norm;
    for (let i = j + 1; i < n; i++) column[i] = 0;
    rank++;
  }
  const solved = new Array<number>(rank).fill(0);
  for (let i = rank - 1; i >= 0; i--) {
    let total = b[i]!;
    for (let c = rank - 1; c > i; c--) total -= a[c]![i]! * solved[c]!;
    solved[i] = total / a[i]![i]!;
  }
  const coefficients = new Array<number>(k).fill(0);
  for (let i = 0; i < rank; i++) if (order[i]! < k) coefficients[order[i]!] = solved[i]!;
  let intercept = yMean;
  if (constant) for (let j = 0; j < k; j++) intercept -= coefficients[j]! * xMeans[j]!;
  const ssTotal = sumOfSquares(constant ? y.map((value) => value - yMean) : y, 0);
  const ssResid = sumOfSquares(b, rank);
  const m = rank - (constant ? 1 : 0);
  const df = n - rank;
  const ssReg = ssTotal - ssResid;
  // (RᵀR)⁻¹ = R⁻¹R⁻ᵀ gives the coefficient variances.
  const rInv: number[][] = Array.from({ length: rank }, () => new Array<number>(rank).fill(0));
  for (let c = 0; c < rank; c++) {
    for (let i = c; i >= 0; i--) {
      let total = i === c ? 1 : 0;
      for (let j = i + 1; j <= c; j++) total -= a[j]![i]! * rInv[j]![c]!;
      rInv[i]![c] = total / a[i]![i]!;
    }
  }
  const sigma2 = df > 0 ? ssResid / df : NaN;
  const se = new Array<Scalar>(k).fill(0);
  for (let i = 0; i < rank; i++) {
    if (order[i]! >= k) continue;
    let total = 0;
    for (let c = 0; c < rank; c++) total += rInv[i]![c]! ** 2;
    se[order[i]!] = df > 0 ? Math.sqrt(total * sigma2) : NUM;
  }
  let seIntercept: Scalar = NA;
  if (constant) {
    if (df <= 0) seIntercept = NUM;
    else {
      // The intercept is ȳ + c₁ − Σ bⱼx̄ⱼ, c₁ being the 1s column's (zero) coefficient.
      const weight = order.slice(0, rank).map((j) => (j < k ? -xMeans[j]! : 1));
      let quad = 0;
      for (let c = 0; c < rank; c++) {
        let total = 0;
        for (let i = 0; i <= c; i++) total += weight[i]! * rInv[i]![c]!;
        quad += total * total;
      }
      seIntercept = Math.sqrt(sigma2 * quad);
    }
  }
  const row = (values: Scalar[], last: Scalar) => [...values.slice().reverse(), last];
  const stats: Scalar[][] = [];
  stats.push(row(coefficients, constant ? intercept : 0));
  stats.push(row(se, seIntercept));
  const pad = new Array<Scalar>(Math.max(0, k - 1)).fill(NA);
  stats.push([ssTotal === 0 ? NUM : ssReg / ssTotal, df > 0 ? Math.sqrt(sigma2) : NUM, ...pad]);
  stats.push([df > 0 && ssResid !== 0 ? ssReg / m / sigma2 : NUM, df, ...pad]);
  stats.push([ssReg, ssResid, ...pad]);
  return { coefficients, intercept: constant ? intercept : 0, stats };
}

function sumOfSquares(values: number[], from: number): number {
  let total = 0;
  for (let i = from; i < values.length; i++) total += values[i]! * values[i]!;
  return total;
}

/** Applies the Householder reflection I − 2vvᵀ/vᵀv (v zero above `from`) to `column` in place. */
function reflect(v: number[], from: number, vv: number, column: number[]) {
  let dot = 0;
  for (let i = from; i < v.length; i++) dot += v[i]! * column[i]!;
  const f = (2 * dot) / vv;
  for (let i = from; i < v.length; i++) column[i]! -= f * v[i]!;
}

/** An optional TRUE/FALSE argument, any error in it being #VALUE!. */
function flag(args: Node[], index: number, ctx: Context, fallback: boolean): boolean {
  const arg = args[index];
  if (!arg || arg.k === "missing") return fallback;
  const value = single(args, index, ctx) ?? null;
  if (value instanceof XlError || value === null) throw VALUE;
  if (typeof value === "string") {
    const upper = value.trim().toUpperCase();
    if (upper === "TRUE" || upper === "FALSE") return upper === "TRUE";
  }
  return num(value) !== 0;
}

/** LINEST, or LOGEST (`log`), whose first row holds the exponentials of the fitted logarithms. */
function linest(args: Node[], ctx: Context, log: boolean): Value {
  const data = regressionData(args, ctx, log);
  if (data instanceof XlError) return data;
  const fit = leastSquares(data.y, data.x, flag(args, 2, ctx, true));
  const rows = flag(args, 3, ctx, false) ? fit.stats : fit.stats.slice(0, 1);
  if (log) rows[0] = rows[0]!.map((value) => (typeof value === "number" ? Math.exp(value) : value));
  return Matrix.of(rows);
}

function trend(args: Node[], ctx: Context, log: boolean): Value {
  const data = regressionData(args, ctx, log);
  if (data instanceof XlError) return data;
  const constant = flag(args, 3, ctx, true);
  const fit = leastSquares(data.y, data.x, constant);
  const k = data.x.length;
  const newArg = args[2];
  let targets: Matrix;
  if (!newArg || newArg.k === "missing") {
    const xArg = args[1];
    targets =
      xArg && xArg.k !== "missing"
        ? ctx.engine.toMatrix(evaluate(xArg, ctx), ctx)
        : (() => {
            const y = ctx.engine.toMatrix(evaluate(args[0]!, ctx), ctx);
            return new Matrix(
              y.rows,
              y.cols,
              y.data.map((_, i) => i + 1),
            );
          })();
  } else targets = ctx.engine.toMatrix(evaluate(newArg, ctx), ctx);
  for (const item of targets.data) if (typeof item !== "number") return VALUE;
  const at = (values: number[]) => {
    let total = fit.intercept;
    for (let j = 0; j < k; j++) total += fit.coefficients[j]! * values[j]!;
    return log ? Math.exp(total) : total;
  };
  const t = targets.data as number[];
  if (k === 1)
    return new Matrix(
      targets.rows,
      targets.cols,
      t.map((value) => at([value])),
    );
  if (!data.byRow) {
    if (targets.cols !== k) return REF;
    return new Matrix(
      targets.rows,
      1,
      Array.from({ length: targets.rows }, (_, r) => at(t.slice(r * k, (r + 1) * k))),
    );
  }
  if (targets.rows !== k) return REF;
  return new Matrix(
    1,
    targets.cols,
    Array.from({ length: targets.cols }, (_, c) =>
      at(Array.from({ length: k }, (_, r) => t[r * targets.cols + c]!)),
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// FORECAST.ETS family: additive Holt-Winters (AAA) exponential smoothing

type Series = { x: number[]; y: number[]; step: number };

type Ets = {
  series: Series;
  period: number;
  alpha: number;
  beta: number;
  gamma: number;
  level: number;
  trend: number;
  /** Seasonal indexes for the last `period` points, oldest first. */
  season: number[];
  /** One-step-ahead fitted value for each point. */
  fitted: number[];
  sse: number;
};

const AGGREGATES: Record<number, (values: number[]) => number> = {
  1: mean,
  2: (values) => values.length,
  3: (values) => values.length,
  4: (values) => Math.max(...values),
  5: (values) => {
    const s = sorted(values);
    const half = s.length >> 1;
    return s.length % 2 ? s[half]! : (s[half - 1]! + s[half]!) / 2;
  },
  6: (values) => Math.min(...values),
  7: sum,
};

/** An optional whole-number option: its default when omitted or blank, #NUM! outside `allowed`. */
function etsOption(
  value: Scalar | undefined,
  fallback: number,
  allowed: (n: number) => boolean,
): number {
  if (value === undefined || check(value) === null) return fallback;
  const n = Math.trunc(num(value));
  if (!allowed(n)) throw NUM;
  return n;
}

const seasonality = (value: Scalar | undefined) => etsOption(value, 1, (n) => n >= 0 && n <= 8760);
const completion = (value: Scalar | undefined) =>
  etsOption(value, 1, (n) => n === 0 || n === 1) === 1;
const aggregation = (value: Scalar | undefined) => etsOption(value, 1, (n) => n >= 1 && n <= 7);

/** `fn` over the scalar arguments at `indexes` (omitted ones undefined), element by element for arrays. */
function etsLift(
  args: Node[],
  ctx: Context,
  indexes: number[],
  fn: (items: (Scalar | undefined)[]) => Scalar,
): Value {
  const present = indexes.filter((i) => args[i] && args[i]!.k !== "missing");
  return ctx.engine.liftN(
    present.map((i) => evaluate(args[i]!, ctx)),
    ctx,
    (items) =>
      attempt(() =>
        fn(indexes.map((i) => (present.includes(i) ? items[present.indexOf(i)] : undefined))),
      ),
  );
}

/** The fitted model for one combination of options, computed once per call. */
function etsModels(args: Node[], ctx: Context, data: number) {
  const cache = new Map<string, Ets | XlError>();
  return (period: number, complete: boolean, aggregate: number): Ets => {
    const key = `${period},${complete},${aggregate}`;
    let fit = cache.get(key);
    if (!fit) {
      fit = attempt(() => {
        const series = etsSeries(args, data, ctx, complete, aggregate);
        return fitEts(series, period === 1 ? detectPeriod(series.y) : period);
      });
      cache.set(key, fit);
    }
    if (fit instanceof XlError) throw fit;
    return fit;
  };
}

/** Values against a timeline, sorted, duplicates aggregated and gaps filled to a constant step. */
function etsSeries(
  args: Node[],
  at: number,
  ctx: Context,
  completion: boolean,
  aggregation: number,
): Series {
  const values = flat(evaluate(args[at]!, ctx), ctx);
  const timeline = flat(evaluate(args[at + 1]!, ctx), ctx);
  for (const item of values) if (item instanceof XlError) throw item;
  for (const item of timeline) if (item instanceof XlError) throw item;
  if (values.length !== timeline.length) throw NA;
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < values.length; i++) {
    const x = timeline[i]!;
    const y = values[i]!;
    if (typeof x !== "number") throw VALUE;
    if (y === null) continue;
    if (typeof y !== "number") throw VALUE;
    points.push({ x, y });
  }
  points.sort((a, b) => a.x - b.x);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < points.length; ) {
    const group: number[] = [];
    const x = points[i]!.x;
    while (i < points.length && points[i]!.x === x) group.push(points[i++]!.y);
    xs.push(x);
    ys.push(AGGREGATES[aggregation]!(group));
  }
  if (xs.length < 2) throw NUM;
  let step = Infinity;
  for (let i = 1; i < xs.length; i++) step = Math.min(step, xs[i]! - xs[i - 1]!);
  const x: number[] = [xs[0]!];
  const y: number[] = [ys[0]!];
  let missing = 0;
  for (let i = 1; i < xs.length; i++) {
    const gap = (xs[i]! - xs[i - 1]!) / step;
    if (gap !== Math.round(gap)) throw NUM;
    for (let k = 1; k < gap; k++) {
      x.push(xs[i - 1]! + k * step);
      y.push(completion ? (ys[i - 1]! + ys[i]!) / 2 : 0);
      missing++;
    }
    x.push(xs[i]!);
    y.push(ys[i]!);
  }
  if (missing > 0.3 * xs.length) throw NUM;
  return { x, y, step };
}

/** The most likely season length: the strongest autocorrelation of the linearly detrended values, if significant. */
function detectPeriod(y: number[]): number {
  const n = y.length;
  const r = regression(
    y,
    y.map((_, i) => i),
  );
  const slope = r.sxx === 0 ? 0 : r.sxy / r.sxx;
  const residuals = y.map((value, i) => value - (r.my + slope * (i - r.mx)));
  let denominator = 0;
  for (const value of residuals) denominator += value * value;
  if (denominator === 0) return 0;
  let best = 0;
  let bestR = 1.96 / Math.sqrt(n);
  for (let lag = 2; lag <= n / 2; lag++) {
    let total = 0;
    for (let i = 0; i + lag < n; i++) total += residuals[i]! * residuals[i + lag]!;
    if (total / denominator > bestR) {
      bestR = total / denominator;
      best = lag;
    }
  }
  return best;
}

/** Runs the smoothing recursions over the series with the given parameters. */
function smooth(series: Series, period: number, alpha: number, beta: number, gamma: number): Ets {
  const y = series.y;
  const m = Math.max(period, 1);
  let level: number;
  let trend: number;
  const season = new Array<number>(m).fill(0);
  if (period >= 2) {
    const periods = Math.floor(y.length / m);
    const averages = Array.from({ length: periods }, (_, k) => mean(y.slice(k * m, (k + 1) * m)));
    trend = (averages[1]! - averages[0]!) / m;
    for (let j = 0; j < m; j++) {
      let total = 0;
      for (let k = 0; k < periods; k++)
        total += y[k * m + j]! - (averages[k]! + (j - (m - 1) / 2) * trend);
      season[j] = total / periods;
    }
    level = averages[0]! - ((m + 1) / 2) * trend;
  } else {
    trend = (y[y.length - 1]! - y[0]!) / (y.length - 1);
    level = y[0]!;
  }
  const first = period >= 2 ? 0 : 1;
  const fitted: number[] = first ? [y[0]!] : [];
  let sse = 0;
  for (let t = first; t < y.length; t++) {
    const s = season[t % m]!;
    const forecast = level + trend + s;
    fitted.push(forecast);
    sse += (y[t]! - forecast) ** 2;
    const previous = level;
    level = alpha * (y[t]! - s) + (1 - alpha) * (level + trend);
    trend = beta * (level - previous) + (1 - beta) * trend;
    if (period >= 2) season[t % m] = gamma * (y[t]! - level) + (1 - gamma) * s;
  }
  const start = y.length % m;
  return {
    series,
    period,
    alpha,
    beta,
    gamma: period >= 2 ? gamma : 0,
    level,
    trend,
    season: [...season.slice(start), ...season.slice(0, start)],
    fitted,
    sse,
  };
}

/** Fits the parameters by least squares: a coarse grid, then a shrinking pattern search inside [0, 1]. */
function fitEts(series: Series, period: number): Ets {
  if (period >= 2 && series.y.length < 2 * period) throw NUM;
  if (period < 2 && series.y.length <= 3) return smooth(series, period, 0.1, 0.99, 0);
  const grid = [0.1, 0.3, 0.5, 0.7, 0.9];
  const gammas = period >= 2 ? grid : [0];
  let best: Ets | null = null;
  for (const a of grid)
    for (const b of grid)
      for (const g of gammas) {
        const fit = smooth(series, period, a, b, g);
        if (!best || fit.sse < best.sse) best = fit;
      }
  let p = [best!.alpha, best!.beta, best!.gamma];
  const dims = period >= 2 ? 3 : 2;
  for (let size = 0.1; size > 1e-7; size /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      for (let d = 0; d < dims; d++)
        for (const sign of [1, -1]) {
          const q = [...p];
          q[d] = Math.min(1, Math.max(0, q[d]! + sign * size));
          const fit = smooth(series, period, q[0]!, q[1]!, q[2]!);
          if (fit.sse < best!.sse) {
            best = fit;
            p = q;
            improved = true;
          }
        }
    }
  }
  return best!;
}

/** The model's forecast `h` (a positive whole number) steps past the last point. */
function etsAhead(fit: Ets, h: number): number {
  const season = fit.period >= 2 ? fit.season[(h - 1) % fit.period]! : 0;
  return fit.level + h * fit.trend + season;
}

function etsForecast(fit: Ets, target: number): Scalar {
  const { x, y, step } = fit.series;
  const position = (target - x[0]!) / step;
  if (position <= -1) return NUM;
  if (position < 0) return y[0]! * (position + 1);
  const last = x.length - 1;
  if (position <= last) {
    const n = Math.floor(position);
    const fraction = position - n;
    return fraction ? y[n]! + fraction * (fit.fitted[n + 1]! - y[n]!) : y[n]!;
  }
  const h = position - last;
  const n = Math.floor(h);
  const from = n === 0 ? y[last]! : etsAhead(fit, n);
  return h === n ? from : from + (h - n) * (etsAhead(fit, n + 1) - from);
}

/** Half-width of the prediction interval `h` steps ahead, from the model's error variance. */
function etsInterval(fit: Ets, target: number, level: number): Scalar {
  const { x, y, step } = fit.series;
  const h = (target - x[x.length - 1]!) / step;
  if (h <= 0) return NUM;
  const sigma = Math.sqrt(fit.sse / (y.length - 1));
  const width = (steps: number) => {
    let variance = 1;
    for (let j = 1; j < steps; j++) {
      const c =
        fit.alpha * (1 + j * fit.beta) +
        (fit.period >= 2 && j % fit.period === 0 ? fit.gamma * (1 - fit.alpha) : 0);
      variance += c * c;
    }
    return D.gaussInv((1 + level) / 2) * sigma * Math.sqrt(variance);
  };
  const n = Math.max(1, Math.floor(h));
  return h <= 1 || h === n ? width(Math.ceil(h)) : width(n) + (h - n) * (width(n + 1) - width(n));
}

function etsStat(fit: Ets, type: number): Scalar {
  const { y } = fit.series;
  const errors = fit.fitted.map((value, i) => value - y[i]!).slice(1);
  const mae = errors.reduce((total, e) => total + Math.abs(e), 0) / errors.length;
  switch (type) {
    case 1:
      return fit.alpha;
    case 2:
      return fit.beta;
    case 3:
      return fit.gamma;
    case 4: {
      let naive = 0;
      for (let i = 1; i < y.length; i++) naive += Math.abs(y[i]! - y[i - 1]!);
      return naive === 0 ? 0 : mae / (naive / (y.length - 1));
    }
    case 5: {
      let total = 0;
      errors.forEach((e, i) => {
        const scale = Math.abs(fit.fitted[i + 1]!) + Math.abs(y[i + 1]!);
        if (scale) total += Math.abs(e) / scale;
      });
      return (2 * total) / errors.length;
    }
    case 6:
      return mae;
    case 7:
      return Math.sqrt(errors.reduce((total, e) => total + e * e, 0) / errors.length);
    case 8:
      return fit.series.step;
    default:
      return NUM;
  }
}

const ETS: Record<string, Fn> = {
  "FORECAST.ETS": (args, ctx) => {
    const model = etsModels(args, ctx, 1);
    return etsLift(args, ctx, [0, 3, 4, 5], ([target, period, complete, aggregate]) => {
      const t = num(check(target!));
      return etsForecast(
        model(seasonality(period), completion(complete), aggregation(aggregate)),
        t,
      );
    });
  },
  "FORECAST.ETS.CONFINT": (args, ctx) => {
    const model = etsModels(args, ctx, 1);
    return etsLift(
      args,
      ctx,
      [0, 3, 4, 5, 6],
      ([target, levelValue, period, complete, aggregate]) => {
        const t = num(check(target!));
        const level =
          levelValue === undefined || check(levelValue) === null ? 0.95 : num(levelValue);
        if (level <= 0 || level >= 1) return NUM;
        return etsInterval(
          model(seasonality(period), completion(complete), aggregation(aggregate)),
          t,
          level,
        );
      },
    );
  },
  "FORECAST.ETS.SEASONALITY": (args, ctx) =>
    etsLift(args, ctx, [2, 3], ([complete, aggregate]) =>
      detectPeriod(etsSeries(args, 0, ctx, completion(complete), aggregation(aggregate)).y),
    ),
  "FORECAST.ETS.STAT": (args, ctx) => {
    const model = etsModels(args, ctx, 0);
    return etsLift(args, ctx, [2, 3, 4, 5], ([type, period, complete, aggregate]) => {
      const n = Math.trunc(num(check(type!)));
      if (n < 1 || n > 8) return NUM;
      return etsStat(model(seasonality(period), completion(complete), aggregation(aggregate)), n);
    });
  },
};

// ---------------------------------------------------------------------------------------------
// Hypothesis tests

/** The numbers of a range for the test functions, after its first error (other than #NULL!). */
function testValues(value: Value, ctx: Context): number[] {
  const items = flat(value, ctx);
  const error = firstError(items);
  if (error) throw error;
  return numbersIn(items);
}

function sampleStats(values: number[]) {
  const sum1 = new D.KahanSum();
  const sumSq = new D.KahanSum();
  for (const value of values) {
    sum1.add(value);
    sumSq.add(value * value);
  }
  const n = values.length;
  const s = sum1.get();
  return { n, sum: s, variance: new D.KahanSum(sumSq.get()).add((-s * s) / n).get() / (n - 1) };
}

function tTest(args: Node[], ctx: Context): Value {
  const first = evaluate(args[0]!, ctx);
  const second = evaluate(args[1]!, ctx);
  const compute = (tails: number, type: number): Scalar => {
    if (tails !== 1 && tails !== 2) return NUM;
    if (type < 1 || type > 3) return NUM;
    let t: number;
    let df: number;
    if (type === 1) {
      const data = paired(first, second, ctx);
      if (data instanceof XlError) return data;
      const [a, b] = data;
      const n = a.length;
      const sumD = new D.KahanSum();
      const sumSqD = new D.KahanSum();
      for (let i = 0; i < n; i++) {
        sumD.add(a[i]! - b[i]!);
        sumSqD.add((a[i]! - b[i]!) ** 2);
      }
      const divider = new D.KahanSum(sumSqD.get() * n).add(-(sumD.get() ** 2)).get();
      if (n < 1 || divider === 0) return DIV0;
      t = Math.abs(sumD.get()) * Math.sqrt((n - 1) / divider);
      df = n - 1;
    } else {
      const a = sampleStats(testValues(first, ctx));
      const b = sampleStats(testValues(second, ctx));
      if (a.n < 2 || b.n < 2) return DIV0;
      if (type === 3) {
        const s1 = a.variance / a.n;
        const s2 = b.variance / b.n;
        if (s1 + s2 === 0) return DIV0;
        t = Math.abs(a.sum / a.n - b.sum / b.n) / Math.sqrt(s1 + s2);
        const c = s1 / (s1 + s2);
        df = 1 / ((c * c) / (a.n - 1) + ((1 - c) * (1 - c)) / (b.n - 1));
      } else {
        const pooled = (a.n - 1) * a.variance + (b.n - 1) * b.variance;
        if (pooled === 0) return DIV0;
        t =
          (Math.abs(a.sum / a.n - b.sum / b.n) / Math.sqrt(pooled)) *
          Math.sqrt((a.n * b.n * (a.n + b.n - 2)) / (a.n + b.n));
        df = a.n + b.n - 2;
      }
    }
    return D.tDist(t, df, tails as 1 | 2);
  };
  return ctx.engine.liftN([evaluate(args[2]!, ctx), evaluate(args[3]!, ctx)], ctx, (items) =>
    attempt(() => {
      for (const item of items) if (item instanceof XlError) return item;
      return compute(Math.trunc(num(items[0]!)), Math.trunc(num(items[1]!)));
    }),
  );
}

function fTest(args: Node[], ctx: Context): Scalar {
  const sample = (node: Node) => {
    const values = testValues(evaluate(node, ctx), ctx);
    return {
      n: values.length,
      variance: values.length < 2 ? 0 : devsq(values) / (values.length - 1),
    };
  };
  const a = sample(args[0]!);
  const b = sample(args[1]!);
  if (a.variance === 0 || b.variance === 0) return DIV0;
  const [f, f1, f2] =
    a.variance > b.variance
      ? [a.variance / b.variance, a.n - 1, b.n - 1]
      : [b.variance / a.variance, b.n - 1, a.n - 1];
  const [left, right] = D.fTails(f, f1, f2);
  return 2 * Math.min(left, right);
}

function chiTest(args: Node[], ctx: Context): Scalar {
  const actual = evaluate(args[0]!, ctx);
  const expected = evaluate(args[1]!, ctx);
  const a = flat(actual, ctx);
  const e = flat(expected, ctx);
  if (a.length !== e.length) return NA;
  for (const x of a) if (x instanceof XlError && !isNullError(x)) return x;
  for (let i = 0; i < e.length; i++) {
    const m = e[i]!;
    if (m instanceof XlError && !isNullError(m) && !isNullError(a[i]!)) return m;
  }
  const chi = new D.KahanSum();
  let any = false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const m = e[i]!;
    if (typeof x !== "number" || typeof m !== "number") continue;
    if (m === 0) return DIV0;
    chi.add((x - m) ** 2 / m);
    any = true;
  }
  if (!any) return DIV0;
  const shape = ctx.engine.toMatrix(actual, ctx);
  const df =
    shape.rows === 1 || shape.cols === 1
      ? shape.rows * shape.cols - 1
      : (shape.rows - 1) * (shape.cols - 1);
  if (df === 0) return NA;
  return D.chiDist(chi.get(), df);
}

function zTest(args: Node[], ctx: Context): Value {
  const operands = [evaluate(args[1]!, ctx)];
  if (args[2] && args[2].k !== "missing") operands.push(evaluate(args[2], ctx));
  let values: number[] | null = null;
  return ctx.engine.liftN(operands, ctx, (items) =>
    attempt(() => {
      const x = num(check(items[0]!));
      const sigma = items.length > 1 ? num(check(items[1]!)) : null;
      values ??= testValues(evaluate(args[0]!, ctx), ctx);
      if (sigma !== null && sigma <= 0) return NUM;
      const n = values.length;
      if (n <= 1) return DIV0;
      const total = new D.KahanSum();
      const squares = new D.KahanSum();
      for (const value of values) {
        total.add(value);
        squares.add(value * value);
      }
      const m = total.get() / n;
      if (sigma === null) {
        const s2 =
          new D.KahanSum(squares.get()).add(-(total.get() * total.get()) / n).get() / (n - 1);
        if (s2 === 0) return DIV0;
        return D.upperPhi((m - x) / Math.sqrt(s2 / n));
      }
      return D.upperPhi(((m - x) * Math.sqrt(n)) / sigma);
    }),
  );
}

function prob(args: Node[], ctx: Context): Value {
  const xs = flat(evaluate(args[0]!, ctx), ctx);
  const ps = flat(evaluate(args[1]!, ctx), ctx);
  const lower = evaluate(args[2]!, ctx);
  const upper = args[3] && args[3].k !== "missing" ? evaluate(args[3], ctx) : undefined;
  return ctx.engine.liftN(upper === undefined ? [lower] : [lower, upper], ctx, (items) =>
    attempt(() => {
      for (const item of items) if (item instanceof XlError) return item;
      const lo = num(items[0]!);
      const hi = items.length > 1 ? num(items[1]!) : lo;
      if (xs.length !== ps.length) return NA;
      let total = 0;
      let result = 0;
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i]!;
        const p = ps[i]!;
        if (x instanceof XlError) return x;
        if (p instanceof XlError) return p;
        if (typeof x !== "number" || typeof p !== "number") continue;
        if (p < 0 || p > 1) return NUM;
        total += p;
        if (x >= lo && x <= hi) result += p;
      }
      if (Math.abs(total - 1) > 1e-7) return NUM;
      return result;
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Distributions

/** The root of an inverse distribution, or #N/A when the search does not close in on one. */
function inverse(f: (x: number) => number, ax: number, bx: number): Scalar {
  const x = D.iterateInverse(f, ax, bx);
  return Number.isFinite(x) ? x : NA;
}

const finite = (value: number): Scalar => (Number.isFinite(value) ? value : NUM);

function tInverse(p: number, df: number, type: 1 | 2 | 4): Scalar {
  return inverse((x) => p - D.tDist(x, df, type), df * 0.5, df);
}

function binomDist(x: number, n: number, p: number, cumulative: boolean): Scalar {
  if (n < 0 || x < 0 || x > n || p < 0 || p > 1) return NUM;
  if (p === 0) return x === 0 || cumulative ? 1 : 0;
  if (p === 1) return x === n ? 1 : 0;
  return cumulative ? D.binomCdf(x, n, p) : D.binomPmf(x, n, p);
}

function binomRange(n: number, p: number, xs: number, xe: number): Scalar {
  if (n < 0 || xs < 0 || xs > xe || xe > n || p < 0 || p > 1) return NUM;
  if (p === 0) return xs === 0 ? 1 : 0;
  if (p === 1) return xe === n ? 1 : 0;
  if (xs === xe) return D.binomPmf(xs, n, p);
  const q = 0.5 - p + 0.5;
  let factor = q ** n;
  if (factor > Number.MIN_VALUE * 2 ** 52) return D.binomRange(n, xs, xe, factor, p, q);
  factor = p ** n;
  if (factor > Number.MIN_VALUE * 2 ** 52) return D.binomRange(n, n - xe, n - xs, factor, q, p);
  return D.betaDist(q, n - xe, xe + 1) - D.betaDist(q, n - xs + 1, xs);
}

function critBinom(n: number, p: number, alpha: number): Scalar {
  if (n < 0 || alpha < 0 || alpha > 1 || p < 0 || p > 1) return NUM;
  if (alpha === 0) return 0;
  if (alpha === 1) return p === 0 ? 0 : n;
  const q = 0.5 - p + 0.5;
  const tiny = 2.2250738585072014e-308;
  if (q > p) {
    let factor = q ** n;
    if (factor > tiny) {
      const total = new D.KahanSum(factor);
      let i = 0;
      for (; i < n && total.get() < alpha; i++) {
        factor *= ((n - i) / (i + 1)) * (p / q);
        total.add(factor);
      }
      return i;
    }
    const total = new D.KahanSum();
    let i = 0;
    for (; i < n && total.get() < alpha; i++) total.add(D.betaPdf(p, i + 1, n - i + 1) / (n + 1));
    return i - 1;
  }
  let factor = p ** n;
  if (factor > tiny) {
    const total = new D.KahanSum(1 - factor);
    let i = 0;
    for (; i < n && total.get() >= alpha; i++) {
      factor *= ((n - i) / (i + 1)) * (q / p);
      total.add(-factor);
    }
    return n - i;
  }
  const total = new D.KahanSum();
  let i = 0;
  for (; i < n && total.get() < 1 - alpha; i++) total.add(D.betaPdf(q, i + 1, n - i + 1) / (n + 1));
  return n - i + 1;
}

function hypGeomDist(x: number, n: number, M: number, N: number, cumulative: boolean): Scalar {
  if (x < 0 || n < 0 || N < n || N < M || M < 0) return NUM;
  const total = new D.KahanSum();
  for (let i = cumulative ? 0 : x; i <= x; i++)
    if (n - i <= N - M && i <= M && i <= n) total.add(D.hypGeom(i, n, M, N));
  return total.get();
}

function negBinomPmf(f: number, s: number, p: number): number {
  const q = 1 - p;
  let factor = p ** s;
  for (let i = 0; i < f; i++) factor *= ((i + s) / (i + 1)) * q;
  return factor;
}

function poisson(x: number, lambda: number, cumulative: boolean): Scalar {
  if (x < 0 || lambda < 0) return NUM;
  if (lambda === 0) return cumulative || x === 0 ? 1 : 0;
  if (!cumulative) {
    if (lambda > 712) return Math.exp(x * Math.log(lambda) - lambda - D.logGamma(x + 1));
    let value = 1;
    for (let f = 0; f < x; f++) value *= lambda / (f + 1);
    return value * Math.exp(-lambda);
  }
  return D.upRegIGamma(x + 1, lambda);
}

function weibull(x: number, alpha: number, beta: number, cumulative: boolean): Scalar {
  if (x < 0 || alpha <= 0 || beta <= 0) return NUM;
  if (cumulative) return -Math.expm1(-((x / beta) ** alpha));
  return (alpha / beta ** alpha) * x ** (alpha - 1) * Math.exp(-((x / beta) ** alpha));
}

function betaDist(
  x: number,
  alpha: number,
  beta: number,
  cumulative: boolean,
  a: number,
  b: number,
): Scalar {
  if (alpha <= 0 || beta <= 0 || x < a || x > b || a >= b) return NUM;
  const scale = b - a;
  const z = (x - a) / scale;
  return cumulative ? D.betaDist(z, alpha, beta) : finite(D.betaPdf(z, alpha, beta) / scale);
}

function betaInv(p: number, alpha: number, beta: number, a: number, b: number): Scalar {
  if (p <= 0 || p >= 1 || a >= b || alpha <= 0 || beta <= 0) return NUM;
  const x = inverse((t) => p - D.betaDist(t, alpha, beta), 0, 1);
  return typeof x === "number" ? a + x * (b - a) : x;
}

function gammaDist(x: number, alpha: number, beta: number, cumulative: boolean): Scalar {
  if (x < 0 || alpha <= 0 || beta <= 0) return NUM;
  return cumulative ? D.gammaCdf(x, alpha, beta) : finite(D.gammaPdf(x, alpha, beta));
}

function gammaInv(p: number, alpha: number, beta: number): Scalar {
  if (alpha <= 0 || beta <= 0 || p < 0 || p >= 1) return NUM;
  if (p === 0) return 0;
  const start = alpha * beta;
  return inverse((x) => p - D.gammaCdf(x, alpha, beta), start * 0.5, start);
}

function fDistLeft(x: number, f1: number, f2: number, cumulative: boolean): Scalar {
  f1 = Math.trunc(f1);
  f2 = Math.trunc(f2);
  if (x < 0 || f1 < 1 || f2 < 1 || f1 >= 1e10 || f2 >= 1e10) return NUM;
  if (cumulative) return D.fTails(x, f1, f2)[0];
  return (
    ((f1 / f2) ** (f1 / 2) * x ** (f1 / 2 - 1)) /
    ((1 + (x * f1) / f2) ** ((f1 + f2) / 2) * D.beta(f1 / 2, f2 / 2))
  );
}

function fDistRight(x: number, f1: number, f2: number): Scalar {
  f1 = Math.trunc(f1);
  f2 = Math.trunc(f2);
  if (x < 0 || f1 < 1 || f2 < 1 || f1 >= 1e10 || f2 >= 1e10) return NUM;
  return D.fDist(x, f1, f2);
}

function fInv(p: number, f1: number, f2: number, right: boolean): Scalar {
  f1 = Math.trunc(f1);
  f2 = Math.trunc(f2);
  if (p < 0 || p > 1 || f1 < 1 || f2 < 1 || f1 >= 1e10 || f2 >= 1e10) return NUM;
  if (right ? p === 0 : p === 1) return NUM;
  if (!right && p === 0) return 0;
  return inverse((x) => p - D.fTails(x, f1, f2, true)[right ? 1 : 0], f1 * 0.5, f1);
}

function chiSqDist(x: number, df: number, cumulative: number): Scalar {
  df = Math.trunc(df);
  if (x < 0 || df < 1 || df > 1e10) return NUM;
  return cumulative ? D.chiSqCdf(x, df) : D.chiSqPdf(x, df);
}

function chiDistRight(x: number, df: number): Scalar {
  df = Math.trunc(df);
  if (x < 0 || df < 1 || df > 1e10) return NUM;
  return D.chiDist(x, df);
}

function chiSqInv(p: number, df: number): Scalar {
  df = Math.trunc(df);
  if (df < 1 || p < 0 || p >= 1) return NUM;
  if (p === 0) return 0;
  return inverse((x) => p - D.chiSqCdf(x, df), df * 0.5, df);
}

function chiInvRight(p: number, df: number): Scalar {
  df = Math.trunc(df);
  if (df < 1 || p <= 0 || p > 1) return NUM;
  return inverse((x) => p - D.chiDist(x, df), df * 0.5, df);
}

function normInv(p: number, m: number, s: number): Scalar {
  if (s <= 0 || p <= 0 || p >= 1) return NUM;
  return D.gaussInv(p) * s + m;
}

const normPdf = (z: number) => D.phi(z);

function tDistTails(t: number, df: number, tails: number): Scalar {
  df = Math.trunc(df);
  tails = Math.trunc(tails);
  if (t < 0 || df < 1 || (tails !== 1 && tails !== 2)) return NUM;
  return D.tDist(t, df, tails as 1 | 2);
}

function trimMean(args: Node[], ctx: Context): Value {
  let values: number[] | null = null;
  return each(evaluate(args[1]!, ctx), ctx, (a) => {
    if (a instanceof XlError) return a;
    const alpha = num(a);
    values ??= sorted(collect([args[0]!], ctx));
    if (alpha < 0 || alpha >= 1) return NUM;
    const n = values.length;
    if (!n) return NUM;
    let index = Math.floor(alpha * n);
    if (index % 2) index--;
    index /= 2;
    const total = new D.KahanSum();
    for (let i = index; i < n - index; i++) total.add(values[i]!);
    return total.get() / (n - 2 * index);
  });
}

function skew(values: number[], population: boolean): Scalar {
  const n = values.length;
  if (n < 3) return DIV0;
  const average = sum(values) / n;
  let squares = 0;
  for (const value of values) squares += (value - average) * (value - average);
  const sd = Math.sqrt(squares / (population ? n : n - 1));
  if (sd === 0) return DIV0;
  let cubes = 0;
  for (const value of values) {
    const d = (value - average) / sd;
    cubes += d * d * d;
  }
  return population ? cubes / n : cubes * (n / ((n - 1) * (n - 2)));
}

function frequency(args: Node[], ctx: Context): Value {
  const source = evaluate(args[0]!, ctx);
  if (typeof source === "boolean") return VALUE;
  const data = collect([{ k: "value", v: source }], ctx);
  const binItems = flat(evaluate(args[1]!, ctx), ctx);
  const error = binItems.find((item): item is XlError => item instanceof XlError);
  if (error) return error;
  let bins = numbersIn(binItems);
  if (!bins.length) bins = [0];
  const order = bins.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const counts = new Array<number>(bins.length + 1).fill(0);
  for (const value of data) {
    const slot = order.find((bin) => value <= bin.value);
    counts[slot ? slot.index : bins.length]!++;
  }
  return new Matrix(counts.length, 1, counts);
}

const statsOf =
  (impl: (values: number[]) => Scalar, mode: "plain" | "a" = "plain"): Fn =>
  (args, ctx) =>
    impl(collect(args, ctx, mode));

function sqrt(value: Scalar): Scalar {
  return typeof value === "number" ? Math.sqrt(value) : value;
}

const trunc = Math.trunc;

export const STATS: Record<string, Fn> = {
  ...ETS,
  AVERAGE: statsOf((v) => (v.length ? sumAdjusted(v) / v.length : DIV0)),
  AVERAGEA: statsOf((v) => (v.length ? sumAdjusted(v) / v.length : DIV0), "a"),
  MAX: statsOf((v) => (v.length ? Math.max(...v) : 0)),
  MIN: statsOf((v) => (v.length ? Math.min(...v) : 0)),
  MAXA: statsOf((v) => (v.length ? Math.max(...v) : 0), "a"),
  MINA: statsOf((v) => (v.length ? Math.min(...v) : 0), "a"),
  MEDIAN: statsOf((v) => {
    if (!v.length) return NUM;
    const s = sorted(v);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  }),
  "MODE.SNGL": (args, ctx) => modes(modeValues(args, ctx))[0] ?? NA,
  MODE: (args, ctx) => modes(modeValues(args, ctx))[0] ?? NA,
  "MODE.MULT": (args, ctx) => {
    if (args.some((arg) => arg.k === "missing")) return VALUE;
    const found = modes(modeValues(args, ctx));
    return found.length ? new Matrix(found.length, 1, found) : NA;
  },
  STDEV: statsOf((v) => sqrt(variance(v, true))),
  "STDEV.S": statsOf((v) => sqrt(variance(v, true))),
  STDEVP: statsOf((v) => sqrt(variance(v, false))),
  "STDEV.P": statsOf((v) => sqrt(variance(v, false))),
  STDEVA: statsOf((v) => sqrt(variance(v, true, true)), "a"),
  STDEVPA: statsOf((v) => sqrt(variance(v, false, true)), "a"),
  VAR: statsOf((v) => variance(v, true)),
  "VAR.S": statsOf((v) => variance(v, true)),
  VARP: statsOf((v) => variance(v, false)),
  "VAR.P": statsOf((v) => variance(v, false)),
  VARA: statsOf((v) => variance(v, true, true), "a"),
  VARPA: statsOf((v) => variance(v, false, true), "a"),
  DEVSQ: statsOf((v) => (v.length ? devsq(v) : NUM)),
  AVEDEV: statsOf((v) => {
    if (!v.length) return NUM;
    const m = mean(v);
    return sum(v.map((x) => Math.abs(x - m))) / v.length;
  }),
  GEOMEAN: statsOf((v) => {
    if (!v.length || v.some((x) => x <= 0)) return NUM;
    return Math.exp(sum(v.map(Math.log)) / v.length);
  }),
  HARMEAN: statsOf((v) => {
    if (!v.length || v.some((x) => x <= 0)) return NUM;
    return v.length / sum(v.map((x) => 1 / x));
  }),
  KURT: statsOf((v) => {
    const n = v.length;
    if (n < 4) return DIV0;
    const m = mean(v);
    const s = Math.sqrt(devsq(v) / (n - 1));
    if (s === 0) return DIV0;
    const fourth = sum(v.map((x) => ((x - m) / s) ** 4));
    return (
      ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * fourth -
      (3 * (n - 1) ** 2) / ((n - 2) * (n - 3))
    );
  }),
  SKEW: statsOf((v) => skew(v, false)),
  "SKEW.P": statsOf((v) => skew(v, true)),
  TRIMMEAN: trimMean,
  COUNT: (args, ctx) =>
    counted(args, ctx, (item, fromRange) => {
      if (typeof item === "number") return true;
      if (fromRange) return false;
      if (typeof item === "boolean") return true;
      if (typeof item === "string") return parseNumber(item) !== null;
      return false;
    }),
  COUNTA: (args, ctx) => counted(args, ctx, (item) => item !== null),
  COUNTBLANK: (args, ctx) => {
    const value = evaluate(args[0]!, ctx);
    if (!(value instanceof Ref)) return VALUE;
    let filled = 0;
    let size = 0;
    for (const area of value.areas) size += (area.r2 - area.r1 + 1) * (area.c2 - area.c1 + 1);
    for (const item of ctx.engine.cellsIn(value)) if (item !== null && item !== "") filled++;
    return size - filled;
  },
  COUNTIF: (args, ctx) => conditional(args, ctx, [0], null, (values) => values.length),
  COUNTIFS: (args, ctx) =>
    conditional(args, ctx, ifsPairs(args, 0), null, (values) => values.length),
  AVERAGEIF: (args, ctx) =>
    conditional(args, ctx, [0], 2, (values) => (values.length ? mean(values) : DIV0), true),
  AVERAGEIFS: (args, ctx) =>
    conditional(args, ctx, ifsPairs(args, 1), 0, (values) => (values.length ? mean(values) : DIV0)),
  MAXIFS: (args, ctx) =>
    conditional(args, ctx, ifsPairs(args, 1), 0, (values) =>
      values.length ? Math.max(...values) : 0,
    ),
  MINIFS: (args, ctx) =>
    conditional(args, ctx, ifsPairs(args, 1), 0, (values) =>
      values.length ? Math.min(...values) : 0,
    ),
  LARGE: (args, ctx) => kth(args, ctx, true),
  SMALL: (args, ctx) => kth(args, ctx, false),
  RANK: (args, ctx) => rank(args, ctx, false),
  "RANK.EQ": (args, ctx) => rank(args, ctx, false),
  "RANK.AVG": (args, ctx) => rank(args, ctx, true),
  PERCENTILE: (args, ctx) => percentile(args, ctx, percentileInc, false),
  "PERCENTILE.INC": (args, ctx) => percentile(args, ctx, percentileInc, false),
  "PERCENTILE.EXC": (args, ctx) => percentile(args, ctx, percentileExc, false),
  QUARTILE: (args, ctx) => percentile(args, ctx, percentileInc, true),
  "QUARTILE.INC": (args, ctx) => percentile(args, ctx, percentileInc, true),
  "QUARTILE.EXC": (args, ctx) => percentile(args, ctx, percentileExc, true),
  PERCENTRANK: (args, ctx) => percentRank(args, ctx, false),
  "PERCENTRANK.INC": (args, ctx) => percentRank(args, ctx, false),
  "PERCENTRANK.EXC": (args, ctx) => percentRank(args, ctx, true),
  FREQUENCY: frequency,
  CORREL: (args, ctx) => correl(args, ctx),
  PEARSON: (args, ctx) => correl(args, ctx),
  RSQ: (args, ctx) => {
    const r = correl(args, ctx);
    return typeof r === "number" ? r * r : r;
  },
  COVAR: (args, ctx) => covariance(args, ctx, false),
  "COVARIANCE.P": (args, ctx) => covariance(args, ctx, false),
  "COVARIANCE.S": (args, ctx) => covariance(args, ctx, true),
  SLOPE: (args, ctx) => {
    const data = pairs(args, ctx);
    if (data instanceof XlError) return data;
    const r = regression(...data);
    return r.n < 1 || r.sxx === 0 ? DIV0 : r.sxy / r.sxx;
  },
  INTERCEPT: (args, ctx) => {
    const data = pairs(args, ctx);
    if (data instanceof XlError) return data;
    const r = regression(...data);
    return r.n < 1 || r.sxx === 0 ? DIV0 : r.my - (r.sxy / r.sxx) * r.mx;
  },
  STEYX: (args, ctx) => {
    const data = pairs(args, ctx);
    if (data instanceof XlError) return data;
    const r = regression(...data);
    if (r.n < 3 || r.sxx === 0) return DIV0;
    return Math.sqrt((r.syy - (r.sxy * r.sxy) / r.sxx) / (r.n - 2));
  },
  FORECAST: (args, ctx) => forecast(args, ctx),
  "FORECAST.LINEAR": (args, ctx) => forecast(args, ctx),
  TREND: (args, ctx) => attempt(() => trend(args, ctx, false)),
  GROWTH: (args, ctx) => attempt(() => trend(args, ctx, true)),
  LINEST: (args, ctx) => attempt(() => linest(args, ctx, false)),
  LOGEST: (args, ctx) => attempt(() => linest(args, ctx, true)),
  "T.TEST": tTest,
  TTEST: tTest,
  "F.TEST": fTest,
  FTEST: fTest,
  "CHISQ.TEST": chiTest,
  CHITEST: chiTest,
  "Z.TEST": zTest,
  ZTEST: zTest,
  PROB: prob,
  STANDARDIZE: numeric((x, m, s) => (s <= 0 ? NUM : (x - m) / s)),
  "NORM.S.DIST": numeric(
    (z, cumulative) => (cumulative ? D.integralPhi(z) : normPdf(z)),
    [0, 1],
    [1],
  ),
  NORMSDIST: numeric((z) => D.integralPhi(z)),
  "NORM.DIST": numeric(
    (x, m, s, cumulative) => {
      if (s <= 0) return NUM;
      return cumulative ? D.integralPhi((x - m) / s) : normPdf((x - m) / s) / s;
    },
    [],
    [3],
  ),
  NORMDIST: numeric(
    (x, m, s, cumulative) => {
      if (s <= 0) return NUM;
      return cumulative ? D.integralPhi((x - m) / s) : normPdf((x - m) / s) / s;
    },
    [],
    [3],
  ),
  "NORM.S.INV": numeric((p) => normInv(p, 0, 1)),
  NORMSINV: numeric((p) => normInv(p, 0, 1)),
  "NORM.INV": numeric(normInv),
  NORMINV: numeric(normInv),
  "LOGNORM.DIST": numeric(
    (x, m, s, cumulative) => {
      if (x <= 0 || s <= 0) return NUM;
      const z = (Math.log(x) - m) / s;
      return cumulative ? D.integralPhi(z) : normPdf(z) / (x * s);
    },
    [],
    [3],
  ),
  LOGNORMDIST: numeric((x, m, s) =>
    x <= 0 || s <= 0 ? NUM : D.integralPhi((Math.log(x) - m) / s),
  ),
  "LOGNORM.INV": numeric((p, m, s) =>
    p <= 0 || p >= 1 || s <= 0 ? NUM : Math.exp(m + s * D.gaussInv(p)),
  ),
  LOGINV: numeric((p, m, s) =>
    p <= 0 || p >= 1 || s <= 0 ? NUM : Math.exp(m + s * D.gaussInv(p)),
  ),
  PHI: numeric((x) => D.phi(x)),
  GAUSS: numeric((x) => D.gauss(x)),
  "EXPON.DIST": numeric(
    (x, lambda, cumulative) => {
      if (x < 0 || lambda <= 0) return NUM;
      return cumulative ? -Math.expm1(-lambda * x) : lambda * Math.exp(-lambda * x);
    },
    [],
    [2],
  ),
  EXPONDIST: numeric(
    (x, lambda, cumulative) => {
      if (x < 0 || lambda <= 0) return NUM;
      return cumulative ? -Math.expm1(-lambda * x) : lambda * Math.exp(-lambda * x);
    },
    [],
    [2],
  ),
  "POISSON.DIST": numeric((x, m, cumulative) => poisson(trunc(x), m, !!cumulative), [], [2]),
  POISSON: numeric((x, m, cumulative) => poisson(trunc(x), m, !!cumulative), [], [2]),
  "BINOM.DIST": numeric(
    (k, n, p, cumulative) => binomDist(trunc(k), trunc(n), p, !!cumulative),
    [],
    [3],
  ),
  BINOMDIST: numeric(
    (k, n, p, cumulative) => binomDist(trunc(k), trunc(n), p, !!cumulative),
    [],
    [3],
  ),
  "BINOM.DIST.RANGE": numeric(
    (n, p, s, s2) => binomRange(trunc(n), p, trunc(s), trunc(Number.isNaN(s2) ? s : s2)),
    [0, 0, 0, NaN],
  ),
  "BINOM.INV": numeric((n, p, alpha) => critBinom(trunc(n), p, alpha)),
  CRITBINOM: numeric((n, p, alpha) => critBinom(trunc(n), p, alpha)),
  "NEGBINOM.DIST": numeric(
    (f, s, p, cumulative) => {
      f = trunc(f);
      s = trunc(s);
      if (s < 1 || f < 0 || p <= 0 || p > 1) return NUM;
      return cumulative ? D.betaDist(p, s, f + 1) : negBinomPmf(f, s, p);
    },
    [],
    [3],
  ),
  NEGBINOMDIST: numeric((f, s, p) => {
    f = trunc(f);
    s = trunc(s);
    if (s < 1 || f < 0 || p <= 0 || p > 1) return NUM;
    return negBinomPmf(f, s, p);
  }),
  "HYPGEOM.DIST": numeric(
    (x, n, M, N, cumulative) => hypGeomDist(trunc(x), trunc(n), trunc(M), trunc(N), !!cumulative),
    [],
    [4],
  ),
  HYPGEOMDIST: numeric((x, n, M, N) => hypGeomDist(trunc(x), trunc(n), trunc(M), trunc(N), false)),
  PERMUTATIONA: numeric((n, k) => {
    n = trunc(n);
    k = trunc(k);
    return n < 0 || k < 0 ? NUM : finite(n ** k);
  }),
  "WEIBULL.DIST": numeric(
    (x, alpha, beta, cumulative) => weibull(x, alpha, beta, !!cumulative),
    [],
    [3],
  ),
  WEIBULL: numeric((x, alpha, beta, cumulative) => weibull(x, alpha, beta, !!cumulative), [], [3]),
  "BETA.DIST": numeric(
    (x, alpha, beta, cumulative, a, b) => betaDist(x, alpha, beta, !!cumulative, a, b),
    [0, 0, 0, 0, 0, 1],
    [3],
  ),
  BETADIST: numeric(
    (x, alpha, beta, a, b) => betaDist(x, alpha, beta, true, a, b),
    [0, 0, 0, 0, 1],
  ),
  "BETA.INV": numeric(betaInv, [0, 0, 0, 0, 1]),
  BETAINV: numeric(betaInv, [0, 0, 0, 0, 1]),
  GAMMALN: numeric((x) => (x <= 0 ? NUM : D.logGamma(x))),
  "GAMMALN.PRECISE": numeric((x) => (x <= 0 ? NUM : D.logGamma(x))),
  GAMMA: numeric((x) => (x <= 0 && Number.isInteger(x) ? NUM : finite(D.gamma(x)))),
  "GAMMA.DIST": numeric(
    (x, alpha, beta, cumulative) => gammaDist(x, alpha, beta, !!cumulative),
    [],
    [3],
  ),
  GAMMADIST: numeric(
    (x, alpha, beta, cumulative) => gammaDist(x, alpha, beta, !!cumulative),
    [],
    [3],
  ),
  "GAMMA.INV": numeric(gammaInv),
  GAMMAINV: numeric(gammaInv),
  "T.DIST": numeric(
    (t, df, cumulative) => {
      df = trunc(df);
      if (df === 0 && !cumulative) return DIV0;
      if (df < 1) return NUM;
      return D.tDist(t, df, cumulative ? 4 : 3);
    },
    [],
    [2],
  ),
  "T.DIST.2T": numeric((t, df) => tDistTails(t, df, 2)),
  "T.DIST.RT": numeric((t, df) => {
    df = trunc(df);
    if (df < 1) return NUM;
    const right = D.tDist(t, df, 1);
    return t < 0 ? 1 - right : right;
  }),
  TDIST: numeric(tDistTails),
  "T.INV": numeric((p, df) => {
    df = trunc(df);
    if (df < 1 || p <= 0 || p >= 1) return NUM;
    if (p === 0.5) return 0;
    const x = tInverse(p < 0.5 ? 1 - p : p, df, 4);
    return p < 0.5 && typeof x === "number" ? -x : x;
  }),
  "T.INV.2T": numeric((p, df) =>
    trunc(df) < 1 || p <= 0 || p > 1 ? NUM : tInverse(p, trunc(df), 2),
  ),
  TINV: numeric((p, df) => (trunc(df) < 1 || p <= 0 || p > 1 ? NUM : tInverse(p, trunc(df), 2))),
  "CHISQ.DIST": numeric(chiSqDist, [], [2]),
  "CHISQ.DIST.RT": numeric(chiDistRight),
  CHIDIST: numeric(chiDistRight),
  "CHISQ.INV": numeric(chiSqInv),
  "CHISQ.INV.RT": numeric(chiInvRight),
  CHIINV: numeric(chiInvRight),
  "F.DIST": numeric((x, f1, f2, cumulative) => fDistLeft(x, f1, f2, !!cumulative), [], [3]),
  "F.DIST.RT": numeric(fDistRight),
  FDIST: numeric(fDistRight),
  "F.INV": numeric((p, f1, f2) => fInv(p, f1, f2, false)),
  "F.INV.RT": numeric((p, f1, f2) => fInv(p, f1, f2, true)),
  FINV: numeric((p, f1, f2) => fInv(p, f1, f2, true)),
  FISHER: numeric((x) => (x <= -1 || x >= 1 ? NUM : 0.5 * Math.log((1 + x) / (1 - x)))),
  FISHERINV: numeric((y) => (Math.exp(2 * y) - 1) / (Math.exp(2 * y) + 1)),
  "CONFIDENCE.NORM": numeric(confidence),
  CONFIDENCE: numeric(confidence),
  "CONFIDENCE.T": numeric((alpha, s, n) => {
    n = trunc(n);
    if (s <= 0 || alpha <= 0 || alpha >= 1 || n < 1) return NUM;
    if (n === 1) return DIV0;
    const t = tInverse(alpha, n - 1, 2);
    return typeof t === "number" ? (s * t) / Math.sqrt(n) : t;
  }),
};

function confidence(alpha: number, s: number, n: number): Scalar {
  n = trunc(n);
  if (s <= 0 || alpha <= 0 || alpha >= 1 || n < 1) return NUM;
  return (D.gaussInv(1 - alpha / 2) * s) / Math.sqrt(n);
}
