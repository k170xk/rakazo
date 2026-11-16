import type { Context } from "../engine.js";
import { columnName } from "../model.js";
import type { Node } from "../parse.js";
import { MAX_COL, MAX_ROW, parseFormula } from "../parse.js";
import type { Scalar, Value } from "../values.js";
import { CALC, compareExact as compare, Matrix, NA, REF, Ref, VALUE, XlError } from "../values.js";
import type { Fn } from "./helpers.js";
import { bool, check, evaluate, hasWildcard, num, single, text, wildcard } from "./helpers.js";

const sameKind = (a: Scalar, b: Scalar) =>
  (typeof a === "number" && typeof b === "number") ||
  (typeof a === "string" && typeof b === "string") ||
  (typeof a === "boolean" && typeof b === "boolean");

/** Exact position of `value` in `items`, with wildcards for text when allowed. */
function exactIndex(items: Scalar[], value: Scalar, wildcards: boolean, fromEnd = false): number {
  const pattern =
    wildcards && typeof value === "string" && hasWildcard(value) ? wildcard(value) : null;
  const order = fromEnd ? [...items.keys()].reverse() : items.keys();
  for (const i of order) {
    const item = items[i]!;
    if (pattern) {
      if (typeof item === "string" && pattern.test(item)) return i;
      continue;
    }
    if (!sameKind(item, value)) continue;
    if (wildcards ? compare(item, value) === 0 : compare(fold(item), fold(value)) === 0) return i;
  }
  return -1;
}

/** XMATCH and XLOOKUP's plain exact match reads ß as ss; MATCH and wildcard matching do not. */
const fold = (v: Scalar): Scalar =>
  typeof v === "string" && v.includes("ß") ? v.replace(/ß/g, "ss") : v;

/** MATCH type -1 walks forward while values are not below `value` and stops at the first that is. */
function descendingIndex(items: Scalar[], value: Scalar): number {
  let found = -1;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (!sameKind(item, value)) continue;
    if (compare(item, value) < 0) break;
    found = i;
  }
  return found;
}

/**
 * Approximate match the way Excel finds it: a binary search over a list assumed sorted, stepping
 * over cells of another type (blanks, labels), returning the last position not past `value`.
 * `descending` is MATCH type -1: the last position not below it.
 */
function approximateIndex(items: Scalar[], value: Scalar, descending = false): number {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    let mid = (lo + hi) >> 1;
    // Find a comparable item near mid.
    let probe = mid;
    while (probe <= hi && !sameKind(items[probe]!, value)) probe++;
    if (probe > hi) {
      probe = mid - 1;
      while (probe >= lo && !sameKind(items[probe]!, value)) probe--;
      if (probe < lo) break;
    }
    mid = probe;
    const order = compare(items[mid]!, value);
    if (order === 0) {
      // Excel stops at the first equal value its search lands on, then moves forward over equal
      // neighbours; on unsorted lists that decides which row is returned.
      let last = mid;
      while (
        last + 1 < items.length &&
        sameKind(items[last + 1]!, value) &&
        compare(items[last + 1]!, value) === 0
      )
        last++;
      return last;
    }
    if (descending ? order > 0 : order < 0) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** A one-row or one-column range or array as a list, or null when it is two-dimensional. */
function vector(value: Value, ctx: Context): Scalar[] | null {
  const matrix = ctx.engine.toMatrix(value, ctx);
  if (matrix.rows !== 1 && matrix.cols !== 1) return null;
  return matrix.data;
}

/** The value to look up; the older lookups read an empty one as 0, XMATCH and XLOOKUP keep it blank. */
function lookupValue(args: Node[], ctx: Context, blank: Scalar = 0): Scalar {
  const value = single(args, 0, ctx) ?? null;
  if (value instanceof XlError) throw value;
  return value === null ? blank : value;
}

function tableLookup(args: Node[], ctx: Context, horizontal: boolean): Value {
  const value = lookupValue(args, ctx);
  const table = ctx.engine.toMatrix(evaluate(args[1]!, ctx), ctx);
  const index = Math.trunc(num(check(single(args, 2, ctx) ?? null)));
  const approximate = args.length < 4 ? true : bool(check(single(args, 3, ctx) ?? false));
  if (index < 1) return VALUE;
  if (index > (horizontal ? table.rows : table.cols)) return REF;
  const keys: Scalar[] = [];
  const count = horizontal ? table.cols : table.rows;
  for (let i = 0; i < count; i++) keys.push(horizontal ? table.get(0, i) : table.get(i, 0));
  const at = approximate ? approximateIndex(keys, value) : exactIndex(keys, value, true);
  if (at < 0) return NA;
  const result = horizontal ? table.get(index - 1, at) : table.get(at, index - 1);
  return result === null ? 0 : result;
}

function rowsAndCols(value: Value, ctx: Context): { rows: number; cols: number } {
  if (value instanceof XlError) throw value;
  if (value instanceof Ref) {
    if (value.areas.length > 1) throw REF;
    const area = value.areas[0]!;
    return { rows: area.r2 - area.r1 + 1, cols: area.c2 - area.c1 + 1 };
  }
  if (value instanceof Matrix) return { rows: value.rows, cols: value.cols };
  void ctx;
  return { rows: 1, cols: 1 };
}

/** The text of a reference (A1 or R1C1) as the cells it names, for INDIRECT. */
function indirect(refText: string, a1: boolean, ctx: Context): Value {
  let source = refText.trim();
  if (!a1) source = r1c1ToA1(source, ctx.row, ctx.col) ?? "";
  if (!source) return REF;
  try {
    const node = parseFormula(source, {
      row: ctx.row,
      col: ctx.col,
      sheetIndex: (n) => ctx.engine.sheetIndex(n),
    });
    if (node.k !== "ref" && node.k !== "name" && !(node.k === "bin" && node.op === ":")) return REF;
    const value = evaluate(node, ctx);
    return value instanceof Ref ? value : REF;
  } catch {
    return REF;
  }
}

function r1c1ToA1(source: string, row: number, col: number): string | null {
  const bang = source.lastIndexOf("!");
  const prefix = bang >= 0 ? source.slice(0, bang + 1) : "";
  const body = bang >= 0 ? source.slice(bang + 1) : source;
  const part = (text: string): string | null => {
    const match = /^R(\[-?\d+\]|\d+)?C(\[-?\d+\]|\d+)?$/i.exec(text);
    if (!match) return null;
    const pick = (spec: string | undefined, here: number) =>
      spec === undefined
        ? here
        : spec.startsWith("[")
          ? here + Number(spec.slice(1, -1))
          : Number(spec) - 1;
    const r = pick(match[1], row);
    const c = pick(match[2], col);
    if (r < 0 || c < 0 || r > MAX_ROW || c > MAX_COL) return null;
    return `$${columnName(c)}$${r + 1}`;
  };
  const pieces = body.split(":").map(part);
  if (pieces.some((p) => p === null)) return null;
  return prefix + pieces.join(":");
}

export const LOOKUP: Record<string, Fn> = {
  VLOOKUP: (args, ctx) => tableLookup(args, ctx, false),
  HLOOKUP: (args, ctx) => tableLookup(args, ctx, true),
  LOOKUP: (args, ctx) => {
    const value = lookupValue(args, ctx);
    const lookIn = ctx.engine.toMatrix(evaluate(args[1]!, ctx), ctx);
    let keys: Scalar[];
    let results: Scalar[];
    if (args[2]) {
      keys = lookIn.data;
      const out = vector(evaluate(args[2], ctx), ctx);
      if (!out) return NA;
      results = out;
    } else if (lookIn.cols > lookIn.rows) {
      keys = [...Array(lookIn.cols).keys()].map((c) => lookIn.get(0, c));
      results = [...Array(lookIn.cols).keys()].map((c) => lookIn.get(lookIn.rows - 1, c));
    } else {
      keys = [...Array(lookIn.rows).keys()].map((r) => lookIn.get(r, 0));
      results = [...Array(lookIn.rows).keys()].map((r) => lookIn.get(r, lookIn.cols - 1));
    }
    const at = approximateIndex(keys, value);
    if (at < 0) return NA;
    const result = results[at];
    return result === undefined ? NA : result === null ? 0 : result;
  },
  MATCH: (args, ctx) => {
    const value = lookupValue(args, ctx);
    const items = vector(evaluate(args[1]!, ctx), ctx);
    if (!items) return NA;
    const type = args.length < 3 ? 1 : Math.sign(num(check(single(args, 2, ctx) ?? 0)));
    const at =
      type === 0
        ? exactIndex(items, value, true)
        : type < 0
          ? descendingIndex(items, value)
          : approximateIndex(items, value);
    return at < 0 ? NA : at + 1;
  },
  XMATCH: (args, ctx) => {
    const value = lookupValue(args, ctx, null);
    const items = vector(evaluate(args[1]!, ctx), ctx);
    if (!items) return VALUE;
    const mode = args[2] ? Math.trunc(num(check(single(args, 2, ctx) ?? 0))) : 0;
    const search = args[3] ? Math.trunc(num(check(single(args, 3, ctx) ?? 1))) : 1;
    const at = xIndex(items, value, mode, search);
    return at === -2 ? VALUE : at < 0 ? NA : at + 1;
  },
  XLOOKUP: (args, ctx) => {
    const value = lookupValue(args, ctx, null);
    const lookIn = ctx.engine.toMatrix(evaluate(args[1]!, ctx), ctx);
    const returnValue = evaluate(args[2]!, ctx);
    const results = ctx.engine.toMatrix(returnValue, ctx);
    const mode = args[4] ? Math.trunc(num(check(single(args, 4, ctx) ?? 0))) : 0;
    const search = args[5] ? Math.trunc(num(check(single(args, 5, ctx) ?? 1))) : 1;
    const vertical = lookIn.cols === 1;
    if (!vertical && lookIn.rows !== 1) return VALUE;
    const at = xIndex(lookIn.data, value, mode, search);
    if (at === -2) return VALUE;
    if (at < 0) {
      if (args[3] && args[3].k !== "missing") return evaluate(args[3], ctx);
      return NA;
    }
    if (returnValue instanceof Ref && returnValue.single) {
      const area = returnValue.single;
      return new Ref([
        vertical
          ? { sheet: area.sheet, r1: area.r1 + at, r2: area.r1 + at, c1: area.c1, c2: area.c2 }
          : { sheet: area.sheet, r1: area.r1, r2: area.r2, c1: area.c1 + at, c2: area.c1 + at },
      ]);
    }
    if (vertical) {
      const row: Scalar[] = [];
      for (let c = 0; c < results.cols; c++) row.push(results.get(at, c));
      return row.length === 1 ? row[0]! : new Matrix(1, row.length, row);
    }
    const col: Scalar[] = [];
    for (let r = 0; r < results.rows; r++) col.push(results.get(r, at));
    return col.length === 1 ? col[0]! : new Matrix(col.length, 1, col);
  },
  INDEX: (args, ctx) => {
    const source = evaluate(args[0]!, ctx);
    if (source instanceof XlError) return source;
    let rowArg =
      args[1] && args[1].k !== "missing" ? Math.trunc(num(check(single(args, 1, ctx) ?? 0))) : 0;
    let colArg =
      args[2] && args[2].k !== "missing" ? Math.trunc(num(check(single(args, 2, ctx) ?? 0))) : 0;
    const areaArg = args[3] ? Math.trunc(num(check(single(args, 3, ctx) ?? 1))) : 1;
    if (rowArg < 0 || colArg < 0) return VALUE;
    if (source instanceof Ref) {
      const area = source.areas[areaArg - 1];
      if (!area) return REF;
      const rows = area.r2 - area.r1 + 1;
      const cols = area.c2 - area.c1 + 1;
      if (args.length === 2 && rows > 1 && cols > 1) return REF;
      if (args.length === 2 && (rows === 1 || cols === 1)) {
        // A single index runs along a one-row or one-column range.
        if (rows === 1) {
          colArg = rowArg;
          rowArg = 0;
          if (colArg === 0 && rows === 1) colArg = 0;
        }
      }
      if (rows === 1 && args.length === 2 && rowArg === 0 && colArg === 0) return new Ref([area]);
      if (rowArg > rows || colArg > cols) return REF;
      return new Ref([
        {
          sheet: area.sheet,
          r1: rowArg ? area.r1 + rowArg - 1 : area.r1,
          r2: rowArg ? area.r1 + rowArg - 1 : area.r2,
          c1: colArg ? area.c1 + colArg - 1 : area.c1,
          c2: colArg ? area.c1 + colArg - 1 : area.c2,
        },
      ]);
    }
    const matrix = ctx.engine.toMatrix(source, ctx);
    if (args.length === 2 && (matrix.rows === 1 || matrix.cols === 1)) {
      if (matrix.rows === 1) {
        colArg = rowArg;
        rowArg = 1;
      } else colArg = 1;
    }
    if (rowArg > matrix.rows || colArg > matrix.cols) return REF;
    if (rowArg === 0 && colArg === 0) return matrix;
    if (rowArg === 0)
      return Matrix.of([...Array(matrix.rows).keys()].map((r) => [matrix.get(r, colArg - 1)]));
    if (colArg === 0)
      return Matrix.of([[...Array(matrix.cols).keys()].map((c) => matrix.get(rowArg - 1, c))]);
    const result = matrix.get(rowArg - 1, colArg - 1);
    return result === null ? 0 : result;
  },
  OFFSET: (args, ctx) => {
    const source = evaluate(args[0]!, ctx);
    if (source instanceof XlError) return source;
    if (!(source instanceof Ref) || !source.single) return VALUE;
    const area = source.single;
    const rows = Math.trunc(num(check(single(args, 1, ctx) ?? 0)));
    const cols = Math.trunc(num(check(single(args, 2, ctx) ?? 0)));
    const heightArg = args[3] && args[3].k !== "missing" ? single(args, 3, ctx) : undefined;
    const widthArg = args[4] && args[4].k !== "missing" ? single(args, 4, ctx) : undefined;
    const height =
      heightArg === undefined ? area.r2 - area.r1 + 1 : Math.trunc(num(check(heightArg)));
    const width = widthArg === undefined ? area.c2 - area.c1 + 1 : Math.trunc(num(check(widthArg)));
    if (height === 0 || width === 0) return REF;
    let r1 = area.r1 + rows;
    let c1 = area.c1 + cols;
    let r2 = r1 + height - (height > 0 ? 1 : -1);
    let c2 = c1 + width - (width > 0 ? 1 : -1);
    [r1, r2] = [Math.min(r1, r2), Math.max(r1, r2)];
    [c1, c2] = [Math.min(c1, c2), Math.max(c1, c2)];
    if (r1 < 0 || c1 < 0 || r2 > MAX_ROW || c2 > MAX_COL) return REF;
    return new Ref([{ sheet: area.sheet, r1, c1, r2, c2 }]);
  },
  INDIRECT: (args, ctx) => {
    const refText = text(check(single(args, 0, ctx) ?? ""));
    const a1 = args.length < 2 ? true : bool(check(single(args, 1, ctx) ?? true));
    return indirect(refText, a1, ctx);
  },
  ROW: (args, ctx) => position(args, ctx, "row"),
  COLUMN: (args, ctx) => position(args, ctx, "col"),
  ROWS: (args, ctx) => rowsAndCols(evaluate(args[0]!, ctx), ctx).rows,
  COLUMNS: (args, ctx) => rowsAndCols(evaluate(args[0]!, ctx), ctx).cols,
  AREAS: (args, ctx) => {
    const value = evaluate(args[0]!, ctx);
    return value instanceof Ref ? value.areas.length : VALUE;
  },
  ADDRESS: (args, ctx) => {
    const row = Math.trunc(num(check(single(args, 0, ctx) ?? null)));
    const col = Math.trunc(num(check(single(args, 1, ctx) ?? null)));
    const absolute =
      args[2] && args[2].k !== "missing" ? Math.trunc(num(check(single(args, 2, ctx) ?? 1))) : 1;
    const a1 =
      args[3] && args[3].k !== "missing" ? bool(check(single(args, 3, ctx) ?? false)) : true;
    const named = !!args[4] && args[4].k !== "missing";
    const sheet = named ? text(check(single(args, 4, ctx) ?? "")) : "";
    if (row < 1 || col < 1 || row > MAX_ROW + 1 || col > MAX_COL + 1) return VALUE;
    const absRow = absolute === 1 || absolute === 2;
    const absCol = absolute === 1 || absolute === 3;
    const cell = a1
      ? `${absCol ? "$" : ""}${columnName(col - 1)}${absRow ? "$" : ""}${row}`
      : `R${absRow ? row : `[${row}]`}C${absCol ? col : `[${col}]`}`;
    if (!named) return cell;
    if (!sheet) return `!${cell}`;
    const quoted = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheet)
      ? sheet
      : `'${sheet.replace(/'/g, "''")}'`;
    return `${quoted}!${cell}`;
  },
  TRANSPOSE: (args, ctx) => {
    const matrix = ctx.engine.toMatrix(evaluate(args[0]!, ctx), ctx);
    const data: Scalar[] = [];
    for (let c = 0; c < matrix.cols; c++)
      for (let r = 0; r < matrix.rows; r++) data.push(matrix.get(r, c) ?? 0);
    return new Matrix(matrix.cols, matrix.rows, data);
  },
  SINGLE: (args, ctx) => ctx.engine.toScalar(evaluate(args[0]!, ctx), { ...ctx, array: false }),
  ANCHORARRAY: (args, ctx) => {
    const value = evaluate(args[0]!, ctx);
    if (!(value instanceof Ref) || !value.single) return REF;
    return ctx.engine.spillRef(value.single.sheet, value.single.r1, value.single.c1);
  },
  SEQUENCE: (args, ctx) => {
    const rows = Math.trunc(num(check(single(args, 0, ctx) ?? 1)));
    const cols =
      args[1] && args[1].k !== "missing" ? Math.trunc(num(check(single(args, 1, ctx) ?? 1))) : 1;
    const start = args[2] && args[2].k !== "missing" ? num(check(single(args, 2, ctx) ?? 1)) : 1;
    const step = args[3] && args[3].k !== "missing" ? num(check(single(args, 3, ctx) ?? 1)) : 1;
    if (rows < 1 || cols < 1) return CALC;
    const data: Scalar[] = [];
    for (let i = 0; i < rows * cols; i++) data.push(start + i * step);
    return new Matrix(rows, cols, data);
  },
  FILTER: (args, ctx) => {
    const array = ctx.engine.toMatrix(evaluate(args[0]!, ctx), ctx);
    const include = ctx.engine.toMatrix(evaluate(args[1]!, { ...ctx, array: true }), {
      ...ctx,
      array: true,
    });
    const byRow = include.cols === 1 && include.rows === array.rows;
    const byCol = include.rows === 1 && include.cols === array.cols;
    if (!byRow && !byCol) return VALUE;
    const keep = (i: number) => {
      const flag = include.data[i];
      if (flag instanceof XlError) throw flag;
      if (typeof flag === "string") throw VALUE;
      return flag !== null && flag !== false && flag !== 0;
    };
    const rows: Scalar[][] = [];
    if (byRow) {
      for (let r = 0; r < array.rows; r++)
        if (keep(r)) rows.push([...Array(array.cols).keys()].map((c) => array.get(r, c)));
    } else {
      const cols = [...Array(array.cols).keys()].filter(keep);
      for (let r = 0; r < array.rows; r++) rows.push(cols.map((c) => array.get(r, c)));
    }
    if (!rows.length || !rows[0]!.length) {
      if (args[2]) return evaluate(args[2], ctx);
      return CALC;
    }
    return Matrix.of(rows);
  },
  SORT: (args, ctx) => {
    const array = ctx.engine.toMatrix(evaluate(args[0]!, ctx), ctx);
    const list = (index: number, fallback: number) =>
      args[index] && args[index].k !== "missing"
        ? ctx.engine
            .toMatrix(evaluate(args[index], ctx), ctx)
            .data.map((v) => Math.trunc(num(check(v))))
        : [fallback];
    const indexes = list(1, 1);
    const orders = list(2, 1);
    const byCol = args[3] ? bool(check(single(args, 3, ctx) ?? false)) : false;
    const rows = [...Array(byCol ? array.cols : array.rows).keys()].map((i) =>
      [...Array(byCol ? array.rows : array.cols).keys()].map((j) =>
        byCol ? array.get(j, i) : array.get(i, j),
      ),
    );
    const width = rows[0]?.length ?? 0;
    if (indexes.some((index) => index < 1 || index > width)) return VALUE;
    if (orders.some((order) => order !== 1 && order !== -1)) return VALUE;
    if (orders.length > 1 && orders.length !== indexes.length) return VALUE;
    // Blanks sort last whichever the direction.
    const byKey = (a: Scalar, b: Scalar, order: number) =>
      a === null || b === null
        ? (a === null ? 1 : 0) - (b === null ? 1 : 0)
        : compare(a, b) * order;
    const sorted = rows
      .map((row, i) => ({ row, i }))
      .sort((a, b) => {
        for (const [n, index] of indexes.entries()) {
          const order = orders[orders.length > 1 ? n : 0]!;
          const c = byKey(a.row[index - 1]!, b.row[index - 1]!, order);
          if (c) return c;
        }
        return a.i - b.i;
      })
      .map((item) => item.row);
    if (!byCol) return Matrix.of(sorted);
    return Matrix.of([...Array(array.rows).keys()].map((r) => sorted.map((col) => col[r]!)));
  },
  UNIQUE: (args, ctx) => {
    const source = ctx.engine.toMatrix(evaluate(args[0]!, ctx), ctx);
    const byCol = args[1] ? bool(check(single(args, 1, ctx) ?? false)) : false;
    const exactlyOnce = args[2] ? bool(check(single(args, 2, ctx) ?? false)) : false;
    const array = byCol ? transposed(source) : source;
    const rows = [...Array(array.rows).keys()].map((r) =>
      [...Array(array.cols).keys()].map((c) => array.get(r, c)),
    );
    const keyOf = (row: Scalar[]) =>
      JSON.stringify(
        row.map((v) =>
          typeof v === "string" ? v.toLowerCase() : v instanceof XlError ? v.code : v,
        ),
      );
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(keyOf(row), (counts.get(keyOf(row)) ?? 0) + 1);
    const seen = new Set<string>();
    const out: Scalar[][] = [];
    for (const row of rows) {
      const k = keyOf(row);
      if (seen.has(k)) continue;
      seen.add(k);
      if (exactlyOnce && counts.get(k) !== 1) continue;
      out.push(row);
    }
    if (!out.length) return CALC;
    return byCol ? transposed(Matrix.of(out)) : Matrix.of(out);
  },
};

function transposed(matrix: Matrix): Matrix {
  const data: Scalar[] = [];
  for (let c = 0; c < matrix.cols; c++)
    for (let r = 0; r < matrix.rows; r++) data.push(matrix.get(r, c));
  return new Matrix(matrix.cols, matrix.rows, data);
}

/**
 * Lookups take one lookup value; given an array of them (an array constant, or a range in an
 * array formula) they give one result per value, as =SUMPRODUCT(--(MATCH(A1:A9,A1:A9,0)>0)) relies on.
 */
function manyValues(fn: Fn): Fn {
  return (args, ctx) => {
    const first = args[0];
    if (!first || first.k === "missing") return fn(args, ctx);
    const value = evaluate(first, ctx);
    let many: Matrix | null = null;
    if (value instanceof Matrix && value.data.length > 1) many = value;
    else if (value instanceof Ref && ctx.array) {
      const area = value.single;
      if (area && (area.r1 !== area.r2 || area.c1 !== area.c2))
        many = ctx.engine.toMatrix(value, ctx);
    }
    const rest = args
      .slice(1)
      .map((arg, i): Node => (i === 0 ? { k: "value", v: evaluate(arg, ctx) } : arg));
    if (!many) return fn([{ k: "value", v: value }, ...rest], ctx);
    return ctx.engine.liftN([many], { ...ctx, extent: undefined }, ([item]) => {
      try {
        return ctx.engine.toScalar(fn([{ k: "value", v: item! }, ...rest], ctx), ctx);
      } catch (error) {
        if (error instanceof XlError) return error;
        throw error;
      }
    });
  };
}

for (const name of ["MATCH", "XMATCH", "VLOOKUP", "HLOOKUP", "LOOKUP"])
  LOOKUP[name] = manyValues(LOOKUP[name]!);

/**
 * INDEX given arrays of row, column or area numbers looks each combination up and keeps the
 * top-left value of what it finds, so =INDEX({2,3;4,5},{1,2}) is {2,4}.
 */
function manyIndexes(fn: Fn): Fn {
  return (args, ctx) => {
    const source: Node = { k: "value", v: evaluate(args[0]!, ctx) };
    const picks = args
      .slice(1)
      .map((arg) => (arg.k === "missing" ? undefined : evaluate(arg, ctx)));
    const asNode = (v: Value | undefined): Node =>
      v === undefined ? { k: "missing" } : { k: "value", v };
    const operands = picks.map((v) => (v === undefined ? undefined : ctx.engine.operand(v, ctx)));
    if (!operands.some((v) => v instanceof Matrix)) return fn([source, ...picks.map(asNode)], ctx);
    const present = operands.flatMap((v, i) => (v === undefined ? [] : [i]));
    return ctx.engine.liftN(
      present.map((i) => operands[i]!),
      { ...ctx, extent: undefined },
      (items) => {
        const chosen: Array<Value | undefined> = operands.map(() => undefined);
        present.forEach((i, n) => {
          chosen[i] = items[n]!;
        });
        try {
          const found = fn([source, ...chosen.map(asNode)], ctx);
          if (found instanceof Ref) {
            const area = found.areas[0]!;
            return ctx.engine.cellValue(area.sheet, area.r1, area.c1) ?? 0;
          }
          return found instanceof Matrix ? (found.get(0, 0) ?? 0) : found;
        } catch (error) {
          if (error instanceof XlError) return error;
          throw error;
        }
      },
    );
  };
}

LOOKUP.INDEX = manyIndexes(LOOKUP.INDEX!);

const typeRank = (v: Scalar) =>
  typeof v === "number" ? 0 : typeof v === "string" ? 1 : typeof v === "boolean" ? 2 : 3;

/** XMATCH's ordering across types (numbers, text, logicals, then blanks); a blank lookup value sorts above all. */
function xCompare(item: Scalar, value: Scalar): number {
  if (value === null) return -1;
  const ranks = typeRank(item) - typeRank(value);
  return ranks !== 0 ? Math.sign(ranks) : item === null ? 0 : compare(item, value);
}

/** XMATCH positions: -1 when absent, -2 for an invalid mode (#VALUE!). */
function xIndex(items: Scalar[], value: Scalar, mode: number, search: number): number {
  if (![-1, 0, 1, 2].includes(mode) || ![-2, -1, 1, 2].includes(search)) return -2;
  if (search === 2 || search === -2) {
    if (mode === 2) return -2;
    const descending = search === -2;
    let lo = 0;
    let hi = items.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const c = xCompare(items[mid]!, value);
      if (c === 0) return mid;
      if ((c < 0 && mode === -1) || (c > 0 && mode === 1)) found = mid;
      if (c < 0 !== descending) lo = mid + 1;
      else hi = mid - 1;
    }
    return found;
  }
  const fromEnd = search === -1;
  if (mode === 0 || mode === 2) return exactIndex(items, value, mode === 2, fromEnd);
  let best = -1;
  const order = fromEnd ? [...items.keys()].reverse() : [...items.keys()];
  for (const i of order) {
    const item = items[i]!;
    const c = xCompare(item, value);
    if (c === 0) return i;
    if (mode === -1 && c < 0 && (best < 0 || xCompare(item, items[best]!) > 0)) best = i;
    if (mode === 1 && c > 0 && (best < 0 || xCompare(item, items[best]!) < 0)) best = i;
  }
  return best;
}

function position(args: Node[], ctx: Context, which: "row" | "col"): Value {
  if (!args.length || args[0]!.k === "missing") return (which === "row" ? ctx.row : ctx.col) + 1;
  const value = evaluate(args[0]!, ctx);
  if (value instanceof XlError) return value;
  if (!(value instanceof Ref)) return VALUE;
  const area = value.areas[0]!;
  const first = which === "row" ? area.r1 : area.c1;
  const last = which === "row" ? area.r2 : area.c2;
  if (!ctx.array || first === last) return first + 1;
  const items: Scalar[] = [];
  for (let n = first; n <= last; n++) items.push(n + 1);
  return which === "row" ? new Matrix(items.length, 1, items) : new Matrix(1, items.length, items);
}
