import type { Context } from "../engine.js";
import type { Node } from "../parse.js";
import type { Scalar, Value } from "../values.js";
import { DIV0, Matrix, NUM, Ref, VALUE, XlError } from "../values.js";
import type { Fn } from "./helpers.js";
import { evaluate, num, scalar, text } from "./helpers.js";

/** A complex number with the suffix its text used: "" for plain numbers, which fit either. */
type Complex = { re: number; im: number; suffix: "" | "i" | "j" };

const NUMBER = String.raw`(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const REAL = new RegExp(`^[-+]?${NUMBER}$`);
const IMAGINARY = new RegExp(`^([-+]?)(${NUMBER})?([ij])$`);
const BOTH = new RegExp(`^([-+]?${NUMBER})([-+])(${NUMBER})?([ij])$`);

/** Excel's complex text: a, bi, a+bi or a-bi, with i or j, and a bare i for 1. */
function parse(value: Scalar): Complex {
  if (value instanceof XlError) throw value;
  if (typeof value === "boolean") throw VALUE;
  if (value === null || value === "") return { re: 0, im: 0, suffix: "" };
  if (typeof value === "number") return { re: value, im: 0, suffix: "" };
  if (REAL.test(value)) return { re: Number(value), im: 0, suffix: "" };
  let match = IMAGINARY.exec(value);
  if (match) {
    const im = match[2] === undefined ? 1 : Number(match[2]);
    return { re: 0, im: match[1] === "-" ? -im : im, suffix: match[3] as "i" | "j" };
  }
  match = BOTH.exec(value);
  if (match) {
    const im = match[3] === undefined ? 1 : Number(match[3]);
    return { re: Number(match[1]), im: match[2] === "-" ? -im : im, suffix: match[4] as "i" | "j" };
  }
  throw NUM;
}

/** One part to 15 significant digits, in exponent form below 1e-5 or from 1e15. */
function part(value: number): string {
  if (value === 0) return "0";
  const [mantissa, exp] = value.toExponential(14).split("e") as [string, string];
  const sign = mantissa.startsWith("-") ? "-" : "";
  const digits = mantissa.replace(/[-.]/g, "").replace(/0+$/, "") || "0";
  const exponent = Number(exp);
  if (exponent >= 15 || exponent < -5) {
    const head = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    return `${sign}${head}E${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`;
  }
  if (exponent < 0) return `${sign}0.${"0".repeat(-exponent - 1)}${digits}`;
  if (digits.length <= exponent + 1)
    return `${sign}${digits}${"0".repeat(exponent + 1 - digits.length)}`;
  return `${sign}${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}`;
}

/** Excel's text for a complex number: zero parts left out, a unit imaginary part as a bare i. */
function format(re: number, im: number, suffix: string): Scalar {
  if (!Number.isFinite(re) || !Number.isFinite(im)) return NUM;
  const real = part(re);
  const imag = part(im);
  if (imag === "0") return real;
  const coefficient = imag === "1" ? "" : imag === "-1" ? "-" : imag;
  if (real === "0") return `${coefficient}${suffix || "i"}`;
  return `${real}${coefficient.startsWith("-") ? "" : "+"}${coefficient}${suffix || "i"}`;
}

const result = (z: { re: number; im: number }, suffix: string) => format(z.re, z.im, suffix);

/** One argument as a single value: a multi-cell range or array is #VALUE!, as in the Analysis ToolPak. */
function argument(args: Node[], index: number, ctx: Context): Scalar {
  const arg = args[index];
  if (!arg || arg.k === "missing") return null;
  return one(evaluate(arg, ctx), ctx);
}

function one(value: Value, ctx: Context): Scalar {
  if (value instanceof Ref) {
    const area = value.single;
    if (!area || area.r1 !== area.r2 || area.c1 !== area.c2) throw VALUE;
    return ctx.engine.toMatrix(value, ctx).get(0, 0);
  }
  if (value instanceof Matrix) {
    if (value.rows !== 1 || value.cols !== 1) throw VALUE;
    return value.get(0, 0);
  }
  return value;
}

function guarded(impl: (args: Node[], ctx: Context) => Scalar): Fn {
  return (args, ctx) => {
    try {
      return impl(args, ctx);
    } catch (error) {
      if (error instanceof XlError) return error;
      throw error;
    }
  };
}

/** A function of one complex number giving a number. */
const toNumber = (impl: (z: Complex) => number | XlError): Fn =>
  guarded((args, ctx) => impl(parse(argument(args, 0, ctx))));

/** A function of one complex number giving a complex number. */
const unary = (impl: (z: Complex) => { re: number; im: number } | XlError): Fn =>
  guarded((args, ctx) => {
    const z = parse(argument(args, 0, ctx));
    const out = impl(z);
    return out instanceof XlError ? out : result(out, z.suffix);
  });

/** The shared suffix of two numbers, or null when one uses i and the other j. */
function suffixOf(a: Complex, b: Complex): Complex["suffix"] | null {
  if (a.suffix && b.suffix && a.suffix !== b.suffix) return null;
  return a.suffix || b.suffix;
}

const binary = (impl: (a: Complex, b: Complex) => { re: number; im: number } | XlError): Fn =>
  guarded((args, ctx) => {
    const a = parse(argument(args, 0, ctx));
    const b = parse(argument(args, 1, ctx));
    const suffix = suffixOf(a, b);
    if (suffix === null) return NUM;
    const out = impl(a, b);
    return out instanceof XlError ? out : result(out, suffix);
  });

/** IMSUM and IMPRODUCT: every value of every argument, ranges included. */
const fold = (
  start: { re: number; im: number },
  step: (a: Complex, b: Complex) => { re: number; im: number },
): Fn =>
  guarded((args, ctx) => {
    let total: Complex = { ...start, suffix: "" };
    for (const arg of args) {
      if (arg.k === "missing") continue;
      const value = evaluate(arg, ctx);
      const items =
        value instanceof Ref || value instanceof Matrix
          ? ctx.engine.toMatrix(value, ctx).data
          : [value];
      for (const item of items) {
        const z = parse(item);
        const suffix = suffixOf(total, z);
        if (suffix === null) throw VALUE;
        total = { ...step(total, z), suffix };
      }
    }
    return result(total, total.suffix);
  });

const multiply = (a: Complex, b: Complex) => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});

function divide(
  a: { re: number; im: number },
  b: { re: number; im: number },
): { re: number; im: number } | XlError {
  const d = b.re * b.re + b.im * b.im;
  if (d === 0) return NUM;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

const sin = (z: Complex) => ({
  re: Math.sin(z.re) * Math.cosh(z.im),
  im: Math.cos(z.re) * Math.sinh(z.im),
});
const cos = (z: Complex) => ({
  re: Math.cos(z.re) * Math.cosh(z.im),
  im: -Math.sin(z.re) * Math.sinh(z.im),
});
const sinh = (z: Complex) => ({
  re: Math.sinh(z.re) * Math.cos(z.im),
  im: Math.cosh(z.re) * Math.sin(z.im),
});
const cosh = (z: Complex) => ({
  re: Math.cosh(z.re) * Math.cos(z.im),
  im: Math.sinh(z.re) * Math.sin(z.im),
});
const ONE = { re: 1, im: 0 };

function ln(z: Complex): { re: number; im: number } | XlError {
  if (z.re === 0 && z.im === 0) return NUM;
  return { re: Math.log(Math.hypot(z.re, z.im)), im: Math.atan2(z.im, z.re) };
}

const scaled = (z: { re: number; im: number } | XlError, factor: number) =>
  z instanceof XlError ? z : { re: z.re / factor, im: z.im / factor };

/** 1/f(z), #NUM! where f(z) is zero. */
const reciprocal = (f: (z: Complex) => { re: number; im: number }) => (z: Complex) =>
  divide(ONE, f(z));

/** Complex-number functions (IM*), on Excel's text form such as 3+4i. */
export const COMPLEX_FNS: Record<string, Fn> = {
  COMPLEX: scalar(([re, im, suffix]) => {
    const s = suffix === undefined || suffix === null ? "i" : text(suffix) || "i";
    if (s !== "i" && s !== "j") return VALUE;
    return format(num(re ?? null), num(im ?? null), s);
  }),
  IMREAL: toNumber((z) => z.re),
  IMAGINARY: toNumber((z) => z.im),
  IMABS: toNumber((z) => Math.hypot(z.re, z.im)),
  IMARGUMENT: toNumber((z) => (z.re === 0 && z.im === 0 ? DIV0 : Math.atan2(z.im, z.re))),
  IMCONJUGATE: unary((z) => ({ re: z.re, im: -z.im })),
  IMSUM: fold({ re: 0, im: 0 }, (a, b) => ({ re: a.re + b.re, im: a.im + b.im })),
  IMPRODUCT: fold(ONE, multiply),
  IMSUB: binary((a, b) => ({ re: a.re - b.re, im: a.im - b.im })),
  IMDIV: binary(divide),
  IMPOWER: guarded((args, ctx) => {
    const z = parse(argument(args, 0, ctx));
    const n = num(argument(args, 1, ctx));
    const r = Math.hypot(z.re, z.im);
    if (r === 0) return n > 0 ? "0" : NUM;
    const theta = Math.atan2(z.im, z.re);
    const rn = r ** n;
    return format(rn * Math.cos(n * theta), rn * Math.sin(n * theta), z.suffix);
  }),
  IMSQRT: unary((z) => {
    const r = Math.sqrt(Math.hypot(z.re, z.im));
    const theta = Math.atan2(z.im, z.re) / 2;
    return { re: r * Math.cos(theta), im: r * Math.sin(theta) };
  }),
  IMEXP: unary((z) => {
    const r = Math.exp(z.re);
    return { re: r * Math.cos(z.im), im: r * Math.sin(z.im) };
  }),
  IMLN: unary(ln),
  IMLOG10: unary((z) => scaled(ln(z), Math.LN10)),
  IMLOG2: unary((z) => scaled(ln(z), Math.LN2)),
  IMSIN: unary(sin),
  IMCOS: unary(cos),
  IMTAN: unary((z) => {
    const d = Math.cos(2 * z.re) + Math.cosh(2 * z.im);
    return { re: Math.sin(2 * z.re) / d, im: Math.sinh(2 * z.im) / d };
  }),
  IMCOT: unary((z) => {
    const d = Math.cosh(2 * z.im) - Math.cos(2 * z.re);
    if (d === 0) return NUM;
    return { re: Math.sin(2 * z.re) / d, im: -Math.sinh(2 * z.im) / d };
  }),
  IMSEC: unary(reciprocal(cos)),
  IMCSC: unary((z) => {
    const d = (Math.cosh(2 * z.im) - Math.cos(2 * z.re)) / 2;
    if (d === 0) return NUM;
    return {
      re: (Math.sin(z.re) * Math.cosh(z.im)) / d,
      im: (-Math.cos(z.re) * Math.sinh(z.im)) / d,
    };
  }),
  IMSINH: unary(sinh),
  IMCOSH: unary(cosh),
  IMSECH: unary(reciprocal(cosh)),
  IMCSCH: unary(reciprocal(sinh)),
};
