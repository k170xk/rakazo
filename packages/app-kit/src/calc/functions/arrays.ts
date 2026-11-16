import type { Context } from "../engine.js";
import type { Node } from "../parse.js";
import type { Scalar, Value } from "../values.js";
import {
  CALC,
  compare,
  DIV0,
  Lambda,
  Matrix,
  NA,
  NUM,
  REF,
  Ref,
  VALUE,
  XlError,
} from "../values.js";
import type { Fn } from "./helpers.js";
import { bool, evaluate, int, num, text } from "./helpers.js";

/** An argument as an array: evaluated the way Excel evaluates array parameters, ranges as their cells. */
function arrayArg(node: Node | undefined, ctx: Context): Matrix {
  if (!node || node.k === "missing") return Matrix.fill(1, 1, null);
  return ctx.engine.toMatrix(
    ctx.engine.evaluate(node, { ...ctx, array: true, extent: undefined }),
    ctx,
  );
}

/** A one-row or one-column argument as a list; a two-dimensional one is #VALUE!. */
function vectorArg(node: Node | undefined, ctx: Context): Scalar[] {
  const matrix = arrayArg(node, ctx);
  if (matrix.rows > 1 && matrix.cols > 1) throw VALUE;
  return matrix.data;
}

/** The arguments a function takes one value of; left out (or left empty) arrives as undefined. */
const scalarArgs = (args: Node[], ctx: Context, skip: number[] = []): Value[] =>
  args.map((arg, i) =>
    skip.includes(i) || arg.k === "missing" ? undefined : evaluate(arg, ctx),
  ) as Value[];

/**
 * Calls `impl` with the single-value arguments, lifted over arrays like any function. Without
 * arrays among them the whole result spills; across an array each cell keeps its result's first value.
 */
function spill(
  values: Value[],
  ctx: Context,
  impl: (items: Array<Scalar | undefined>) => Matrix | Scalar,
): Value {
  let whole: Matrix | Scalar = null;
  const lifted = ctx.engine.liftN(values, ctx, (items) => {
    try {
      whole = impl(items);
    } catch (error) {
      if (!(error instanceof XlError)) throw error;
      whole = error;
    }
    return whole instanceof Matrix ? whole.get(0, 0) : whole;
  });
  return lifted instanceof Matrix ? lifted : whole;
}

const rowsOf = (m: Matrix): Scalar[][] =>
  Array.from({ length: m.rows }, (_, r) => m.data.slice(r * m.cols, (r + 1) * m.cols));

function transpose(m: Matrix): Matrix {
  const data: Scalar[] = [];
  for (let c = 0; c < m.cols; c++) for (let r = 0; r < m.rows; r++) data.push(m.get(r, c));
  return new Matrix(m.cols, m.rows, data);
}

/** A block of rows r0..r1-1 and columns c0..c1-1. */
function slice(m: Matrix, r0: number, r1: number, c0: number, c1: number): Matrix {
  const data: Scalar[] = [];
  for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) data.push(m.get(r, c));
  return new Matrix(r1 - r0, c1 - c0, data);
}

/** Blank cells read back as 0 in a spilled array, the way Excel shows them. */
const shown = (m: Matrix): Matrix =>
  m.data.includes(null)
    ? new Matrix(
        m.rows,
        m.cols,
        m.data.map((v) => v ?? 0),
      )
    : m;

function choose(byColumn: boolean): Fn {
  return (args, ctx) => {
    if (args.length < 2) return VALUE;
    const array = arrayArg(args[0], ctx);
    const size = byColumn ? array.cols : array.rows;
    const picks: number[] = [];
    for (const arg of args.slice(1)) {
      for (const item of vectorArg(arg, ctx)) {
        const n = Math.trunc(num(item));
        if (n === 0 || Math.abs(n) > size) return VALUE;
        picks.push(n > 0 ? n - 1 : size + n);
      }
    }
    const source = byColumn ? transpose(array) : array;
    const picked = new Matrix(
      picks.length,
      source.cols,
      picks.flatMap((i) => source.data.slice(i * source.cols, (i + 1) * source.cols)),
    );
    return shown(byColumn ? transpose(picked) : picked);
  };
}

/** A count argument: a whole number, from text or TRUE too. */
const count = (value: Scalar | undefined, fallback: number): number =>
  value === undefined ? fallback : Math.trunc(num(value));

function stack(vertical: boolean): Fn {
  return (args, ctx) => {
    const parts = args.filter((a) => a.k !== "missing").map((a) => arrayArg(a, ctx));
    if (!parts.length) return VALUE;
    const oriented = vertical ? parts : parts.map(transpose);
    const cols = Math.max(...oriented.map((m) => m.cols));
    const rows = oriented.flatMap((m) =>
      rowsOf(m).map((row) => [...row, ...new Array<Scalar>(cols - row.length).fill(NA)]),
    );
    const out = shown(Matrix.of(rows));
    return vertical ? out : transpose(out);
  };
}

/** TOCOL/TOROW's values in reading order, skipping blanks (ignore 1), errors (2) or both (3). */
function flatten(array: Matrix, ignore: number, byColumn: boolean): Scalar[] {
  if (ignore < 0 || ignore > 3) throw VALUE;
  const source = byColumn ? transpose(array) : array;
  const out = source.data.filter(
    (v) => !((ignore & 1 && v === null) || (ignore & 2 && v instanceof XlError)),
  );
  if (!out.length) throw XlError.of("#CALC!");
  return out.map((v) => v ?? 0);
}

function wrap(byColumn: boolean): Fn {
  return (args, ctx) => {
    const vector = vectorArg(args[0], ctx);
    return spill(scalarArgs(args, ctx, [0]), ctx, (items) => {
      const size = Math.trunc(num(items[1] ?? null));
      const pad = items[2] === undefined ? NA : items[2];
      if (size < 1) return NUM;
      const lines = Math.ceil(vector.length / size);
      const out = new Matrix(
        lines,
        size,
        Array.from({ length: lines * size }, (_, i) =>
          i < vector.length ? (vector[i] ?? 0) : pad,
        ),
      );
      return byColumn ? transpose(out) : out;
    });
  };
}

/** TEXTSPLIT on one text: rows split on the row delimiters, then columns, short rows padded. */
function textSplit(
  s: string,
  columns: string[],
  rows: string[] | null,
  ignoreEmpty: boolean,
  mode: number,
  pad: Scalar,
): Matrix {
  if (mode !== 0 && mode !== 1) throw VALUE;
  if (!columns.length || columns.some((d) => !d) || rows?.some((d) => !d)) throw VALUE;
  const split = (line: string, delimiters: string[]) => {
    const hay = mode ? line.toLowerCase() : line;
    const needles = mode ? delimiters.map((d) => d.toLowerCase()) : delimiters;
    const parts: string[] = [];
    let start = 0;
    let at = 0;
    while (at <= hay.length) {
      let length = 0;
      for (const needle of needles)
        if (needle.length > length && hay.startsWith(needle, at)) length = needle.length;
      if (length) {
        parts.push(line.slice(start, at));
        at += length;
        start = at;
      } else at++;
    }
    parts.push(line.slice(start));
    return parts;
  };
  let table = (rows ? split(s, rows) : [s]).map((line) => split(line, columns));
  if (ignoreEmpty)
    table = table.map((row) => row.filter((v) => v !== "")).filter((row) => row.length);
  if (!table.length) throw XlError.of("#CALC!");
  const width = Math.max(...table.map((row) => row.length));
  return Matrix.of(
    table.map((row) => [...row, ...new Array<Scalar>(width - row.length).fill(pad)]),
  );
}

const isBlank = (v: Scalar) => v === null;

/** TRIMRANGE's trim argument: 0 none, 1 leading, 2 trailing, 3 both; a fraction or an array is #VALUE!. */
function trimMode(node: Node | undefined, ctx: Context): number {
  if (!node || node.k === "missing") return 3;
  const value = evaluate(node, ctx);
  if (value instanceof Matrix && value.rows * value.cols !== 1) throw VALUE;
  if (
    value instanceof Ref &&
    (!value.single || value.single.r1 !== value.single.r2 || value.single.c1 !== value.single.c2)
  )
    throw VALUE;
  const n = num(ctx.engine.toScalar(value, ctx));
  if (!Number.isInteger(n) || n < 0 || n > 3) throw VALUE;
  return n;
}

/** PERCENTOF's sum: numbers only; any error in either argument makes the result #NUM!. */
function percentSum(value: Value, ctx: Context): number {
  let sum = 0;
  for (const item of ctx.engine.toMatrix(value, ctx).data) {
    if (item instanceof XlError) throw NUM;
    if (typeof item === "number") sum += item;
  }
  return sum;
}

/** One row or column of a GROUPBY/PIVOTBY result: its field keys, the data rows it covers and those of its parent group. */
type Entry = { keys: Scalar[]; rows: number[]; parent: number[] };

type Axis = {
  fields: Matrix;
  depth: number;
  descending: Set<number>;
  /** Orders the last level by the aggregate of these rows' values instead of by key. */
  byValue: ((rows: number[]) => Scalar) | null;
};

const keyOf = (v: Scalar) =>
  typeof v === "string"
    ? `s:${v.toLowerCase()}`
    : v instanceof XlError
      ? `e:${v.code}`
      : `${typeof v}:${v}`;

/** The rows and subtotal rows along one axis, in output order. */
function entries(axis: Axis, rows: number[]): Entry[] {
  const n = axis.fields.cols;
  const totalAt = (level: number) => level < Math.abs(axis.depth);
  const blank = (count: number) => new Array<Scalar>(count).fill("");
  const walk = (subset: number[], level: number, prefix: Scalar[]): Entry[] => {
    const groups = new Map<string, { key: Scalar; rows: number[] }>();
    for (const r of subset) {
      const key = axis.fields.get(r, level);
      const id = keyOf(key);
      const group = groups.get(id);
      if (group) group.rows.push(r);
      else groups.set(id, { key, rows: [r] });
    }
    const last = level === n - 1;
    const sign = axis.descending.has(level) ? -1 : 1;
    const sorted = [...groups.values()];
    if (last && axis.byValue) {
      const byValue = axis.byValue;
      const scored = sorted.map((g) => ({ g, v: byValue(g.rows) }));
      scored.sort((a, b) => (compare(a.v, b.v) || compare(a.g.key, b.g.key)) * sign);
      sorted.splice(0, sorted.length, ...scored.map((s) => s.g));
    } else sorted.sort((a, b) => compare(a.key, b.key) * sign);
    const out: Entry[] = [];
    for (const group of sorted) {
      const keys = [...prefix, group.key ?? ""];
      if (last) {
        out.push({ keys, rows: group.rows, parent: subset });
        continue;
      }
      const children = walk(group.rows, level + 1, keys);
      const total = totalAt(level + 1)
        ? [{ keys: [...keys, ...blank(n - keys.length)], rows: group.rows, parent: subset }]
        : [];
      out.push(...(axis.depth < 0 ? [...total, ...children] : [...children, ...total]));
    }
    return out;
  };
  const body = walk(rows, 0, []);
  if (!axis.depth) return body;
  const grand = {
    keys: [Math.abs(axis.depth) > 1 ? "Grand Total" : "Total", ...blank(n - 1)],
    rows,
    parent: rows,
  };
  return axis.depth < 0 ? [grand, ...body] : [...body, grand];
}

/** A sort-order argument: the fields (counted from 1) to sort descending, or a sort by value column. */
function sortOrder(node: Node | undefined, ctx: Context, fields: number, valueColumns: number) {
  const descending = new Set<number>();
  if (!node || node.k === "missing") return { descending, byValue: null };
  const items = arrayArg(node, ctx).data.map((v) => num(v));
  const seen = new Set<number>();
  for (const item of items) {
    const k = Math.abs(Math.trunc(item));
    if (!Number.isInteger(item) || k === 0 || seen.has(k)) throw VALUE;
    seen.add(k);
    if (k > fields) {
      if (items.length > 1 || k > fields + valueColumns) throw VALUE;
      if (item < 0) descending.add(fields - 1);
      return { descending, byValue: k - fields - 1 };
    }
    if (item < 0) descending.add(k - 1);
  }
  return { descending, byValue: null };
}

const intersect = (a: number[], b: number[]) => {
  const set = new Set(b);
  return a.filter((r) => set.has(r));
};

/** A total-depth argument; deeper than the fields allow is #VALUE!. */
function totalDepth(
  node: Node | undefined,
  ctx: Context,
  fields: number,
  fallback: number,
): number {
  if (!node || node.k === "missing") return fallback;
  const depth = Math.trunc(num(ctx.engine.toScalar(evaluate(node, ctx), ctx)));
  if (Math.abs(depth) > Math.max(2, fields)) throw VALUE;
  return depth;
}

/** GROUPBY is PIVOTBY with one column group and no column totals. */
function pivot(args: Node[], ctx: Context, grouped: boolean): Value {
  const at = (i: number) => args[grouped && i > 0 ? i - 1 : i];
  const rowFields = arrayArg(args[0], ctx);
  const values = arrayArg(at(2), ctx);
  const colFields = grouped ? Matrix.fill(values.rows, 1, 1) : arrayArg(args[1], ctx);
  if (rowFields.rows !== values.rows || colFields.rows !== values.rows) return VALUE;
  const fnNode = at(3);
  const fn = fnNode ? ctx.engine.evaluate(fnNode, ctx) : VALUE;
  const fnValue = fn instanceof Ref ? ctx.engine.toScalar(fn, ctx) : fn;
  if (fnValue instanceof XlError) return fnValue;
  if (!(fn instanceof Lambda)) return VALUE;
  const withTotal = fn.builtin
    ? fn.builtin.toUpperCase().endsWith("PERCENTOF")
    : fn.params.length === 2;

  const option = (index: number): Scalar | undefined => {
    const node = args[index];
    return !node || node.k === "missing"
      ? undefined
      : ctx.engine.toScalar(evaluate(node, ctx), ctx);
  };
  const headerArg = option(grouped ? 3 : 4);
  let headers = headerArg === undefined ? -1 : Math.trunc(num(headerArg));
  if (headers === -1) {
    headers = typeof values.get(0, 0) === "string" ? 1 : 0;
    if (!grouped && (rowFields.cols > 1 || colFields.cols > 1 || values.cols > 1)) headers += 2;
  }
  if (headers < 0 || headers > 3) return VALUE;
  const hasHeaders = headers === 1 || headers === 3;
  const first = hasHeaders ? 1 : 0;
  const data = Array.from({ length: values.rows - first }, (_, i) => i + first);

  const filterNode = args[grouped ? 6 : 9];
  let rows = data;
  if (filterNode && filterNode.k !== "missing") {
    const filter = arrayArg(filterNode, ctx);
    if (filter.rows !== values.rows) return VALUE;
    const keep = data.map((r) => {
      const v = filter.get(r, 0);
      if (v !== null && typeof v !== "number" && typeof v !== "boolean") throw VALUE;
      return Boolean(v);
    });
    rows = data.filter((_, i) => keep[i]);
  }
  const relation = grouped ? option(7) : undefined;
  if (relation !== undefined && relation !== 0 && relation !== 1) return VALUE;
  const relativeTo = grouped ? 0 : Math.trunc(num(option(10) ?? 0));
  if (relativeTo < 0 || relativeTo > 4) return VALUE;

  const aggregate = (cells: number[], column: number, total: number[]): Scalar => {
    const items = cells.map((r) => values.get(r, column));
    if (items.every((v) => v === null)) return "";
    const list = (rs: Scalar[]) => new Matrix(rs.length, 1, rs);
    const result = ctx.engine.applyLambda(
      fn,
      withTotal ? [list(items), list(total.map((r) => values.get(r, column)))] : [list(items)],
      ctx,
    );
    if (result instanceof Matrix && result.rows * result.cols !== 1) return XlError.of("#CALC!");
    return ctx.engine.toScalar(result, ctx);
  };

  const rowSort = sortOrder(args[grouped ? 5 : 6], ctx, rowFields.cols, grouped ? values.cols : 1);
  const colSort = grouped
    ? { descending: new Set<number>(), byValue: null }
    : sortOrder(args[8], ctx, colFields.cols, 1);
  const rowAxis: Axis = {
    fields: rowFields,
    depth: totalDepth(args[grouped ? 4 : 5], ctx, rowFields.cols, grouped ? 1 : rowFields.cols),
    descending: rowSort.descending,
    byValue: null,
  };
  const colAxis: Axis = {
    fields: colFields,
    depth: grouped ? 0 : totalDepth(args[7], ctx, colFields.cols, colFields.cols),
    descending: colSort.descending,
    byValue: null,
  };
  if (rowSort.byValue !== null) {
    const column = rowSort.byValue;
    rowAxis.byValue = (cells) => aggregate(cells, column, rows);
  }
  if (colSort.byValue !== null) colAxis.byValue = (cells) => aggregate(cells, 0, rows);

  const rowEntries = entries(rowAxis, rows);
  const colEntries = entries(colAxis, rows);
  const totalFor = (row: Entry, col: Entry): number[] => {
    switch (relativeTo) {
      case 1:
        return row.rows;
      case 2:
        return rows;
      case 3:
        return intersect(row.rows, col.parent);
      case 4:
        return intersect(col.rows, row.parent);
      default:
        return col.rows;
    }
  };

  const nr = rowFields.cols;
  const nv = values.cols;
  const header = (fields: Matrix, i: number, label: string) =>
    hasHeaders ? (fields.get(0, i) ?? "") : `${label} ${i + 1}`;
  const out: Scalar[][] = [];
  if (headers >= 2 && !grouped) {
    const names = Array.from({ length: colFields.cols }, (_, i) =>
      header(colFields, i, "Column Field"),
    ).join(", ");
    out.push([
      ...new Array<Scalar>(nr).fill(""),
      names,
      ...new Array<Scalar>(colEntries.length * nv - 1).fill(""),
    ]);
  }
  if (!grouped)
    for (let level = 0; level < colFields.cols; level++)
      out.push([
        ...new Array<Scalar>(nr).fill(""),
        ...colEntries.flatMap((e) => new Array<Scalar>(nv).fill(e.keys[level] ?? "")),
      ]);
  if (headers >= 2) {
    const names = Array.from({ length: nr }, (_, i) => header(rowFields, i, "Row Field"));
    const valueNames = Array.from({ length: nv }, (_, i) => header(values, i, "Value"));
    out.push([...names, ...colEntries.flatMap(() => valueNames)]);
  }
  for (const row of rowEntries) {
    const line: Scalar[] = [...row.keys];
    for (const col of colEntries) {
      const cells = intersect(row.rows, col.rows);
      const total = withTotal ? totalFor(row, col) : [];
      for (let v = 0; v < nv; v++) line.push(cells.length ? aggregate(cells, v, total) : "");
    }
    out.push(line);
  }
  return Matrix.of(out);
}

const guarded =
  (grouped: boolean): Fn =>
  (args, ctx) => {
    try {
      return pivot(args, ctx, grouped);
    } catch (error) {
      if (error instanceof XlError) return error;
      throw error;
    }
  };

export const ARRAYS: Record<string, Fn> = {
  GROUPBY: guarded(true),
  PIVOTBY: guarded(false),
  CHOOSECOLS: choose(true),
  CHOOSEROWS: choose(false),
  DROP: (args, ctx) => {
    const array = arrayArg(args[0], ctx);
    return spill(scalarArgs(args, ctx, [0]), ctx, (items) => {
      const rows = count(items[1] ?? null, 0);
      const cols = count(items[2], 0);
      if (Math.abs(rows) >= array.rows || Math.abs(cols) >= array.cols) return CALC;
      const out = slice(
        array,
        Math.max(rows, 0),
        array.rows + Math.min(rows, 0),
        Math.max(cols, 0),
        array.cols + Math.min(cols, 0),
      );
      return shown(out);
    });
  },
  TAKE: (args, ctx) => {
    const array = arrayArg(args[0], ctx);
    return spill(scalarArgs(args, ctx, [0]), ctx, (items) => {
      const rows = Math.max(-array.rows, Math.min(array.rows, count(items[1], array.rows)));
      const cols = Math.max(-array.cols, Math.min(array.cols, count(items[2], array.cols)));
      if (rows === 0 || cols === 0) return CALC;
      const r0 = rows > 0 ? 0 : array.rows + rows;
      const c0 = cols > 0 ? 0 : array.cols + cols;
      return shown(slice(array, r0, r0 + Math.abs(rows), c0, c0 + Math.abs(cols)));
    });
  },
  EXPAND: (args, ctx) => {
    const array = arrayArg(args[0], ctx);
    return spill(scalarArgs(args, ctx, [0]), ctx, (items) => {
      const rows = count(items[1], array.rows);
      const cols = count(items[2], array.cols);
      const pad = items[3] === undefined ? NA : items[3];
      if (rows < array.rows || cols < array.cols) return VALUE;
      const data: Scalar[] = [];
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          data.push(r < array.rows && c < array.cols ? (array.get(r, c) ?? 0) : pad);
      return new Matrix(rows, cols, data);
    });
  },
  HSTACK: stack(false),
  VSTACK: stack(true),
  TOCOL: (args, ctx) => {
    const array = arrayArg(args[0], ctx);
    return spill(scalarArgs(args, ctx, [0]), ctx, (items) => {
      const values = flatten(
        array,
        count(items[1] ?? null, 0),
        items[2] === undefined ? false : bool(items[2]),
      );
      return new Matrix(values.length, 1, values);
    });
  },
  TOROW: (args, ctx) => {
    const array = arrayArg(args[0], ctx);
    return spill(scalarArgs(args, ctx, [0]), ctx, (items) => {
      const values = flatten(
        array,
        count(items[1] ?? null, 0),
        items[2] === undefined ? false : bool(items[2]),
      );
      return new Matrix(1, values.length, values);
    });
  },
  WRAPCOLS: wrap(true),
  WRAPROWS: wrap(false),
  TEXTSPLIT: (args, ctx) => {
    const delimiters = (index: number): string[] | null => {
      const node = args[index];
      if (!node || node.k === "missing") return null;
      return arrayArg(node, ctx).data.map((v) => text(v));
    };
    let columns: string[] | null;
    let rows: string[] | null;
    try {
      columns = delimiters(1);
      rows = delimiters(2);
    } catch (error) {
      if (error instanceof XlError) return error;
      throw error;
    }
    return spill(scalarArgs(args, ctx, [1, 2]), ctx, (items) => {
      const subject = items[0];
      if (subject === undefined || subject === null) return VALUE;
      const ignoreEmpty = items[3] === undefined || items[3] === null ? false : bool(items[3]);
      const mode = items[4] === undefined || items[4] === null ? 0 : int(items[4]);
      const pad = items[5] === undefined ? NA : items[5];
      return textSplit(text(subject), columns ?? [], rows, ignoreEmpty, mode, pad);
    });
  },
  SORTBY: (args, ctx) => {
    const array = arrayArg(args[0], ctx);
    if (args.length < 2) return VALUE;
    const keys: Array<{ values: Scalar[]; order: number }> = [];
    let vertical: boolean | null = null;
    for (let i = 1; i < args.length; i += 2) {
      const by = arrayArg(args[i], ctx);
      const isVertical = by.cols === 1 && by.rows === array.rows;
      const isHorizontal = by.rows === 1 && by.cols === array.cols;
      const orientation: boolean | null =
        isVertical && (!isHorizontal || vertical !== false) ? true : isHorizontal ? false : null;
      if (orientation === null || (vertical !== null && vertical !== orientation)) return VALUE;
      vertical = orientation;
      const orderNode = args[i + 1];
      const order =
        orderNode && orderNode.k !== "missing"
          ? num(ctx.engine.toScalar(evaluate(orderNode, ctx), ctx))
          : 1;
      if (order !== 1 && order !== -1) return VALUE;
      keys.push({ values: by.data, order });
    }
    const source = vertical === false ? transpose(array) : array;
    const lines = rowsOf(source)
      .map((row, i) => ({ row, i }))
      .sort((a, b) => {
        for (const key of keys) {
          const x = key.values[a.i] ?? null;
          const y = key.values[b.i] ?? null;
          if ((x === null) !== (y === null)) return x === null ? 1 : -1;
          const order = compare(x, y);
          if (order) return order * key.order;
        }
        return a.i - b.i;
      })
      .map((item) => item.row);
    const out = shown(Matrix.of(lines));
    return vertical === false ? transpose(out) : out;
  },
  TRIMRANGE: (args, ctx) => {
    const value = args[0] ? evaluate(args[0], ctx) : VALUE;
    if (value instanceof XlError) return value;
    const rowMode = trimMode(args[1], ctx);
    const colMode = trimMode(args[2], ctx);
    if (value instanceof Ref && !value.single) return VALUE;
    const matrix = ctx.engine.toMatrix(value, ctx);
    const rowUsed = (r: number) => rowsOf(matrix)[r]!.some((v) => !isBlank(v));
    const colUsed = (c: number) =>
      Array.from({ length: matrix.rows }, (_, r) => matrix.get(r, c)).some((v) => !isBlank(v));
    let r0 = 0;
    let r1 = matrix.rows - 1;
    let c0 = 0;
    let c1 = matrix.cols - 1;
    if (rowMode & 1) while (r0 <= r1 && !rowUsed(r0)) r0++;
    if (rowMode & 2) while (r1 >= r0 && !rowUsed(r1)) r1--;
    if (colMode & 1) while (c0 <= c1 && !colUsed(c0)) c0++;
    if (colMode & 2) while (c1 >= c0 && !colUsed(c1)) c1--;
    if (r0 > r1 || c0 > c1) return REF;
    if (value instanceof Ref) {
      const area = value.single!;
      return new Ref([
        {
          sheet: area.sheet,
          r1: area.r1 + r0,
          c1: area.c1 + c0,
          r2: rowMode & 2 ? area.r1 + r1 : area.r2,
          c2: colMode & 2 ? area.c1 + c1 : area.c2,
        },
      ]);
    }
    return slice(matrix, r0, r1 + 1, c0, c1 + 1);
  },
  PERCENTOF: (args, ctx) => {
    if (args.length !== 2) return VALUE;
    const part = percentSum(arrayArg(args[0], ctx), ctx);
    const all = percentSum(arrayArg(args[1], ctx), ctx);
    return all === 0 ? DIV0 : part / all;
  },
};
