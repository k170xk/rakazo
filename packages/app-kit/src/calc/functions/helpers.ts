import type { Context } from "../engine.js";
import type { Node } from "../parse.js";
import type { Scalar, Value } from "../values.js";
import {
  compare,
  isError,
  Matrix,
  NA,
  parseNumber,
  Ref,
  toBoolean,
  toNumber,
  toText,
  VALUE,
  XlError,
} from "../values.js";

/** A worksheet function: its argument trees, evaluated as the function needs them. */
export type Fn = (args: Node[], ctx: Context) => Value;

export const evaluate = (node: Node, ctx: Context): Value => ctx.engine.evaluate(node, ctx);

/** Throws Excel errors so a function can bail out the moment one appears. */
export function check<T>(value: T | XlError): T {
  if (value instanceof XlError) throw value;
  return value;
}

export const num = (value: Scalar): number => check(toNumber(value));
export const text = (value: Scalar): string => check(toText(value));
export const bool = (value: Scalar): boolean => check(toBoolean(value));

export function int(value: Scalar): number {
  return Math.trunc(num(value));
}

/** Functions applied cell by cell, which index their arguments across a whole array formula range. */
export const ELEMENTWISE = new WeakSet<Fn>();

export function elementwise(fn: Fn): Fn {
  ELEMENTWISE.add(fn);
  return fn;
}

/** A function of single values, applied to each element when given arrays in an array formula. */
export function scalar(impl: (items: Scalar[], ctx: Context) => Scalar): Fn {
  return elementwise((args, ctx) => {
    const values = args.map((arg) => (arg.k === "missing" ? null : evaluate(arg, ctx)));
    return ctx.engine.liftN(values, ctx, (items) => {
      try {
        return impl(items, ctx);
      } catch (error) {
        if (error instanceof XlError) return error;
        throw error;
      }
    });
  });
}

/** A function of numbers only: errors in any argument come first, then text that is not a number. */
export function numeric(
  impl: (...values: number[]) => Scalar,
  optional: number[] = [],
  logical: number[] = [],
): Fn {
  return scalar((items) => {
    for (const item of items) if (isError(item)) return item;
    // Logical parameters (cumulative, method) also take the text "TRUE" or "FALSE".
    const numbers = items.map((item, index) =>
      item === undefined
        ? (optional[index] ?? 0)
        : logical.includes(index) && typeof item === "string"
          ? bool(item)
            ? 1
            : 0
          : num(item),
    );
    for (let i = items.length; i < optional.length; i++) numbers.push(optional[i]!);
    return impl(...numbers);
  });
}

/** One argument as a single value (intersecting a range), or undefined when it was left out. */
export function single(args: Node[], index: number, ctx: Context): Scalar | undefined {
  const arg = args[index];
  if (!arg) return undefined;
  if (arg.k === "missing") return null;
  const value = evaluate(arg, ctx);
  if (value instanceof Matrix) return value.rows && value.cols ? value.get(0, 0) : VALUE;
  return ctx.engine.toScalar(value, { ...ctx, array: false });
}

export function argMatrix(args: Node[], index: number, ctx: Context): Matrix {
  const arg = args[index];
  if (!arg || arg.k === "missing") return Matrix.fill(1, 1, null);
  return ctx.engine.toMatrix(evaluate(arg, ctx), ctx);
}

export type Collected = { numbers: number[]; count: number };

/**
 * The values of a list of arguments the way SUM, AVERAGE, MIN and friends see them: numbers in
 * ranges and arrays, typed values coerced (TRUE as 1, "3" as 3, other text #VALUE!), blanks and
 * text in ranges skipped, the first error stopping everything. `mode: "a"` is the -A variants,
 * which count text in ranges as 0 and logicals as 1/0.
 */
export function collect(args: Node[], ctx: Context, mode: "plain" | "a" = "plain"): number[] {
  const out: number[] = [];
  // An error given directly as an argument wins over one found in a referenced cell, whatever their order.
  let inCell: XlError | null = null;
  for (const arg of args) {
    if (arg.k === "missing") {
      continue;
    }
    const value = evaluate(arg, ctx);
    try {
      collectValue(value, ctx, mode, out);
    } catch (error) {
      if (!(error instanceof XlError) || !(value instanceof Ref)) throw error;
      inCell ??= error;
    }
  }
  if (inCell) throw inCell;
  return out;
}

export function collectValue(value: Value, ctx: Context, mode: "plain" | "a", out: number[]) {
  if (value instanceof Ref) {
    for (const item of ctx.engine.cellsIn(value)) {
      if (typeof item === "number") out.push(item);
      else if (item instanceof XlError) throw item;
      else if (mode === "a" && typeof item === "boolean") out.push(item ? 1 : 0);
      else if (mode === "a" && typeof item === "string") out.push(0);
    }
    return;
  }
  if (value instanceof Matrix) {
    for (const item of value.data) {
      if (typeof item === "number") out.push(item);
      else if (item instanceof XlError) throw item;
      else if (mode === "a" && typeof item === "boolean") out.push(item ? 1 : 0);
      else if (mode === "a" && typeof item === "string") out.push(0);
    }
    return;
  }
  if (value === null) return;
  if (value instanceof XlError) throw value;
  if (typeof value === "number") out.push(value);
  else if (typeof value === "boolean") out.push(value ? 1 : 0);
  else {
    const parsed = parseNumber(value);
    if (parsed === null) throw VALUE;
    out.push(parsed);
  }
}

/** Every value in a range or array, blanks included, for functions that look at each cell. */
export function flat(value: Value, ctx: Context): Scalar[] {
  if (value instanceof Ref) {
    const out: Scalar[] = [];
    for (const area of value.areas) {
      const matrix = ctx.engine.toMatrix(new Ref([area]), ctx);
      out.push(...matrix.data);
    }
    return out;
  }
  if (value instanceof Matrix) return value.data;
  return [value];
}

// ---------------------------------------------------------------------------------------------
// Criteria (COUNTIF, SUMIF, …)

export function wildcard(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "~" && i + 1 < pattern.length && "*?~".includes(pattern[i + 1]!)) {
      source += escapeRegex(pattern[++i]!);
    } else if (ch === "*") source += "[\\s\\S]*";
    else if (ch === "?") source += "[\\s\\S]";
    else source += escapeRegex(ch);
  }
  return new RegExp(`^${source}$`, "i");
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const hasWildcard = (text: string) => /(^|[^~])[*?]/.test(text);

/** A criteria argument as a test of one cell value, matching Excel's rules for each type. */
export function criterion(value: Scalar): (cell: Scalar) => boolean {
  if (value instanceof XlError) return (cell) => cell === value;
  if (typeof value === "number") {
    return (cell) =>
      typeof cell === "string" ? parseNumber(cell) === value : matchNumber(cell, "=", value);
  }
  if (typeof value === "boolean") return (cell) => cell === value;
  if (value === null) return (cell) => (cell === 0 || cell === null ? cell === 0 : false);
  const match = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(value)!;
  const op = match[1] ?? "=";
  const rest = match[2]!;
  if (rest === "") {
    if (op === "=") return (cell) => cell === null || cell === "";
    if (op === "<>") return (cell) => cell !== null && cell !== "";
    return () => false;
  }
  const upper = rest.toUpperCase();
  if (upper === "TRUE" || upper === "FALSE") {
    const target = upper === "TRUE";
    return (cell) =>
      typeof cell === "boolean" ? compareOp(compare(cell, target), op) : op === "<>";
  }
  const error = /^#/.test(rest) ? rest.toUpperCase() : null;
  if (error)
    return (cell) =>
      cell instanceof XlError ? compareOp(cell.code === error ? 0 : 1, op) : op === "<>";
  const parsed = parseNumber(rest);
  if (parsed !== null) {
    return (cell) => {
      if (typeof cell === "number") return matchNumber(cell, op, parsed);
      if (typeof cell === "string" && (op === "=" || op === "<>")) {
        const cellNumber = parseNumber(cell);
        const equal = cellNumber !== null && cellNumber === parsed;
        return op === "=" ? equal : !equal;
      }
      return op === "<>";
    };
  }
  if ((op === "=" || op === "<>") && hasWildcard(rest)) {
    const pattern = wildcard(rest);
    return (cell) => {
      const ok = typeof cell === "string" && pattern.test(cell);
      return op === "=" ? ok : !ok;
    };
  }
  const unescaped = rest.replace(/~([*?~])/g, "$1");
  return (cell) => {
    if (typeof cell !== "string") return op === "<>";
    return compareOp(compare(cell, unescaped), op);
  };
}

function matchNumber(cell: Scalar, op: string, target: number): boolean {
  if (typeof cell !== "number") return op === "<>";
  return compareOp(compare(cell, target), op);
}

function compareOp(order: number, op: string): boolean {
  switch (op) {
    case "=":
      return order === 0;
    case "<>":
      return order !== 0;
    case "<":
      return order < 0;
    case ">":
      return order > 0;
    case "<=":
      return order <= 0;
    case ">=":
      return order >= 0;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Decimal-correct rounding

/**
 * x rounded to `digits` decimals the way Excel does: on the 15-significant-digit decimal value it
 * displays, half away from zero, so ROUND(2.675, 2) is 2.68 even though 2.675 is stored a hair low.
 */
export function roundDecimal(x: number, digits: number, mode: "half" | "up" | "down"): number {
  if (!Number.isFinite(x) || x === 0) return x;
  digits = Math.trunc(digits);
  const sign = x < 0 ? -1 : 1;
  const [mantissa, exp] = Math.abs(x).toExponential(14).split("e") as [string, string];
  const allDigits = mantissa.replace(".", "");
  const exponent = Number(exp);
  // Position of the last kept digit, counted from the first significant digit.
  const keep = exponent + 1 + digits;
  if (keep <= 0) {
    if (mode === "down") return 0;
    if (mode === "up") return sign * 10 ** -digits;
    if (keep === 0 && Number(allDigits[0]) >= 5) return sign * 10 ** -digits;
    return 0;
  }
  if (keep >= allDigits.length)
    return sign * Number(`${allDigits}e${exponent - allDigits.length + 1}`);
  const kept = allDigits.slice(0, keep);
  const rest = allDigits.slice(keep);
  let roundUp = false;
  if (mode === "half") roundUp = Number(rest[0]) >= 5;
  else if (mode === "up") roundUp = /[1-9]/.test(rest);
  let value = BigInt(kept);
  if (roundUp) value += 1n;
  return sign * Number(`${value.toString()}e${exponent - keep + 1}`);
}

export function errorOf(items: Scalar[]): XlError | null {
  for (const item of items) if (item instanceof XlError) return item;
  return null;
}

export { NA };
