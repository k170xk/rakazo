import type { Context } from "../engine.js";
import { power as excelPower } from "../engine.js";
import type { Node } from "../parse.js";
import type { Scalar } from "../values.js";
import { DIV0, Matrix, NUM, Ref, toNumber, VALUE, XlError } from "../values.js";
import type { Fn } from "./helpers.js";
import { check, collectValue, evaluate, flat, num, numeric, scalar, single } from "./helpers.js";

/**
 * (1 + rate)^periods without first rounding 1 + rate, which is what Excel's results agree with:
 * a monthly rate's rounding error would otherwise grow with every period compounded.
 */
const growth = (rate: number, periods: number) => Math.exp(periods * Math.log1p(rate));

/** x^n the way FV, PV and EFFECT raise to a whole power: squaring from the lowest bit up. */
function power(x: number, n: number): number {
  if (!Number.isInteger(n)) return x ** n;
  let result = 1;
  let base = x;
  for (let e = Math.abs(n); e > 0; e = Math.floor(e / 2)) {
    if (e % 2) result *= base;
    base *= base;
  }
  return n < 0 ? 1 / result : result;
}

export function pmt(rate: number, nper: number, pv: number, fv = 0, type = 0): number {
  if (rate === 0) return -(pv + fv) / nper;
  const l = nper * Math.log1p(rate);
  const payment = (-(pv * Math.exp(l) + fv) * rate) / Math.expm1(l);
  return type ? payment / (1 + rate) : payment;
}

export function fv(rate: number, nper: number, payment: number, pv = 0, type = 0): number {
  if (rate === 0) return -(pv + payment * nper);
  const g = power(1 + rate, nper);
  return -(pv * g + (payment * (1 + rate * type) * (g - 1)) / rate);
}

function pv(rate: number, nper: number, payment: number, future = 0, type = 0): number {
  if (rate === 0) return -(future + payment * nper);
  const g = power(1 + rate, nper);
  return -(future + (payment * (1 + rate * type) * (g - 1)) / rate) / g;
}

/** The balance after some periods, as IPMT computes it. */
function balance(
  rate: number,
  periods: number,
  payment: number,
  present: number,
  type: number,
): number {
  const l = periods * Math.log1p(rate);
  return -(present * Math.exp(l) + (payment * (1 + rate * type) * Math.expm1(l)) / rate);
}

function ipmt(
  rate: number,
  period: number,
  nper: number,
  present: number,
  future = 0,
  type = 0,
): Scalar {
  if (period < 1 || period > nper) return NUM;
  if (rate === 0) return 0;
  if (period !== 1 && future === 0 && type === 0) {
    const l = Math.log1p(rate);
    return ((present * rate) / -Math.expm1(-nper * l)) * Math.expm1((period - 1 - nper) * l);
  }
  const payment = pmt(rate, nper, present, future, type);
  let interest: number;
  if (period === 1) interest = type === 1 ? 0 : -present;
  else
    interest =
      type === 1
        ? balance(rate, period - 2, payment, present, 1) - payment
        : balance(rate, period - 1, payment, present, 0);
  return interest * rate;
}

/** The principal part of one payment, in closed form so a tiny part is not lost to cancellation. */
function ppmt(
  rate: number,
  period: number,
  nper: number,
  present: number,
  future = 0,
  type = 0,
): Scalar {
  if (period < 1 || period > nper) return NUM;
  if (rate === 0 || (type === 1 && period === 1)) return pmt(rate, nper, present, future, type);
  const l = Math.log1p(rate);
  const principal =
    ((-(present + future) * rate) / -Math.expm1(-nper * l)) * Math.exp((period - 1 - nper) * l);
  return type ? principal / (1 + rate) : principal;
}

/** Newton's method run to full precision, so the root agrees with Excel's to its last digits. */
function solve(f: (x: number) => number, df: (x: number) => number, guess: number): number | null {
  let x = guess;
  for (let i = 0; i < 200; i++) {
    const y = f(x);
    const slope = df(x);
    if (!Number.isFinite(y) || !Number.isFinite(slope) || slope === 0) return null;
    const next = x - y / slope;
    if (!Number.isFinite(next) || next <= -1) return null;
    if (Math.abs(next - x) <= 1e-15 * Math.max(1, Math.abs(next))) return next;
    x = next;
  }
  return Math.abs(f(x)) < 1e-7 ? x : null;
}

/** A rate root by bisection of [0, 2^k] (or [-1, 0]), down to a width under 1e-8, for when Newton's method fails. */
function bisect(f: (x: number) => number): number | null {
  let lo = 0;
  let hi = 1;
  const f0 = f(0);
  if (f0 === 0) return 0;
  while (hi <= 2 ** 20 && Math.sign(f(hi)) === Math.sign(f0)) hi *= 2;
  if (hi > 2 ** 20) {
    lo = -1 + 2 ** -30;
    hi = 0;
    if (Math.sign(f(lo)) === Math.sign(f0)) return null;
  }
  let flo = f(lo);
  while (hi - lo >= 1e-8) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return lo;
}

function rootOf(f: (x: number) => number, df: (x: number) => number, guess: number): Scalar {
  const root = solve(f, df, guess);
  if (root !== null) return root;
  const near = bisect(f);
  return near === null ? NUM : (solve(f, df, near) ?? near);
}

/** NPV with the discount factor built up by repeated multiplication, as Excel does. */
function npv(rate: number, values: number[]): number {
  let total = 0;
  let factor = 1;
  for (const value of values) {
    factor *= 1 + rate;
    total += value / factor;
  }
  return total;
}

/** An element function whose thrown errors become that element's result. */
function guarded<T extends unknown[]>(fn: (...items: T) => Scalar): (...items: T) => Scalar {
  return (...items) => {
    try {
      return fn(...items);
    } catch (error) {
      if (error instanceof XlError) return error;
      throw error;
    }
  };
}

/** One argument evaluated so an array formula runs the function once per element. */
const operand = (args: Node[], index: number, ctx: Context) => {
  const arg = args[index];
  return !arg || arg.k === "missing" ? null : evaluate(arg, ctx);
};

/**
 * A function of numbers whose arguments are read left to right, so the first argument that is an
 * error or cannot be a number decides the result.
 */
function ordered(impl: (...values: number[]) => Scalar, optional: number[]): Fn {
  return scalar((items) => {
    const numbers = items.map((item, index) =>
      item === undefined ? (optional[index] ?? 0) : num(item),
    );
    for (let i = items.length; i < optional.length; i++) numbers.push(optional[i]!);
    return impl(...numbers);
  });
}

/** IRR's cash flows: numbers in the array, any error making the whole thing #VALUE!. */
function cashflows(args: Node[], ctx: Context, index: number): number[] {
  const out: number[] = [];
  for (const item of flat(evaluate(args[index]!, ctx), ctx)) {
    if (item instanceof XlError) throw VALUE;
    if (typeof item === "number") out.push(item);
  }
  return out;
}

/** An optional rate or guess argument: errors pass through, logicals are #VALUE!, text must read as a number. */
function guessArg(value: Scalar | undefined, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") throw VALUE;
  return check(toNumber(value));
}

/**
 * XNPV and XIRR's (value, date) pairs, checked dates first: a pair with text is skipped, a logical
 * is #VALUE!, and the two lists must be the same size.
 */
function schedule(
  args: Node[],
  ctx: Context,
  values: number,
  dates: number,
): { values: number[]; dates: number[] } {
  const v = flat(evaluate(args[values]!, ctx), ctx);
  const d = flat(evaluate(args[dates]!, ctx), ctx);
  for (const item of d) if (item instanceof XlError) throw item;
  for (const item of v) if (item instanceof XlError) throw item;
  if (v.length !== d.length) throw NUM;
  const out = { values: [] as number[], dates: [] as number[] };
  for (let i = 0; i < v.length; i++) {
    const value = v[i]!;
    const date = d[i]!;
    if (typeof value === "boolean" || typeof date === "boolean") throw VALUE;
    if (typeof value === "string" || typeof date === "string") continue;
    out.values.push(check(value ?? 0));
    out.dates.push(Math.floor(check(date ?? 0)));
  }
  return out;
}

function xnpv(rate: number, values: number[], dates: number[]): number {
  let total = 0;
  const daily = Math.log(1 + rate) / 365;
  for (let i = 0; i < values.length; i++)
    total += values[i]! * Math.exp(-(dates[i]! - dates[0]!) * daily);
  return total;
}

/**
 * XIRR's root: the guess (1e-5 for a zero guess) is moved away from 0 (doubled, or halved toward -1)
 * until it brackets a sign change with 0, then the bracket is halved until it is narrower than 2e-8
 * and XNPV at its midpoint is within 1e-8 of the cash flows' total size. A positive rate is only
 * sought when the flows at the earliest date, which decide the sign at high rates, differ in sign
 * from the total.
 */
function xirr(values: number[], dates: number[], guess: number): Scalar {
  const f = (rate: number) => xnpv(rate, values, dates);
  const f0 = f(0);
  if (f0 === 0) return 0;
  const side = (r: number) => Number.isFinite(f(r)) && Math.sign(f(r)) !== Math.sign(f0);
  let lo = 0;
  let hi = 0;
  if (guess >= 0) {
    const first = dates.reduce((a, b) => Math.min(a, b));
    const early = values.reduce((sum, value, i) => (dates[i] === first ? sum + value : sum), 0);
    if (Math.sign(early) === Math.sign(f0)) return NUM;
    hi = guess || 1e-5;
    for (let i = 0; i < 64 && !side(hi); i++) hi *= 2;
    if (!side(hi)) return NUM;
  } else {
    lo = guess;
    for (let i = 0; i < 64 && !side(lo); i++) lo = (lo - 1) / 2;
    if (!side(lo)) return NUM;
  }
  const scale = values.reduce((sum, value) => sum + Math.abs(value), 0);
  let flo = f(lo);
  for (;;) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (hi - lo < 2e-8 && Math.abs(fm) < 1e-8 * scale) return mid;
    if (mid === lo || mid === hi) return mid;
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
}

/** Excel's DDB for a period, which may be fractional. */
function ddb(cost: number, salvage: number, life: number, period: number, factor: number): number {
  let rate = factor / life;
  let previous: number;
  if (rate >= 1) {
    rate = 1;
    previous = period === 1 ? cost : 0;
  } else previous = cost * (1 - rate) ** (period - 1);
  const value = Math.min(previous * rate, previous - salvage);
  return value < 0 ? 0 : value;
}

export const FINANCE: Record<string, Fn> = {
  PMT: ordered(
    (rate, nper, present, future, type) =>
      nper === 0 ? NUM : pmt(rate, nper, present, future, type ? 1 : 0),
    [0, 0, 0, 0, 0],
  ),
  FV: ordered(
    (rate, nper, payment, present, type) => fv(rate, nper, payment, present, type ? 1 : 0),
    [0, 0, 0, 0, 0],
  ),
  PV: ordered(
    (rate, nper, payment, future, type) => pv(rate, nper, payment, future, type ? 1 : 0),
    [0, 0, 0, 0, 0],
  ),
  NPER: ordered(
    (rate, payment, present, future, type) => {
      const t = type ? 1 : 0;
      if (rate === 0) return payment === 0 ? NUM : -(present + future) / payment;
      const num_ = payment * (1 + rate * t) - future * rate;
      const den = payment * (1 + rate * t) + present * rate;
      if (num_ / den <= 0) return NUM;
      return Math.log(num_ / den) / Math.log(1 + rate);
    },
    [0, 0, 0, 0, 0],
  ),
  IPMT: ordered(
    (rate, period, nper, present, future, type) =>
      ipmt(rate, period, nper, present, future, type ? 1 : 0),
    [0, 0, 0, 0, 0, 0],
  ),
  PPMT: ordered(
    (rate, period, nper, present, future, type) =>
      ppmt(rate, period, nper, present, future, type ? 1 : 0),
    [0, 0, 0, 0, 0, 0],
  ),
  CUMIPMT: numeric((rate, nper, present, start, end, type) => {
    if (
      rate <= 0 ||
      nper <= 0 ||
      present <= 0 ||
      start < 1 ||
      end < start ||
      end > nper ||
      (type !== 0 && type !== 1)
    )
      return NUM;
    const payment = pmt(rate, nper, present, 0, type);
    let total = 0;
    for (let p = Math.trunc(start); p <= Math.trunc(end); p++)
      total += payment - (ppmt(rate, p, nper, present, 0, type) as number);
    return total;
  }),
  CUMPRINC: numeric((rate, nper, present, start, end, type) => {
    if (
      rate <= 0 ||
      nper <= 0 ||
      present <= 0 ||
      start < 1 ||
      end < start ||
      end > nper ||
      (type !== 0 && type !== 1)
    )
      return NUM;
    let total = 0;
    for (let p = Math.trunc(start); p <= Math.trunc(end); p++)
      total += ppmt(rate, p, nper, present, 0, type) as number;
    return total;
  }),
  RATE: (args, ctx) =>
    ctx.engine.liftN(
      [0, 1, 2, 3, 4, 5].map((i) => operand(args, i, ctx)),
      ctx,
      guarded((items: Scalar[]) => {
        const [nper, payment, present, future, type, guess] = items.map((item, i) =>
          item === null && i > 0 ? [0, 0, 0, 0, 0, 0.1][i]! : num(item!),
        );
        const t = type ? 1 : 0;
        const f = (r: number) => {
          if (Math.abs(r) < 1e-12) return present! + payment! * nper! + future!;
          const g = growth(r, nper!);
          return present! * g + (payment! * (1 + r * t) * (g - 1)) / r + future!;
        };
        const df = (r: number) => (f(r + 1e-7) - f(r - 1e-7)) / 2e-7;
        return solve(f, df, guess!) ?? NUM;
      }),
    ),
  NPV: (args, ctx) => {
    const values: number[] = [];
    for (const arg of args.slice(1)) {
      if (arg.k === "missing") continue;
      const value = evaluate(arg, ctx);
      if (value instanceof Ref || value instanceof Matrix) {
        // Periods follow the range row by row.
        for (const item of flat(value, ctx)) {
          if (item instanceof XlError) throw item;
          if (typeof item === "number") values.push(item);
        }
      } else collectValue(value, ctx, "plain", values);
    }
    return ctx.engine.lift1(
      operand(args, 0, ctx),
      ctx,
      guarded((item: Scalar) => {
        const rate = num(item);
        return rate === -1 ? DIV0 : npv(rate, values);
      }),
    );
  },
  IRR: (args, ctx) => {
    const values = cashflows(args, ctx, 0);
    return ctx.engine.lift1(
      operand(args, 1, ctx),
      ctx,
      guarded((item: Scalar) => {
        const guess = item === null ? 0.1 : num(item);
        if (!values.some((v) => v > 0) || !values.some((v) => v < 0)) return NUM;
        const f = (r: number) => values.reduce((t, v, i) => t + v / (1 + r) ** i, 0);
        const df = (r: number) => values.reduce((t, v, i) => t - (i * v) / (1 + r) ** (i + 1), 0);
        return rootOf(f, df, guess);
      }),
    );
  },
  XNPV: (args, ctx) => {
    const rate = guessArg(single(args, 0, ctx) ?? null, 0);
    if (rate <= 0) return NUM;
    const { values, dates } = schedule(args, ctx, 1, 2);
    return xnpv(rate, values, dates);
  },
  XIRR: (args, ctx) => {
    const guess = !args[2] || args[2].k === "missing" ? 0.1 : guessArg(single(args, 2, ctx), 0);
    const { values, dates } = schedule(args, ctx, 0, 1);
    if (!values.some((v) => v > 0) || !values.some((v) => v < 0)) return NUM;
    return xirr(values, dates, guess);
  },
  MIRR: (args, ctx) =>
    ctx.engine.lift2(
      operand(args, 1, ctx),
      operand(args, 2, ctx),
      ctx,
      guarded((a: Scalar, b: Scalar) => {
        const finance = num(a);
        const reinvest = num(b);
        const values: number[] = [];
        for (const item of flat(evaluate(args[0]!, ctx), ctx)) {
          if (item instanceof XlError) return item;
          if (typeof item === "number") values.push(item);
        }
        const n = values.length;
        const pvNeg = values.reduce((t, v, i) => (v < 0 ? t + v / (1 + finance) ** i : t), 0);
        const fvPos = values.reduce(
          (t, v, i) => (v > 0 ? t + v * (1 + reinvest) ** (n - 1 - i) : t),
          0,
        );
        if (pvNeg === 0 || fvPos === 0) return DIV0;
        return (-fvPos / pvNeg) ** (1 / (n - 1)) - 1;
      }),
    ),
  SLN: numeric((cost, salvage, life) => (life === 0 ? DIV0 : (cost - salvage) / life)),
  SYD: numeric((cost, salvage, life, period) => {
    if (life <= 0 || period <= 0 || period > life) return NUM;
    return ((cost - salvage) * (life - period + 1) * 2) / (life * (life + 1));
  }),
  DDB: numeric(
    (cost, salvage, life, period, factor) => {
      if (cost < 0 || salvage < 0 || life <= 0 || period <= 0 || period > life || factor <= 0)
        return NUM;
      return ddb(cost, salvage, life, period, factor);
    },
    [0, 0, 0, 0, 2],
  ),
  DB: numeric(
    (cost, salvage, life, periodArg, monthArg) => {
      const period = Math.trunc(periodArg);
      const month = Math.trunc(monthArg);
      if (
        cost < 0 ||
        salvage < 0 ||
        life <= 0 ||
        period <= 0 ||
        month < 1 ||
        month > 12 ||
        period > life + 1
      )
        return NUM;
      const rate = Math.round((1 - (salvage / cost) ** (1 / life)) * 1000) / 1000;
      let total = 0;
      let depreciation = (cost * rate * month) / 12;
      if (period === 1) return depreciation;
      total = depreciation;
      for (let p = 2; p <= period; p++) {
        depreciation =
          p === life + 1 ? ((cost - total) * rate * (12 - month)) / 12 : (cost - total) * rate;
        total += depreciation;
      }
      return depreciation;
    },
    [0, 0, 0, 0, 12],
  ),
  EFFECT: numeric((rate, periods) => {
    const n = Math.trunc(periods);
    if (rate <= 0 || n < 1) return NUM;
    return power(1 + rate / n, n) - 1;
  }),
  NOMINAL: numeric((rate, periods) => {
    const n = Math.trunc(periods);
    if (rate <= 0 || n < 1) return NUM;
    return n * ((1 + rate) ** (1 / n) - 1);
  }),
  PDURATION: numeric((rate, present, future) =>
    rate <= 0 || present <= 0 || future <= 0
      ? NUM
      : (Math.log(future) - Math.log(present)) / Math.log(1 + rate),
  ),
  RRI: numeric((n, present, future) => {
    if (n > 0 && present === 0 && future === 0) return 0;
    if (n <= 0 || present === 0 || future / present < 0) return NUM;
    const root = excelPower(future / present, 1 / n);
    return typeof root === "number" ? root - 1 : root;
  }),
};
