import type { Context } from "../engine.js";
import type { Node } from "../parse.js";
import type { Scalar, Value } from "../values.js";
import {
  compare,
  ERRORS,
  isError,
  Lambda,
  Matrix,
  NA,
  Ref,
  toBoolean,
  toNumber,
  VALUE,
  XlError,
} from "../values.js";
import type { Fn } from "./helpers.js";
import { elementwise, evaluate, num, scalar } from "./helpers.js";

const branch = (args: Node[], index: number, ctx: Context, omitted: Scalar): Value => {
  const arg = args[index];
  if (!arg) return omitted;
  if (arg.k === "missing") return 0;
  return evaluate(arg, ctx);
};

/** The logical values among arguments, as AND/OR/XOR read them. */
function logicals(args: Node[], ctx: Context): boolean[] {
  const out: boolean[] = [];
  for (const arg of args) {
    if (arg.k === "missing") continue;
    const value = evaluate(arg, ctx);
    const items: Scalar[] =
      value instanceof Ref
        ? [...ctx.engine.cellsIn(value)]
        : value instanceof Matrix
          ? value.data
          : [value];
    const direct = !(value instanceof Ref) && !(value instanceof Matrix);
    for (const item of items) {
      if (item instanceof XlError) throw item;
      if (typeof item === "boolean") out.push(item);
      else if (typeof item === "number") out.push(item !== 0);
      else if (typeof item === "string" && direct) {
        const truth = toBoolean(item);
        if (typeof truth === "boolean") out.push(truth);
      }
    }
  }
  return out;
}

export const LOGIC: Record<string, Fn> = {
  TRUE: () => true,
  FALSE: () => false,
  IF: (args, ctx) => {
    const condition = ctx.engine.operand(evaluate(args[0]!, ctx), ctx);
    if (condition instanceof Matrix) {
      const yes = branch(args, 1, ctx, true);
      const no = branch(args, 2, ctx, false);
      return ctx.engine.liftN([condition, yes, no], ctx, ([c, y, n]) => {
        if (c instanceof XlError) return c;
        const truth = toBoolean(c!);
        if (truth instanceof XlError) return truth;
        return (truth ? y : n) ?? 0;
      });
    }
    if (condition instanceof XlError) return condition;
    const truth = toBoolean(condition);
    if (truth instanceof XlError) return truth;
    return truth ? branch(args, 1, ctx, true) : branch(args, 2, ctx, false);
  },
  IFS: (args, ctx) =>
    pairwise(
      args,
      ctx,
      (i) => i % 2 === 0 && i + 1 < args.length,
      (items) => {
        for (let i = 0; i + 1 < items.length; i += 2) {
          const condition = items[i] ?? null;
          if (condition instanceof XlError) return condition;
          const truth = toBoolean(condition);
          if (truth instanceof XlError) return truth;
          if (truth) return i + 1;
        }
        return NA;
      },
    ),
  IFERROR: (args, ctx) => fallback(args, ctx, (value) => value instanceof XlError),
  IFNA: (args, ctx) => fallback(args, ctx, (value) => value === NA),
  AND: (args, ctx) => {
    const values = logicals(args, ctx);
    return values.length ? values.every(Boolean) : VALUE;
  },
  OR: (args, ctx) => {
    const values = logicals(args, ctx);
    return values.length ? values.some(Boolean) : VALUE;
  },
  XOR: (args, ctx) => {
    const values = logicals(args, ctx);
    return values.length ? values.filter(Boolean).length % 2 === 1 : VALUE;
  },
  NOT: scalar(([x]) => {
    if (x instanceof XlError) return x;
    const truth = toBoolean(x ?? null);
    return truth instanceof XlError ? truth : !truth;
  }),
  CHOOSE: (args, ctx) => {
    const index = ctx.engine.operand(evaluate(args[0]!, ctx), ctx);
    if (index instanceof Matrix) {
      const choices = args
        .slice(1)
        .map((arg) => (arg.k === "missing" ? 0 : ctx.engine.operand(evaluate(arg, ctx), ctx)));
      return ctx.engine.liftN([index, ...choices], ctx, ([i, ...picked]) => {
        if (i instanceof XlError) return i;
        const n = toNumber(i ?? null);
        if (n instanceof XlError) return n;
        const at = Math.trunc(n);
        if (at < 1 || at > picked.length) return VALUE;
        return picked[at - 1] ?? 0;
      });
    }
    if (index instanceof XlError) return index;
    const n = Math.trunc(num(index));
    if (n < 1 || n >= args.length) return VALUE;
    const arg = args[n]!;
    return arg.k === "missing" ? 0 : evaluate(arg, ctx);
  },
  SWITCH: (args, ctx) =>
    pairwise(
      args,
      ctx,
      (i) => i === 0 || (i % 2 === 1 && i + 1 < args.length),
      (items) => {
        const value = items[0] ?? null;
        if (value instanceof XlError) return value;
        let i = 1;
        for (; i + 1 < items.length; i += 2) {
          const candidate = items[i] ?? null;
          if (candidate instanceof XlError) return candidate;
          if (switchMatch(value, candidate)) return i + 1;
        }
        return i < items.length ? i : NA;
      },
    ),
  LET: (args, ctx) => {
    const locals = new Map(ctx.locals ?? []);
    let i = 0;
    for (; i + 1 < args.length; i += 2) {
      const name = args[i]!;
      if (name.k !== "name") return VALUE;
      locals.set(name.name.toLowerCase(), evaluate(args[i + 1]!, { ...ctx, locals }));
    }
    return evaluate(args[i]!, { ...ctx, locals });
  },
  // Information
  ISBLANK: elementwise((args, ctx) => {
    const value = evaluate(args[0]!, ctx);
    if (value instanceof Ref) return ctx.engine.lift1(value, ctx, (x) => x === null);
    return ctx.engine.lift1(value, ctx, () => false);
  }),
  ISERROR: scalar(([x]) => x instanceof XlError),
  ISERR: scalar(([x]) => x instanceof XlError && x !== NA),
  ISNA: scalar(([x]) => x === NA),
  ISNUMBER: scalar(([x]) => typeof x === "number"),
  ISTEXT: scalar(([x]) => typeof x === "string"),
  ISNONTEXT: scalar(([x]) => typeof x !== "string"),
  ISLOGICAL: scalar(([x]) => typeof x === "boolean"),
  ISEVEN: scalar(([x]) => Math.trunc(Math.abs(num(x ?? null))) % 2 === 0),
  ISODD: scalar(([x]) => Math.trunc(Math.abs(num(x ?? null))) % 2 === 1),
  ISREF: (args, ctx) => evaluate(args[0]!, ctx) instanceof Ref,
  ISFORMULA: (args, ctx) => {
    const value = evaluate(args[0]!, ctx);
    const area = value instanceof Ref ? value.single : null;
    if (!area) return VALUE;
    if (ctx.array && (area.r1 !== area.r2 || area.c1 !== area.c2)) {
      const data: Scalar[] = [];
      for (let r = area.r1; r <= area.r2; r++)
        for (let c = area.c1; c <= area.c2; c++) data.push(ctx.engine.hasFormula(area.sheet, r, c));
      return new Matrix(area.r2 - area.r1 + 1, area.c2 - area.c1 + 1, data);
    }
    return ctx.engine.hasFormula(area.sheet, area.r1, area.c1);
  },
  N: firstCell(
    scalar(([value]) => {
      if (value instanceof XlError) return value;
      if (typeof value === "number") return value;
      if (typeof value === "boolean") return value ? 1 : 0;
      return 0;
    }),
  ),
  T: firstCell(
    scalar(([value]) => {
      if (value instanceof XlError) return value;
      return typeof value === "string" ? value : "";
    }),
  ),
  NA: () => NA,
  TYPE: (args, ctx) => {
    const value = evaluate(args[0]!, ctx);
    if (value instanceof Lambda) return 128;
    if (value instanceof Matrix) return 64;
    if (
      value instanceof Ref &&
      !(value.single && value.single.r1 === value.single.r2 && value.single.c1 === value.single.c2)
    )
      return 64;
    const item = ctx.engine.toScalar(value, ctx);
    if (typeof item === "number" || item === null) return 1;
    if (typeof item === "string") return 2;
    if (typeof item === "boolean") return 4;
    return 16;
  },
  // Unlike the IS functions, ERROR.TYPE gives #N/A past its argument's end in an array formula's
  // range, so it is not applied cell by cell across the range (the wrapper is not elementwise).
  "ERROR.TYPE": (args, ctx) => errorType(args, ctx),
  SHEET: (args, ctx) => {
    if (!args.length) return ctx.sheet + 1;
    const value = evaluate(args[0]!, ctx);
    if (value instanceof Ref) return value.areas[0]!.sheet + 1;
    if (typeof value === "string") {
      const index = ctx.engine.sheetIndex(value);
      return index < 0 ? NA : index + 1;
    }
    return VALUE;
  },
  SHEETS: (args, ctx) => {
    if (!args.length) return ctx.engine.sheets.length;
    const value = evaluate(args[0]!, ctx);
    return value instanceof Ref ? new Set(value.areas.map((a) => a.sheet)).size : VALUE;
  },
};

/** A function that reads only the top-left cell of a reference it is given, even in array formulas. */
const errorType = scalar(([x]) => {
  if (!(x instanceof XlError)) return NA;
  const index = ERRORS.indexOf(x.code);
  return index < 7 ? index + 1 : index === 7 ? 8 : index + 1;
});

/**
 * IFS and SWITCH: `decide` reads the tests (`isTest`) and names the argument to return, or an
 * error. Only the chosen result is evaluated, unless a test is an array; then every argument is
 * taken element by element.
 */
function pairwise(
  args: Node[],
  ctx: Context,
  isTest: (index: number) => boolean,
  decide: (items: Array<Scalar | undefined>) => number | XlError,
): Value {
  const items: Array<Scalar | Matrix | undefined> = args.map((arg, i) =>
    isTest(i)
      ? arg.k === "missing"
        ? null
        : ctx.engine.operand(evaluate(arg, ctx), ctx)
      : undefined,
  );
  if (!items.some((item) => item instanceof Matrix)) {
    const chosen = decide(items as Array<Scalar | undefined>);
    return chosen instanceof XlError ? chosen : branch(args, chosen, ctx, 0);
  }
  const all = args.map((arg, i) =>
    isTest(i) ? items[i]! : arg.k === "missing" ? 0 : ctx.engine.operand(evaluate(arg, ctx), ctx),
  );
  return ctx.engine.liftN(all, ctx, (values) => {
    const chosen = decide(values);
    return chosen instanceof XlError ? chosen : (values[chosen] ?? 0);
  });
}

/** SWITCH compares like =, so an omitted or blank value equals 0, "" or FALSE. */
function switchMatch(value: Scalar, candidate: Scalar): boolean {
  const zero = (other: Scalar) =>
    typeof other === "string" ? "" : typeof other === "boolean" ? false : 0;
  const a = value ?? zero(candidate);
  const b = candidate ?? zero(value);
  return typeof a === typeof b && compare(a, b) === 0;
}

function firstCell(fn: Fn): Fn {
  return (args, ctx) => {
    if (!args[0]) return fn(args, ctx);
    const value = evaluate(args[0], ctx);
    if (!(value instanceof Ref)) return fn([{ k: "value", v: value }], ctx);
    const area = value.areas[0]!;
    return fn([{ k: "value", v: ctx.engine.cellValue(area.sheet, area.r1, area.c1) }], ctx);
  };
}

function fallback(args: Node[], ctx: Context, caught: (value: Scalar) => boolean): Value {
  const value = ctx.engine.operand(evaluate(args[0]!, ctx), ctx);
  if (value instanceof Matrix) {
    if (!value.data.some(caught))
      return new Matrix(
        value.rows,
        value.cols,
        value.data.map((item) => (item === null ? 0 : item)),
      );
    return ctx.engine.lift2(value, branch(args, 1, ctx, ""), ctx, (item, alternative) =>
      caught(item) ? (alternative ?? 0) : (item ?? 0),
    );
  }
  if (caught(value)) {
    const alternative = branch(args, 1, ctx, "");
    return alternative === null ? 0 : alternative;
  }
  return value === null ? 0 : value;
}

void isError;
