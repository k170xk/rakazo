import type { Context } from "../engine.js";
import { power } from "../engine.js";
import { cos, exp, log, sin, tan } from "../exact.js";
import type { Node } from "../parse.js";
import type { Scalar, Value } from "../values.js";
import {
  addAdjusted,
  DIV0,
  isError,
  Matrix,
  NUM,
  numbersEqual,
  Ref,
  round15,
  VALUE,
  XlError,
} from "../values.js";
import { logGamma } from "./distributions.js";
import type { Fn } from "./helpers.js";
import {
  argMatrix,
  check,
  collect,
  criterion,
  evaluate,
  flat,
  num,
  numeric,
  roundDecimal,
  scalar,
  single,
} from "./helpers.js";

const finite = (value: number): Scalar => (Number.isFinite(value) ? value : NUM);

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

/**
 * CEILING/FLOOR as Excel computes them: the multiple is chosen from the 15-digit quotient, so
 * 2.5/0.1 counts as 25, and the result is that multiple times the step as calculated, so
 * FLOOR(0.74, 0.05) is 14 * 0.05 = 0.7000000000000001.
 */
function toMultiple(x: number, step: number, mode: "up" | "down" | "away" | "toward"): number {
  if (step === 0 || x === 0) return 0;
  const q = round15(x / step);
  let n: number;
  switch (mode) {
    case "up":
      n = Math.ceil(q);
      break;
    case "down":
      n = Math.floor(q);
      break;
    case "away":
      n = q < 0 ? Math.floor(q) : Math.ceil(q);
      break;
    case "toward":
      n = Math.trunc(q);
      break;
  }
  return n * step;
}

const SUBTOTAL_FNS: Record<number, string> = {
  1: "AVERAGE",
  2: "COUNT",
  3: "COUNTA",
  4: "MAX",
  5: "MIN",
  6: "PRODUCT",
  7: "STDEV",
  8: "STDEVP",
  9: "SUM",
  10: "VAR",
  11: "VARP",
};

/** Trigonometry Excel refuses for angles of 2^27 radians or more. */
const angle = (fn: (x: number) => Scalar): Fn =>
  numeric((x) => (Math.abs(x) >= 134217728 ? NUM : fn(x)));

export const MATH: Record<string, Fn> = {
  ABS: numeric((x) => Math.abs(x)),
  SIGN: numeric((x) => Math.sign(x)),
  SQRT: numeric((x) => (x < 0 ? NUM : Math.sqrt(x))),
  SQRTPI: numeric((x) => (x < 0 ? NUM : Math.sqrt(x * Math.PI))),
  EXP: numeric((x) => finite(exp(x))),
  LN: numeric((x) => (x <= 0 ? NUM : log(x))),
  LOG10: numeric((x) => (x <= 0 ? NUM : Math.log10(x))),
  LOG: numeric(
    (x, base) => {
      if (Number.isNaN(base)) return x <= 0 ? NUM : Math.log10(x);
      if (x <= 0 || base <= 0) return NUM;
      if (base === 1) return DIV0;
      return log(x) / log(base);
    },
    [0, Number.NaN],
  ),
  POWER: numeric((x, y) => power(x, y)),
  PI: () => Math.PI,
  RADIANS: numeric((x) => x * (Math.PI / 180)),
  DEGREES: numeric((x) => x * (180 / Math.PI)),
  SIN: angle(sin),
  COS: angle(cos),
  TAN: angle(tan),
  ASIN: numeric((x) =>
    x < -1 || x > 1
      ? NUM
      : Math.abs(x) === 1
        ? x * (Math.PI / 2)
        : Math.atan(x / Math.sqrt(1 - x * x)),
  ),
  ACOS: numeric((x) => (x < -1 || x > 1 ? NUM : Math.acos(x))),
  ATAN: numeric((x) => Math.atan(x)),
  ATAN2: numeric((x, y) => (x === 0 && y === 0 ? DIV0 : Math.atan2(y, x))),
  SINH: numeric((x) => finite(Math.sinh(x))),
  COSH: numeric((x) => finite(Math.cosh(x))),
  TANH: numeric((x) => Math.tanh(x)),
  ASINH: numeric((x) => Math.asinh(x)),
  ACOSH: numeric((x) => (x < 1 ? NUM : Math.acosh(x))),
  ATANH: numeric((x) => (x <= -1 || x >= 1 ? NUM : Math.atanh(x))),
  COT: angle((x) => (x === 0 ? DIV0 : 1 / tan(x))),
  CSC: angle((x) => (x === 0 ? DIV0 : 1 / sin(x))),
  SEC: angle((x) => 1 / cos(x)),
  COTH: numeric((x) => (x === 0 ? DIV0 : 1 / Math.tanh(x))),
  CSCH: numeric((x) => (x === 0 ? DIV0 : 1 / Math.sinh(x))),
  SECH: numeric((x) => 1 / Math.cosh(x)),
  ACOTH: numeric((x) => (Math.abs(x) <= 1 ? NUM : Math.atanh(1 / x))),
  ACOT: numeric((x) => (x > 0 ? Math.atan(1 / x) : Math.PI / 2 - Math.atan(x))),
  INT: numeric((x) => Math.floor(round15(x))),
  TRUNC: numeric((x, digits) => roundDecimal(x, digits, "down"), [0, 0]),
  ROUND: numeric((x, digits) => roundDecimal(x, digits, "half")),
  ROUNDUP: numeric((x, digits) => {
    // Excel rounds down, then adds one step: ROUNDUP(0.0916,2) is 0.09 + 0.01 = 0.09999999999999999.
    const down = roundDecimal(x, digits, "down");
    if (roundDecimal(x, digits, "up") === down) return down;
    return down + Math.sign(x) * (1 / 10 ** Math.trunc(digits));
  }),
  ROUNDDOWN: numeric((x, digits) => roundDecimal(x, digits, "down")),
  MROUND: numeric((x, m) => {
    if (m === 0) return 0;
    if (Math.sign(x) * Math.sign(m) < 0) return NUM;
    const q = round15(x / m);
    return round15(roundDecimal(q, 0, "half") * m);
  }),
  CEILING: scalar((items, ctx) => {
    for (const item of items) if (isError(item)) return item;
    const x = num(items[0] ?? 0);
    const step = num(items[1] ?? 0);
    if (step === 0) return 0;
    if (x > 0 && step < 0) return NUM;
    // Before Excel 2010 a negative number with a positive step was an error too.
    if (x < 0 && step > 0 && ctx.engine.rules < 14) return NUM;
    return toMultiple(x, step, x < 0 && step < 0 ? "away" : "up");
  }),
  FLOOR: scalar((items, ctx) => {
    for (const item of items) if (isError(item)) return item;
    const x = num(items[0] ?? 0);
    const step = num(items[1] ?? 0);
    if (step === 0) return x === 0 ? 0 : DIV0;
    if (x > 0 && step < 0) return NUM;
    if (x < 0 && step > 0 && ctx.engine.rules < 14) return NUM;
    return toMultiple(x, step, x < 0 && step < 0 ? "toward" : "down");
  }),
  "CEILING.MATH": numeric(
    (x, step, modeValue) => {
      if (step === 0) return 0;
      const s = Math.abs(step);
      if (x < 0 && modeValue !== 0) return toMultiple(x, s, "away");
      return toMultiple(x, s, "up");
    },
    [0, 1, 0],
  ),
  "FLOOR.MATH": numeric(
    (x, step, modeValue) => {
      if (step === 0) return 0;
      const s = Math.abs(step);
      if (x < 0 && modeValue !== 0) return toMultiple(x, s, "toward");
      return toMultiple(x, s, "down");
    },
    [0, 1, 0],
  ),
  "CEILING.PRECISE": numeric(
    (x, step) => (step === 0 ? 0 : toMultiple(x, Math.abs(step), "up")),
    [0, 1],
  ),
  "ISO.CEILING": numeric(
    (x, step) => (step === 0 ? 0 : toMultiple(x, Math.abs(step), "up")),
    [0, 1],
  ),
  "FLOOR.PRECISE": numeric(
    (x, step) => (step === 0 ? 0 : toMultiple(x, Math.abs(step), "down")),
    [0, 1],
  ),
  EVEN: numeric((x) => {
    const n = Math.ceil(round15(Math.abs(x)) / 2) * 2;
    return x < 0 ? -n : n;
  }),
  ODD: numeric((x) => {
    let n = Math.ceil(round15(Math.abs(x)));
    if (n % 2 === 0) n += 1;
    return x < 0 ? -n : n;
  }),
  MOD: numeric((n, d) => {
    if (d === 0) return DIV0;
    const result = n - d * Math.floor(n / d);
    return Math.abs(result) < Math.abs(d) * 1e-15 ? 0 : result;
  }),
  QUOTIENT: numeric((n, d) => (d === 0 ? DIV0 : Math.trunc(n / d))),
  FACT: numeric((x) => (x < 0 ? NUM : finite(factorial(Math.floor(x))))),
  FACTDOUBLE: numeric((x) => {
    if (x < -1) return NUM;
    let result = 1;
    for (let i = Math.floor(x); i > 1; i -= 2) result *= i;
    return finite(result);
  }),
  // Excel works through log-gamma, so MULTINOMIAL(1,1,3) is 19.999999999999996, not 20.
  MULTINOMIAL: (args, ctx) => {
    const counts: number[] = [];
    for (const arg of args) {
      if (arg.k === "missing") continue;
      const value = evaluate(arg, ctx);
      const items: Scalar[] =
        value instanceof Ref
          ? [...ctx.engine.cellsIn(value)]
          : value instanceof Matrix
            ? value.data
            : [value];
      const direct = !(value instanceof Ref);
      for (const item of items) {
        if (item instanceof XlError) return item;
        if (typeof item === "boolean") return VALUE;
        if (item === null || (typeof item === "string" && !direct)) continue;
        counts.push(Math.trunc(num(item)));
      }
    }
    if (counts.some((n) => n < 0)) return NUM;
    const total = counts.reduce((a, b) => a + b, 0);
    let logResult = logGamma(total + 1);
    for (const n of counts) logResult -= logGamma(n + 1);
    return finite(Math.exp(logResult));
  },
  COMBIN: numeric((n, k) => {
    n = Math.trunc(n);
    k = Math.trunc(k);
    if (n < 0 || k < 0 || k > n) return NUM;
    let result = 1;
    for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
    return Math.round(result);
  }),
  COMBINA: numeric((n, k) => {
    n = Math.trunc(n);
    k = Math.trunc(k);
    if (n < 0 || k < 0) return NUM;
    let result = 1;
    for (let i = 1; i <= k; i++) result = (result * (n + k - 1 - k + i)) / i;
    return Math.round(result);
  }),
  PERMUT: numeric((n, k) => {
    n = Math.trunc(n);
    k = Math.trunc(k);
    if (n < 0 || k < 0 || k > n) return NUM;
    let result = 1;
    for (let i = 0; i < k; i++) result *= n - i;
    return result;
  }),
  GCD: (args, ctx) => {
    const values = wholeNumbers(args, ctx);
    if (values instanceof XlError) return values;
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    return values.reduce((a, b) => gcd(a, b), 0);
  },
  LCM: (args, ctx) => {
    const values = wholeNumbers(args, ctx);
    if (values instanceof XlError) return values;
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    return values.reduce((a, b) => (a === 0 || b === 0 ? 0 : (a * b) / gcd(a, b)), 1);
  },
  SUM: (args, ctx) => sumAdjusted(collect(args, ctx)),
  SUMSQ: (args, ctx) => sum(collect(args, ctx).map((x) => x * x)),
  PRODUCT: (args, ctx) => {
    const values = collect(args, ctx);
    return values.length ? values.reduce((a, b) => a * b, 1) : 0;
  },
  SUMPRODUCT: (args, ctx) => {
    const matrices = args.map((arg) =>
      ctx.engine.toMatrix(evaluate(arg, { ...ctx, array: true }), { ...ctx, array: true }),
    );
    if (!matrices.length) return VALUE;
    // The first error, array by array, wins even over arrays of different sizes.
    for (const matrix of matrices) {
      const error = matrix.data.find((item) => item instanceof XlError);
      if (error) return error;
    }
    const first = matrices[0]!;
    for (const matrix of matrices)
      if (matrix.rows !== first.rows || matrix.cols !== first.cols) return VALUE;
    let total = 0;
    for (let i = 0; i < first.data.length; i++) {
      let product = 1;
      for (const matrix of matrices) {
        const item = matrix.data[i]!;
        product *= typeof item === "number" ? item : 0;
      }
      total += product;
    }
    return total;
  },
  SUMX2MY2: pairSum((x, y) => x * x - y * y),
  SUMX2PY2: pairSum((x, y) => x * x + y * y),
  SUMXMY2: pairSum((x, y) => (x - y) ** 2),
  SUMIF: (args, ctx) => {
    const range = evaluate(args[0]!, ctx);
    const sumRange = args[2] ? evaluate(args[2], ctx) : range;
    const cells = flat(range, ctx);
    const values = shapeLike(range, sumRange, ctx);
    return eachCriterion(args, [1], ctx, ([condition]) => {
      const test = criterion(condition!);
      let total = 0;
      cells.forEach((cell, index) => {
        if (!test(cell)) return;
        const value = values[index];
        if (value instanceof XlError) throw value;
        if (typeof value === "number") total += value;
      });
      return total;
    });
  },
  SUMIFS: (args, ctx) => ifs(args, ctx, 1, (values) => sum(values)),
  RAND: (_args, ctx) => ctx.engine.rand(),
  RANDBETWEEN: (args, ctx) => {
    const low = Math.ceil(num(check(single(args, 0, ctx) ?? null)));
    const high = Math.floor(num(check(single(args, 1, ctx) ?? null)));
    if (low > high) return NUM;
    return low + Math.floor(ctx.engine.rand() * (high - low + 1));
  },
  SUBTOTAL: (args, ctx) => {
    const full = Math.trunc(num(check(single(args, 0, ctx) ?? null)));
    const name = SUBTOTAL_FNS[full % 100];
    if (!name || (full > 11 && full < 101) || full > 111) return VALUE;
    const skip = { hidden: full > 100, nested: true, errors: false };
    return FUNCTION_LOOKUP.get(name)!(
      args.slice(1).map((arg) => kept(arg, ctx, skip)),
      ctx,
    );
  },
  AGGREGATE: (args, ctx) => {
    const code = Math.trunc(num(check(single(args, 0, ctx) ?? null)));
    const names: Record<number, string> = {
      ...SUBTOTAL_FNS,
      12: "MEDIAN",
      13: "MODE.SNGL",
      14: "LARGE",
      15: "SMALL",
      16: "PERCENTILE.INC",
      17: "QUARTILE.INC",
      18: "PERCENTILE.EXC",
      19: "QUARTILE.EXC",
    };
    const name = names[code];
    if (!name) return VALUE;
    const options = Math.trunc(num(check(single(args, 1, ctx) ?? 0)));
    if (options < 0 || options > 7) return VALUE;
    const skip = {
      hidden: options % 2 === 1,
      nested: options < 4,
      errors: [2, 3, 6, 7].includes(options),
    };
    const fn = FUNCTION_LOOKUP.get(name)!;
    const rest = args.slice(2);
    if (code >= 14) return fn([kept(rest[0]!, ctx, skip), ...rest.slice(1)], ctx);
    return fn(
      rest.map((arg) => kept(arg, ctx, skip)),
      ctx,
    );
  },
  MMULT: (args, ctx) => {
    const a = argMatrix(args, 0, ctx);
    const b = argMatrix(args, 1, ctx);
    for (const m of [a, b])
      if (m.data.length === 1 && m.data[0] instanceof XlError) return m.data[0];
    if (a.cols !== b.rows) return VALUE;
    const bad = firstNonNumber(a) ?? firstNonNumber(b);
    if (bad) return bad;
    const data: Scalar[] = [];
    for (let r = 0; r < a.rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        let total = 0;
        for (let k = 0; k < a.cols; k++) total += (a.get(r, k) as number) * (b.get(k, c) as number);
        data.push(total);
      }
    }
    return new Matrix(a.rows, b.cols, data);
  },
  MDETERM: (args, ctx) => {
    const m = argMatrix(args, 0, ctx);
    if (m.rows !== m.cols) return VALUE;
    const bad = firstNonNumber(m);
    if (bad) return bad;
    return determinant(m.data as number[], m.rows);
  },
  MINVERSE: (args, ctx) => {
    const m = argMatrix(args, 0, ctx);
    if (m.rows !== m.cols) return VALUE;
    const n = m.rows;
    const bad = firstNonNumber(m);
    if (bad) return bad;
    const inverse = invert(m.data as number[], n);
    return inverse ? new Matrix(n, n, inverse) : NUM;
  },
  MUNIT: (args, ctx) => {
    const order = (x: Scalar): Scalar => {
      if (x instanceof XlError) return x;
      try {
        const n = num(x);
        return n < 1 ? VALUE : Math.trunc(n);
      } catch (error) {
        if (error instanceof XlError) return error;
        throw error;
      }
    };
    const value = ctx.engine.operand(args[0] ? evaluate(args[0], ctx) : VALUE, ctx);
    // Over an array each element gives its own identity matrix, of which only the corner 1 remains.
    if (value instanceof Matrix)
      return ctx.engine.lift1(value, ctx, (x) => {
        const n = order(x);
        return typeof n === "number" ? 1 : n;
      });
    const size = order(value);
    if (typeof size !== "number") return size;
    const data: Scalar[] = [];
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) data.push(r === c ? 1 : 0);
    return new Matrix(size, size, data);
  },
  SERIESSUM: (args, ctx) => {
    const x = num(check(single(args, 0, ctx) ?? null));
    const n = num(check(single(args, 1, ctx) ?? null));
    const m = num(check(single(args, 2, ctx) ?? null));
    const coefficients = collect([args[3]!], ctx);
    return coefficients.reduce((total, a, i) => total + a * x ** (n + i * m), 0);
  },
  ROMAN: scalar(([x, form]) => {
    if (x instanceof XlError) return x;
    if (form instanceof XlError) return form;
    let rest = Math.trunc(num(x ?? null));
    const mode =
      form === undefined || form === null
        ? 0
        : typeof form === "boolean"
          ? form
            ? 0
            : 4
          : Math.trunc(num(form));
    if (rest < 0 || rest > 3999 || mode < 0 || mode > 4) return VALUE;
    // Forms 1 to 4 let a subtracted letter reach further down, up to `mode` places.
    const letters = "MDCLXVI";
    const values = [1000, 500, 100, 50, 10, 5, 1];
    let out = "";
    for (let index = 0; index < values.length; index += 2) {
      const digit = Math.trunc(rest / values[index]!);
      if (digit % 5 === 4) {
        const larger = digit === 4 ? index - 1 : index - 2;
        let smaller = index;
        for (let step = 0; step < mode && smaller < values.length - 1; step++) {
          if (values[larger]! - values[smaller + 1]! > rest) break;
          smaller++;
        }
        out += letters[smaller]! + letters[larger]!;
        rest += values[smaller]! - values[larger]!;
      } else {
        if (digit > 4) out += letters[index - 1]!;
        out += letters[index]!.repeat(digit % 5);
        rest %= values[index]!;
      }
    }
    return out;
  }),
};

/**
 * SUM as Excel calculates it: in order, each step with the near-zero adjustment of + and -, so
 * =SUM(0.3,-0.2,-0.1) is 0 as =0.3-0.2-0.1 is.
 */
export function sumAdjusted(values: number[]): number {
  let total = 0;
  for (const value of values) total = addAdjusted(total, value);
  return total;
}

/** Excel adds in order, as doubles; nothing cleverer, so the result matches its last digit. */
export function sum(values: number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function pairSum(fn: (x: number, y: number) => number): Fn {
  return (args, ctx) => {
    const a = argMatrix(args, 0, ctx);
    const b = argMatrix(args, 1, ctx);
    if (a.data.length !== b.data.length) return XlError.of("#N/A");
    let total = 0;
    let counted = 0;
    for (let i = 0; i < a.data.length; i++) {
      const x = a.data[i];
      const y = b.data[i];
      if (x instanceof XlError) return x;
      if (y instanceof XlError) return y;
      if (typeof x === "number" && typeof y === "number") {
        total += fn(x, y);
        counted++;
      }
    }
    return counted ? total : DIV0;
  };
}

/** The cells of `target` laid over `range`'s shape, as SUMIF reads a sum range of another size. */
export function shapeLike(range: Value, target: Value, ctx: Context): Scalar[] {
  if (range instanceof Ref && target instanceof Ref) {
    const a = range.single;
    const b = target.single;
    if (a && b) {
      const resized = new Ref([
        { sheet: b.sheet, r1: b.r1, c1: b.c1, r2: b.r1 + (a.r2 - a.r1), c2: b.c1 + (a.c2 - a.c1) },
      ]);
      return flat(resized, ctx);
    }
  }
  return flat(target, ctx);
}

/**
 * Criteria arguments, each one value or (an array constant, or a range in an array formula) many:
 * with many, the function gives one result per criterion, as =SUM(SUMIF(A:A,{1,2},B:B)) relies on.
 */
export function eachCriterion(
  args: Node[],
  indices: number[],
  ctx: Context,
  fn: (conditions: Scalar[]) => Scalar,
): Value {
  const conditions = indices.map((i) => {
    const arg = args[i];
    if (!arg || arg.k === "missing") return null;
    const value = evaluate(arg, ctx);
    if (value instanceof Matrix) return value;
    if (value instanceof Ref && ctx.array) {
      const area = value.single;
      if (area && (area.r1 !== area.r2 || area.c1 !== area.c2))
        return ctx.engine.toMatrix(value, ctx);
    }
    return value instanceof Ref ? ctx.engine.toScalar(value, ctx) : value;
  });
  const run = (items: Scalar[]): Scalar => {
    try {
      return fn(items);
    } catch (error) {
      if (error instanceof XlError) return error;
      throw error;
    }
  };
  if (!conditions.some((c) => c instanceof Matrix)) return run(conditions as Scalar[]);
  return ctx.engine.liftN(conditions, { ...ctx, array: true, extent: undefined }, run);
}

/** The *IFS family: pairs of range and criteria, then `reduce` over the values that match all. */
export function ifs(
  args: Node[],
  ctx: Context,
  start: number,
  reduce: (values: number[]) => Scalar,
  valuesArg: number | null = 0,
): Value {
  const ranges: Scalar[][] = [];
  const indices: number[] = [];
  for (let i = start; i + 1 < args.length; i += 2) {
    ranges.push(flat(evaluate(args[i]!, ctx), ctx));
    indices.push(i + 1);
  }
  const length = ranges[0]?.length ?? 0;
  for (const cells of ranges) if (cells.length !== length) return VALUE;
  const values = valuesArg === null ? null : flat(evaluate(args[valuesArg]!, ctx), ctx);
  if (values && values.length !== length) return VALUE;
  return eachCriterion(args, indices, ctx, (conditions) => {
    // An error as the criterion selects the cells holding that error.
    const tests = conditions.map((condition) => criterion(condition));
    const matched: number[] = [];
    for (let index = 0; index < length; index++) {
      if (!tests.every((test, t) => test(ranges[t]![index]!))) continue;
      if (!values) {
        matched.push(1);
        continue;
      }
      const value = values[index];
      if (value instanceof XlError) throw value;
      if (typeof value === "number") matched.push(value);
    }
    return reduce(matched);
  });
}

/**
 * GCD and LCM's numbers, truncated. Unlike most functions they reject text and TRUE/FALSE even in
 * cells, and a reference to a single empty cell; then a negative number, even one that truncates
 * to 0, is #NUM!.
 */
function wholeNumbers(args: Node[], ctx: Context): number[] | XlError {
  const out: number[] = [];
  for (const arg of args) {
    if (arg.k === "missing") continue;
    const value = evaluate(arg, ctx);
    let items: Scalar[];
    if (value instanceof Ref) {
      const area = value.single;
      if (area && area.r1 === area.r2 && area.c1 === area.c2)
        items = [ctx.engine.cellValue(area.sheet, area.r1, area.c1) ?? VALUE];
      else items = flat(value, ctx).filter((item) => item !== null);
    } else if (value instanceof Matrix) items = value.data;
    else if (typeof value === "string") {
      try {
        items = [num(value)];
      } catch (error) {
        if (error instanceof XlError) return error;
        throw error;
      }
    } else items = [value];
    for (const item of items) {
      if (item instanceof XlError) return item;
      if (typeof item !== "number") return VALUE;
      out.push(item);
    }
  }
  return out.some((x) => x < 0) ? NUM : out.map(Math.trunc);
}

function callsSubtotal(node: Node): boolean {
  switch (node.k) {
    case "fn":
      return node.name === "SUBTOTAL" || node.name === "AGGREGATE" || node.args.some(callsSubtotal);
    case "bin":
      return callsSubtotal(node.a) || callsSubtotal(node.b);
    case "un":
    case "inarray":
      return callsSubtotal(node.a);
    case "array":
      return node.rows.some((row) => row.some(callsSubtotal));
    default:
      return false;
  }
}

/**
 * An argument of SUBTOTAL or AGGREGATE with the values they leave out removed: cells in hidden rows,
 * cells holding SUBTOTAL or AGGREGATE themselves, and errors, row by row as Excel reads them.
 */
function kept(
  arg: Node,
  ctx: Context,
  skip: { hidden: boolean; nested: boolean; errors: boolean },
): Node {
  if (!skip.hidden && !skip.nested && !skip.errors) return arg;
  const value = evaluate(arg, { ...ctx, array: true });
  const values: Scalar[] = [];
  if (value instanceof Ref) {
    const { engine } = ctx;
    for (const area of value.areas) {
      const hidden = new Set(
        skip.hidden ? (engine.model.sheets[area.sheet]?.hiddenRows ?? []) : [],
      );
      const cells = [...(engine.sheets[area.sheet]?.occupied(area) ?? [])].sort(
        (a, b) => a[0] - b[0] || a[1] - b[1],
      );
      for (const [r, c] of cells) {
        if (hidden.has(r)) continue;
        const formula = skip.nested ? engine.formulaIn(area.sheet, r, c) : undefined;
        if (formula && callsSubtotal(formula)) continue;
        const item = engine.cellValue(area.sheet, r, c);
        if (skip.errors && item instanceof XlError) continue;
        values.push(item);
      }
    }
  } else if (skip.errors) {
    for (const item of flat(value, ctx)) if (!(item instanceof XlError)) values.push(item);
  } else return { k: "value", v: value };
  if (!values.length) return { k: "array", rows: [[{ k: "missing" }]] };
  return { k: "value", v: new Matrix(1, values.length, values) };
}

/** The first entry, row by row, that is not a number: its own error, or #VALUE! for text and blanks. */
function firstNonNumber(m: Matrix): XlError | null {
  for (const x of m.data) if (typeof x !== "number") return x instanceof XlError ? x : VALUE;
  return null;
}

function determinant(a: number[], n: number): number {
  const m = a.slice();
  let det = 1;
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(m[r * n + c]!) > Math.abs(m[pivot * n + c]!)) pivot = r;
    if (m[pivot * n + c] === 0) return 0;
    if (pivot !== c) {
      for (let k = 0; k < n; k++)
        [m[c * n + k], m[pivot * n + k]] = [m[pivot * n + k]!, m[c * n + k]!];
      det = -det;
    }
    det *= m[c * n + c]!;
    for (let r = c + 1; r < n; r++) {
      const factor = m[r * n + c]! / m[c * n + c]!;
      for (let k = c; k < n; k++) m[r * n + k]! -= factor * m[c * n + k]!;
    }
  }
  return det;
}

/** LU factors with partial pivoting, then a forward and back substitution for each unit column. */
function invert(a: number[], n: number): number[] | null {
  const m = a.slice();
  const row = Array.from({ length: n }, (_, i) => i);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(m[r * n + c]!) > Math.abs(m[pivot * n + c]!)) pivot = r;
    if (Math.abs(m[pivot * n + c]!) < 1e-300) return null;
    if (pivot !== c) {
      for (let k = 0; k < n; k++)
        [m[c * n + k], m[pivot * n + k]] = [m[pivot * n + k]!, m[c * n + k]!];
      [row[c], row[pivot]] = [row[pivot]!, row[c]!];
    }
    for (let r = c + 1; r < n; r++) {
      m[r * n + c]! /= m[c * n + c]!;
      for (let k = c + 1; k < n; k++) m[r * n + k]! -= m[r * n + c]! * m[c * n + k]!;
    }
  }
  const inv = new Array<number>(n * n);
  const b = new Array<number>(n);
  for (let col = 0; col < n; col++) {
    for (let i = 0; i < n; i++) {
      let total = row[i] === col ? 1 : 0;
      for (let j = 0; j < i; j++) total -= m[i * n + j]! * b[j]!;
      b[i] = total;
    }
    for (let i = n - 1; i >= 0; i--) {
      let total = b[i]!;
      for (let j = i + 1; j < n; j++) total -= m[i * n + j]! * b[j]!;
      b[i] = total / m[i * n + i]!;
    }
    for (let i = 0; i < n; i++) inv[i * n + col] = b[i]!;
  }
  return inv;
}

/** Filled in by the library index, so SUBTOTAL and AGGREGATE can reach the functions they wrap. */
export const FUNCTION_LOOKUP = new Map<string, Fn>();

void isError;
void numbersEqual;
void scalar;
