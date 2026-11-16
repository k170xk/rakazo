import type { Context } from "../engine.js";
import type { Node } from "../parse.js";
import { CALL } from "../parse.js";
import type { Scalar, Value } from "../values.js";
import { CALC, Lambda, Matrix, NA, Ref, VALUE, XlError } from "../values.js";
import type { Fn } from "./helpers.js";
import { check, evaluate, single } from "./helpers.js";

/** The function value in an argument (a LAMBDA or an eta-reduced built-in), with how many arguments it takes. */
function lambdaArg(node: Node | undefined, ctx: Context, arity: number): Lambda {
  if (!node) throw VALUE;
  const fn = evaluate(node, ctx);
  if (fn instanceof XlError) throw fn;
  if (!(fn instanceof Lambda)) throw VALUE;
  if (!fn.builtin && fn.params.length !== arity) throw VALUE;
  return fn;
}

/** One result of a call that has to fill a single cell of the output. */
function cellResult(value: Value, ctx: Context): Scalar {
  if (value instanceof Ref) {
    const area = value.single;
    if (!area || area.r1 !== area.r2 || area.c1 !== area.c2) return CALC;
    return ctx.engine.toScalar(value, ctx) ?? 0;
  }
  if (value instanceof Matrix) return value.rows === 1 && value.cols === 1 ? value.get(0, 0) : CALC;
  return value === null ? 0 : value;
}

const call = (fn: Lambda, args: Value[], ctx: Context) => ctx.engine.applyLambda(fn, args, ctx);

export const LAMBDA_FNS: Record<string, Fn> = {
  [CALL]: (args, ctx) => {
    const fn = evaluate(args[0]!, ctx);
    if (fn instanceof XlError) return fn;
    if (!(fn instanceof Lambda)) return VALUE;
    return ctx.engine.applyLambda(
      fn,
      args.slice(1).map((arg) => (arg.k === "missing" ? undefined : evaluate(arg, ctx))),
      ctx,
    );
  },
  LAMBDA: (args, ctx) => {
    if (!args.length) return VALUE;
    const params: string[] = [];
    for (const arg of args.slice(0, -1)) {
      if (arg.k !== "name" || arg.sheet !== -1) return VALUE;
      const name = arg.name.toLowerCase();
      if (params.includes(name)) return VALUE;
      params.push(name);
    }
    return new Lambda(params, args[args.length - 1]!, ctx.locals);
  },
  ISOMITTED: (args, ctx) => {
    const arg = args[0];
    return (
      !!arg && arg.k === "name" && ctx.locals?.get(`\0omitted:${arg.name.toLowerCase()}`) === true
    );
  },
  MAP: (args, ctx) => {
    if (args.length < 2) return VALUE;
    const fn = lambdaArg(args[args.length - 1], ctx, args.length - 1);
    const arrays = args.slice(0, -1).map((arg) => ctx.engine.toMatrix(evaluate(arg, ctx), ctx));
    const rows = Math.max(...arrays.map((m) => m.rows));
    const cols = Math.max(...arrays.map((m) => m.cols));
    const data: Scalar[] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const items = arrays.map((m) => (r < m.rows && c < m.cols ? m.get(r, c) : NA));
        data.push(cellResult(call(fn, items, ctx), ctx));
      }
    return new Matrix(rows, cols, data);
  },
  REDUCE: (args, ctx) => {
    const fn = lambdaArg(args[2], ctx, 2);
    let acc: Value = args[0] && args[0].k !== "missing" ? evaluate(args[0], ctx) : 0;
    const array = ctx.engine.toMatrix(evaluate(args[1]!, ctx), ctx);
    for (const item of array.data) acc = call(fn, [acc, item], ctx);
    return acc;
  },
  SCAN: (args, ctx) => {
    const fn = lambdaArg(args[2], ctx, 2);
    let acc: Value = args[0] && args[0].k !== "missing" ? evaluate(args[0], ctx) : 0;
    const array = ctx.engine.toMatrix(evaluate(args[1]!, ctx), ctx);
    const data = array.data.map((item) => {
      acc = call(fn, [acc, item], ctx);
      return cellResult(acc, ctx);
    });
    return new Matrix(array.rows, array.cols, data);
  },
  BYROW: (args, ctx) => {
    const fn = lambdaArg(args[1], ctx, 1);
    const array = ctx.engine.toMatrix(evaluate(args[0]!, ctx), ctx);
    const data: Scalar[] = [];
    for (let r = 0; r < array.rows; r++)
      data.push(
        cellResult(
          call(
            fn,
            [new Matrix(1, array.cols, array.data.slice(r * array.cols, (r + 1) * array.cols))],
            ctx,
          ),
          ctx,
        ),
      );
    return new Matrix(array.rows, 1, data);
  },
  BYCOL: (args, ctx) => {
    const fn = lambdaArg(args[1], ctx, 1);
    const array = ctx.engine.toMatrix(evaluate(args[0]!, ctx), ctx);
    const data: Scalar[] = [];
    for (let c = 0; c < array.cols; c++) {
      const column: Scalar[] = [];
      for (let r = 0; r < array.rows; r++) column.push(array.get(r, c));
      data.push(cellResult(call(fn, [new Matrix(array.rows, 1, column)], ctx), ctx));
    }
    return new Matrix(1, array.cols, data);
  },
  MAKEARRAY: (args, ctx) => {
    const size = (i: number) => {
      const value = check(single(args, i, ctx) ?? null);
      if (typeof value === "boolean") return value ? 1 : 0;
      if (typeof value !== "number") throw VALUE;
      return Math.trunc(value);
    };
    const rows = size(0);
    const cols = size(1);
    const fn = lambdaArg(args[2], ctx, 2);
    if (rows < 1 || cols < 1 || rows * cols > 1048576 * 16384) return VALUE;
    const data: Scalar[] = [];
    for (let r = 1; r <= rows; r++)
      for (let c = 1; c <= cols; c++) data.push(cellResult(call(fn, [r, c], ctx), ctx));
    return new Matrix(rows, cols, data);
  },
};
