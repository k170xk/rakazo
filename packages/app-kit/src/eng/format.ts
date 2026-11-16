import { roundDecimal } from "../calc/functions/helpers.js";

/** Excel's ROUND: half away from zero on the 15-digit decimal Excel shows, so round(2.675, 2) is 2.68. */
export const round = (x: number, digits = 0) => roundDecimal(x, digits, "half");
/** Excel's ROUNDUP (away from zero). */
export const roundUp = (x: number, digits = 0) => roundDecimal(x, digits, "up");
/** Excel's ROUNDDOWN (towards zero). */
export const roundDown = (x: number, digits = 0) => roundDecimal(x, digits, "down");

/** The power of ten of the first significant digit, read from the decimal string (log10 misreads 1000 as 2.9999…). */
export function exponentOf(x: number): number {
  if (!Number.isFinite(x) || x === 0) return 0;
  return Number(Math.abs(x).toExponential(14).split("e")[1]);
}

/** x rounded to `sf` significant figures with Excel's ROUND. */
export function sigFig(x: number, sf = 4): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const rounded = round(x, sf - 1 - exponentOf(x));
  return round(rounded, sf - 1 - exponentOf(rounded));
}

export type NumberStyle = {
  /** Significant figures (default 4); trailing zeros after the point are dropped, as Excel's General does. */
  sf?: number;
  /** Fixed decimals instead of significant figures; zeros are kept (12.50). */
  dp?: number;
  /** Thousands separator, e.g. "," or a thin space. */
  group?: string;
  /** Beyond these powers of ten the number is written as m × 10ⁿ (defaults -4 and 9). */
  sciBelow?: number;
  sciAbove?: number;
};

const SUPERSCRIPT: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
export const superscript = (text: string) => [...text].map((char) => SUPERSCRIPT[char] ?? char).join("");

function groupDigits(text: string, separator: string) {
  if (!separator) return text;
  const [whole, fraction] = text.split(".") as [string, string | undefined];
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  if (digits.length < 5) return text;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  return `${sign}${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
}

/** Mantissa and power of ten for scientific display, the mantissa already rounded to `sf`. */
export function scientific(x: number, sf = 4): { mantissa: string; exponent: number } {
  const rounded = sigFig(x, sf);
  const exponent = exponentOf(rounded);
  const mantissa = round(rounded / 10 ** exponent, sf - 1);
  return { mantissa: trimZeros(mantissa.toFixed(Math.max(0, sf - 1))), exponent };
}

const trimZeros = (text: string) => (text.includes(".") ? text.replace(/\.?0+$/, "") : text);

/** Splits a value into the plain decimal text and an optional power of ten, by one set of rules. */
export function numberParts(x: number, style: NumberStyle = {}): { text: string; exponent?: number } {
  if (Number.isNaN(x)) return { text: "–" };
  if (!Number.isFinite(x)) return { text: x > 0 ? "∞" : "-∞" };
  const { dp, group = "" } = style;
  const sf = style.sf ?? 4;
  if (dp !== undefined) {
    const value = round(x, dp);
    return { text: groupDigits((Object.is(value, -0) ? 0 : value).toFixed(Math.max(0, dp)), group) };
  }
  if (x === 0) return { text: "0" };
  const rounded = sigFig(x, sf);
  const exponent = exponentOf(rounded);
  if (exponent < (style.sciBelow ?? -4) || exponent > (style.sciAbove ?? 9)) {
    const sci = scientific(x, sf);
    return { text: sci.mantissa, exponent: sci.exponent };
  }
  const decimals = Math.max(0, sf - 1 - exponent);
  return { text: groupDigits(trimZeros(rounded.toFixed(Math.min(decimals, 20))), group) };
}

/** A number as plain text: 4 significant figures by default, or fixed decimals; 1.2×10⁻⁶ outside the plain range. */
export function fmt(x: number, style: NumberStyle = {}): string {
  const { text, exponent } = numberParts(x, style);
  return exponent === undefined ? text : `${text}×10${superscript(String(exponent))}`;
}

/** Engineering notation: the power of ten a multiple of three (12.5×10³). */
export function engNotation(x: number, sf = 4): string {
  if (!Number.isFinite(x) || x === 0) return fmt(x, { sf });
  const rounded = sigFig(x, sf);
  const exponent = Math.floor(exponentOf(rounded) / 3) * 3;
  const mantissa = rounded / 10 ** exponent;
  const text = fmt(mantissa, { sf, sciAbove: 99, sciBelow: -99 });
  return exponent ? `${text}×10${superscript(String(exponent))}` : text;
}

const PREFIXES: Array<[number, string]> = [
  [12, "T"], [9, "G"], [6, "M"], [3, "k"], [0, ""], [-3, "m"], [-6, "µ"], [-9, "n"], [-12, "p"],
];

/** A value in base units with an SI prefix: siPrefix(12500, "W") is "12.5 kW". */
export function siPrefix(x: number, unit: string, sf = 4): string {
  if (!Number.isFinite(x) || x === 0) return `${fmt(x, { sf })} ${unit}`.trim();
  const exponent = exponentOf(sigFig(x, sf));
  const [power, prefix] = PREFIXES.find(([p]) => exponent >= p) ?? PREFIXES[PREFIXES.length - 1]!;
  return `${fmt(x / 10 ** power, { sf, sciAbove: 99, sciBelow: -99 })} ${prefix}${unit}`.trim();
}

export type CheckMode = "max" | "min";

export type CheckResult = {
  /** value / limit for a maximum, limit / value for a minimum; above 1 fails. */
  utilisation: number;
  pass: boolean;
  /** Utilisation rounded up to two decimals, so a failing check never reads 1.00. */
  shown: string;
};

/**
 * A design check. "max": the value must not exceed the limit (M_Ed ≤ M_Rd). "min": the value must
 * reach the limit (cover ≥ 25 mm). Pass or fail is decided on the unrounded numbers.
 */
export function check(value: number, limit: number, mode: CheckMode = "max"): CheckResult {
  const pass = mode === "max" ? value <= limit : value >= limit;
  const ratio = mode === "max" ? value / limit : limit / value;
  const utilisation = Number.isFinite(ratio) ? Math.abs(ratio) : pass ? 0 : Number.POSITIVE_INFINITY;
  let shown = Number.isFinite(utilisation) ? roundUp(utilisation, 2).toFixed(2) : "∞";
  if (!pass && shown === "1.00") shown = "1.01";
  return { utilisation, pass, shown };
}
