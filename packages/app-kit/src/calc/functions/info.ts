import type { Context } from "../engine.js";
import type { Node } from "../parse.js";
import type { Matrix, Scalar, Value } from "../values.js";
import { DIV0, NA, NUM, parseNumber, Ref, VALUE, XlError } from "../values.js";
import type { Fn } from "./helpers.js";
import { check, criterion, evaluate, single, text } from "./helpers.js";

/** A database argument (DSUM and friends) as a header row and records. */
function table(value: Value, ctx: Context): Matrix {
  if (value instanceof XlError) throw value;
  const matrix = ctx.engine.toMatrix(value, ctx);
  if (matrix.rows < 1) throw VALUE;
  return matrix;
}

function fieldIndex(database: Matrix, field: Scalar): number {
  if (field instanceof XlError) throw field;
  if (typeof field === "number") {
    const index = Math.trunc(field) - 1;
    if (index < 0 || index >= database.cols) throw VALUE;
    return index;
  }
  if (typeof field === "string") {
    const wanted = field.trim().toLowerCase();
    for (let c = 0; c < database.cols; c++) {
      const header = database.get(0, c);
      if (header !== null && String(header).trim().toLowerCase() === wanted) return c;
    }
  }
  throw VALUE;
}

/**
 * Database criteria the way Excel reads them: conditions on one row must all hold, any row may
 * match, an empty row matches everything, and plain text matches entries that begin with it.
 */
function matcher(database: Matrix, criteria: Matrix): (record: number) => boolean {
  const rows: Array<Array<[number, (cell: Scalar) => boolean]>> = [];
  for (let r = 1; r < criteria.rows; r++) {
    const tests: Array<[number, (cell: Scalar) => boolean]> = [];
    for (let c = 0; c < criteria.cols; c++) {
      const condition = criteria.get(r, c);
      if (condition === null || condition === "") continue;
      if (condition instanceof XlError) throw condition;
      const column = fieldIndex(database, criteria.get(0, c) ?? "");
      let test: Scalar = condition;
      if (
        typeof condition === "string" &&
        !/^(<=|>=|<>|=|<|>)/.test(condition) &&
        parseNumber(condition) === null
      )
        test = `${condition}*`;
      tests.push([column, criterion(test)]);
    }
    rows.push(tests);
  }
  if (!rows.length) return () => false;
  return (record) =>
    rows.some((tests) => tests.every(([column, test]) => test(database.get(record, column))));
}

/** The values of `field` in the records the criteria select. */
function selected(args: Node[], ctx: Context, needField = true): Scalar[] {
  const database = table(evaluate(args[0]!, ctx), ctx);
  const criteria = table(evaluate(args[2]!, ctx), ctx);
  const fieldArg = args[1] && args[1].k !== "missing" ? check(single(args, 1, ctx) ?? null) : null;
  if (fieldArg === null && needField) throw VALUE;
  const column = fieldArg === null ? -1 : fieldIndex(database, fieldArg);
  const keep = matcher(database, criteria);
  const out: Scalar[] = [];
  for (let r = 1; r < database.rows; r++)
    if (keep(r)) out.push(column < 0 ? 0 : database.get(r, column));
  return out;
}

const numbers = (items: Scalar[]) => items.filter((x): x is number => typeof x === "number");

function variance(items: number[], sample: boolean): number | XlError {
  const n = items.length;
  if (n < (sample ? 2 : 1)) return DIV0;
  const mean = items.reduce((a, b) => a + b, 0) / n;
  const squares = items.reduce((a, b) => a + (b - mean) ** 2, 0);
  return squares / (sample ? n - 1 : n);
}

const sqrt = (v: number | XlError) => (v instanceof XlError ? v : Math.sqrt(v));

export const INFO: Record<string, Fn> = {
  DSUM: (args, ctx) => numbers(selected(args, ctx)).reduce((a, b) => a + b, 0),
  DAVERAGE: (args, ctx) => {
    const items = numbers(selected(args, ctx));
    return items.length ? items.reduce((a, b) => a + b, 0) / items.length : DIV0;
  },
  DCOUNT: (args, ctx) => {
    const fieldGiven = args[1] && args[1].k !== "missing";
    const items = selected(args, ctx, false);
    return fieldGiven ? numbers(items).length : items.length;
  },
  DCOUNTA: (args, ctx) => {
    const fieldGiven = args[1] && args[1].k !== "missing";
    const items = selected(args, ctx, false);
    return fieldGiven ? items.filter((x) => x !== null && x !== "").length : items.length;
  },
  DGET: (args, ctx) => {
    const items = selected(args, ctx);
    if (!items.length) return VALUE;
    if (items.length > 1) return NUM;
    return items[0] ?? 0;
  },
  DMAX: (args, ctx) => {
    const items = numbers(selected(args, ctx));
    return items.length ? Math.max(...items) : 0;
  },
  DMIN: (args, ctx) => {
    const items = numbers(selected(args, ctx));
    return items.length ? Math.min(...items) : 0;
  },
  DPRODUCT: (args, ctx) => {
    const items = numbers(selected(args, ctx));
    return items.length ? items.reduce((a, b) => a * b, 1) : 0;
  },
  DVAR: (args, ctx) => variance(numbers(selected(args, ctx)), true),
  DVARP: (args, ctx) => variance(numbers(selected(args, ctx)), false),
  DSTDEV: (args, ctx) => sqrt(variance(numbers(selected(args, ctx)), true)),
  DSTDEVP: (args, ctx) => sqrt(variance(numbers(selected(args, ctx)), false)),
  FORMULATEXT: (args, ctx) => {
    const ref = args[0] ? evaluate(args[0], ctx) : VALUE;
    if (ref instanceof XlError) return ref;
    if (!(ref instanceof Ref)) return VALUE;
    const area = ref.areas[0]!;
    return ctx.engine.formulaText(area.sheet, area.r1, area.c1) ?? NA;
  },
  HYPERLINK: (args, ctx) => {
    const link = check(single(args, 0, ctx) ?? null);
    if (args[1] && args[1].k !== "missing") return single(args, 1, ctx) ?? 0;
    return link === null ? 0 : text(link);
  },
  CELL: (args, ctx) => {
    const info = text(check(single(args, 0, ctx) ?? null))
      .trim()
      .toLowerCase();
    const target = args[1] && args[1].k !== "missing" ? evaluate(args[1], ctx) : null;
    if (target instanceof XlError) return target;
    if (target !== null && !(target instanceof Ref)) return VALUE;
    const area = target
      ? target.areas[0]!
      : { sheet: ctx.sheet, r1: ctx.row, c1: ctx.col, r2: ctx.row, c2: ctx.col };
    const value = ctx.engine.cellValue(area.sheet, area.r1, area.c1);
    switch (info) {
      case "address":
        return ctx.engine.addressText(area.sheet, area.r1, area.c1, area.sheet !== ctx.sheet);
      case "col":
        return area.c1 + 1;
      case "row":
        return area.r1 + 1;
      case "contents":
        return value === null ? 0 : value;
      case "type":
        return value === null ? "b" : typeof value === "string" ? "l" : "v";
      case "filename":
        return ctx.engine.fileNameText(area.sheet);
      case "sheet":
        return area.sheet + 1;
      case "prefix":
        return typeof value === "string" ? "'" : "";
      default:
        return VALUE;
    }
  },
};
