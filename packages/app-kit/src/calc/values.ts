/**
 * Excel's values and the rules it applies to them: errors, blanks, coercion between numbers, text
 * and logicals, comparison, and how a number becomes text. Every rule here is what Excel does, not
 * what JavaScript does, because a calculated app must give the workbook's answers to the digit.
 */

import type { Node } from "./parse.js";

export const ERRORS = [
  "#NULL!",
  "#DIV/0!",
  "#VALUE!",
  "#REF!",
  "#NAME?",
  "#NUM!",
  "#N/A",
  "#GETTING_DATA",
  "#SPILL!",
  "#CALC!",
] as const;
export type ErrorCode = (typeof ERRORS)[number];

export class XlError {
  private static readonly all = new Map<string, XlError>();
  private constructor(readonly code: ErrorCode) {}
  static of(code: ErrorCode): XlError {
    let error = XlError.all.get(code);
    if (!error) {
      error = new XlError(code);
      XlError.all.set(code, error);
    }
    return error;
  }
  toString() {
    return this.code;
  }
}

export const NULL = XlError.of("#NULL!");
export const DIV0 = XlError.of("#DIV/0!");
export const VALUE = XlError.of("#VALUE!");
export const REF = XlError.of("#REF!");
export const NAME = XlError.of("#NAME?");
export const NUM = XlError.of("#NUM!");
export const NA = XlError.of("#N/A");
export const SPILL = XlError.of("#SPILL!");
export const CALC = XlError.of("#CALC!");

/** `null` is an empty cell; it only ever comes from a reference. */
export type Scalar = number | string | boolean | XlError | null;

/** A rectangular array of values, row by row. */
export class Matrix {
  constructor(
    readonly rows: number,
    readonly cols: number,
    readonly data: Scalar[],
  ) {}
  static of(rows: Scalar[][]): Matrix {
    const cols = Math.max(0, ...rows.map((row) => row.length));
    const data: Scalar[] = [];
    for (const row of rows) for (let c = 0; c < cols; c++) data.push(c < row.length ? row[c]! : NA);
    return new Matrix(rows.length, cols, data);
  }
  static fill(rows: number, cols: number, value: Scalar): Matrix {
    return new Matrix(rows, cols, new Array<Scalar>(rows * cols).fill(value));
  }
  get(r: number, c: number): Scalar {
    return this.data[r * this.cols + c] ?? null;
  }
}

/** A rectangle of cells on one sheet, zero-based and inclusive. */
export type Area = { sheet: number; r1: number; c1: number; r2: number; c2: number };

/** A reference, kept as one until a function or operator needs its values. */
export class Ref {
  constructor(readonly areas: Area[]) {}
  get single(): Area | null {
    return this.areas.length === 1 ? this.areas[0]! : null;
  }
}

export type Value = Scalar | Matrix | Ref;

/**
 * A function value: a LAMBDA with the LET names it closed over, or a built-in passed by name
 * (_xleta.SUM). It is a 1×1 #CALC! array, which is what Excel shows when one ends up in a cell.
 */
export class Lambda extends Matrix {
  constructor(
    readonly params: string[],
    readonly body: Node | null,
    readonly locals: Map<string, Value> | undefined,
    readonly builtin?: string,
  ) {
    super(1, 1, [CALC]);
  }
}

export const isError = (value: unknown): value is XlError => value instanceof XlError;

/** Serial day numbers below this are 1900-system dates; Excel treats 1900 as a leap year. */
export const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------------------------
// Numbers

/**
 * A number rounded to 15 significant digits, the precision Excel shows, compares and converts to
 * text at. Built from the decimal string so rounding happens on decimal digits, not binary ones.
 */
export function round15(value: number): number {
  if (value === 0 || !Number.isFinite(value)) return value;
  return Number(value.toPrecision(15));
}

/**
 * Excel's equality for numbers in `=`, `<`, `>` and the rest: two numbers are equal when their
 * difference would be adjusted to zero (see `addAdjusted`), which is under 8 units in the last
 * place of the larger one. Lookups and sorting do not use this; they compare exactly.
 */
export function numbersEqual(a: number, b: number): boolean {
  return a === b || addAdjusted(a, -b) === 0;
}

/**
 * The adjustment Excel makes to an addition or subtraction whose result is lost in rounding error:
 * a result smaller than 8 units in the last place of the larger operand (its binary exponent is 50
 * or more below the operand's) is taken to be zero. `=0.3-0.2-0.1` is 0 in Excel; 8 units or more stay.
 */
export function addAdjusted(a: number, b: number): number {
  const result = a + b;
  if (result === 0 || !Number.isFinite(result)) return result;
  const big = Math.max(Math.abs(a), Math.abs(b));
  if (Math.abs(result) < 2 ** (exponentOf(big) - 49)) return 0;
  return result;
}

const FLOAT = new Float64Array(1);
const BITS = new Uint32Array(FLOAT.buffer);

/** The binary exponent of a positive number: the e in m·2^e with 1 ≤ m < 2. */
export function exponentOf(value: number): number {
  FLOAT[0] = value;
  const biased = (BITS[1]! >>> 20) & 0x7ff;
  return biased === 0 ? Math.floor(Math.log2(value)) : biased - 1023;
}

/** How Excel writes a number as text in General form: 15 significant digits, then E notation. */
export function numberToText(value: number): string {
  if (value === 0) return "0";
  if (!Number.isFinite(value)) return "#NUM!";
  const [mantissa, exp] = value.toExponential(14).split("e") as [string, string];
  const sign = mantissa.startsWith("-") ? "-" : "";
  const digits = mantissa.replace(/[-.]/g, "").replace(/0+$/, "") || "0";
  const exponent = Number(exp);
  if (exponent >= 15 || exponent < -9) {
    const head = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    return `${sign}${head}E${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`;
  }
  if (exponent < 0) return `${sign}0.${"0".repeat(-exponent - 1)}${digits}`;
  if (digits.length <= exponent + 1)
    return `${sign}${digits}${"0".repeat(exponent + 1 - digits.length)}`;
  return `${sign}${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}`;
}

// ---------------------------------------------------------------------------------------------
// Coercion

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Excel's 1900 date serial for a year, month and day, normalising overflowing months and days the
 * way DATE() does, on Excel's calendar, which gives February 1900 a 29th day (serial 60).
 */
export function serialFromDate(year: number, month: number, day: number): number {
  year += Math.floor((month - 1) / 12);
  month = ((((month - 1) % 12) + 12) % 12) + 1;
  const first = Date.UTC(year, month - 1, 1) / DAY_MS + 25569;
  const firstOfMonth = first < 61 ? first - 1 : first;
  return firstOfMonth + day - 1;
}

export function dateFromSerial(serial: number): { year: number; month: number; day: number } {
  const whole = Math.floor(serial);
  if (whole === 0) return { year: 1900, month: 1, day: 0 };
  if (whole === 60) return { year: 1900, month: 2, day: 29 };
  const adjusted = whole < 60 ? whole + 1 : whole;
  const date = new Date((adjusted - 25569) * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/**
 * Text as a number the way Excel reads typed text: plain and E notation, thousands separators,
 * a leading currency sign, a trailing percent, brackets for negatives, ISO and day-month-name dates
 * and times. Anything it cannot read is null and becomes #VALUE! where a number was needed.
 */
export function parseNumber(text: string): number | null {
  let s = text.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  let percent = 0;
  while (s.endsWith("%")) {
    percent++;
    s = s.slice(0, -1).trim();
  }
  if (/^[-+]/.test(s)) {
    if (s[0] === "-") negative = !negative;
    s = s.slice(1).trim();
  }
  s = s.replace(/^[$€£¥]\s*/, "");
  if (/^[-+]/.test(s)) {
    if (s[0] === "-") negative = !negative;
    s = s.slice(1).trim();
  }
  let value: number | null = null;
  if (/^(\d{1,3}(,\d{3})+|\d+)?(\.\d*)?([eE][-+]?\d+)?$/.test(s) && /\d/.test(s)) {
    value = Number(s.replace(/,/g, ""));
  } else {
    value = parseDateTime(s);
  }
  if (value === null || !Number.isFinite(value)) return null;
  value /= 100 ** percent;
  return negative ? -value : value;
}

function parseTime(text: string): number | null {
  const match = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?\s*(am|pm)?$/i.exec(text.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (match[4]) {
    if (hours > 12) return null;
    if (/pm/i.test(match[4]) && hours < 12) hours += 12;
    if (/am/i.test(match[4]) && hours === 12) hours = 0;
  }
  if (minutes > 59 || seconds >= 60) return null;
  return (hours * 3600 + minutes * 60 + seconds) / 86400;
}

function parseDateTime(text: string): number | null {
  const time = parseTime(text);
  if (time !== null) return time;
  const [datePart, ...rest] = text.split(/\s+(?=\d{1,2}:)/);
  const timePart = rest.length ? parseTime(rest.join(" ")) : 0;
  if (timePart === null) return null;
  const date = datePart!.trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]), timePart);
  const numeric = numericDate(date, timePart);
  if (numeric !== null) return numeric;
  match = /^(\d{1,2})[-\s/]([a-z]{3,9})[-\s/,]*(\d{2,4})?$/i.exec(date);
  if (match) {
    const month = MONTHS.indexOf(match[2]!.slice(0, 3).toLowerCase()) + 1;
    if (month < 1) return null;
    const year = match[3] ? expandYear(Number(match[3])) : new Date().getUTCFullYear();
    return validDate(year, month, Number(match[1]), timePart);
  }
  match = /^([a-z]{3,9})[-\s/]+(\d{1,2}),?[-\s/]+(\d{2,4})$/i.exec(date);
  if (match) {
    const month = MONTHS.indexOf(match[1]!.slice(0, 3).toLowerCase()) + 1;
    if (month < 1) return null;
    return validDate(expandYear(Number(match[3])), month, Number(match[2]), timePart);
  }
  return null;
}

/**
 * Day/month order for dates typed as text (3/4/2024). Excel takes it from the computer's regional
 * settings; a workbook's saved results show which one it was calculated with. Dates that can only
 * be read one way (29/02/1900) are read that way whichever order is set.
 */
let dateOrder: "mdy" | "dmy" = "mdy";
export function setDateOrder(order: "mdy" | "dmy") {
  dateOrder = order;
}

function numericDate(date: string, time: number): number | null {
  const match = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(date);
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[2]);
  const year = match[3] ? expandYear(Number(match[3])) : new Date().getUTCFullYear();
  let [month, day] = dateOrder === "mdy" ? [a, b] : [b, a];
  if (month > 12 && day <= 12) [month, day] = [day, month];
  return validDate(year, month, day, time);
}

function expandYear(year: number): number {
  if (year >= 100) return year;
  return year < 30 ? 2000 + year : 1900 + year;
}

function validDate(year: number, month: number, day: number, time: number): number | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Excel keeps Lotus 1-2-3's 29 February 1900.
  if (year === 1900 && month === 2 && day === 29) return 60 + time;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1) return null;
  const serial = serialFromDate(year, month, day);
  return serial < 0 ? null : serial + time;
}

/** A value as a number, or the error that stops it being one. Blank is 0, TRUE is 1. */
export function toNumber(value: Scalar): number | XlError {
  if (typeof value === "number") return value;
  if (value === null) return 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof XlError) return value;
  const parsed = parseNumber(value);
  return parsed === null ? VALUE : parsed;
}

/** A value as text: numbers in General form, logicals as TRUE/FALSE, blank as "". */
export function toText(value: Scalar): string | XlError {
  if (typeof value === "string") return value;
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof XlError) return value;
  return numberToText(value);
}

/** A value as a logical: numbers are TRUE unless 0, "TRUE"/"FALSE" text reads, other text fails. */
export function toBoolean(value: Scalar): boolean | XlError {
  if (typeof value === "boolean") return value;
  if (value === null) return false;
  if (typeof value === "number") return value !== 0;
  if (value instanceof XlError) return value;
  const upper = value.trim().toUpperCase();
  if (upper === "TRUE") return true;
  if (upper === "FALSE") return false;
  return VALUE;
}

// ---------------------------------------------------------------------------------------------
// Comparison

const typeRank = (value: Scalar) =>
  typeof value === "number"
    ? 0
    : typeof value === "string"
      ? 1
      : typeof value === "boolean"
        ? 2
        : 3;

/**
 * Excel's ordering of two values: numbers before text before logicals, text without regard to
 * case, blanks standing in as 0, "" or FALSE to match the other side. Returns -1, 0 or 1.
 * `exact` compares numbers bit for bit, as lookups and sorting do; the comparison operators
 * leave it off and treat numbers within rounding error of each other as equal.
 */
export function compare(a: Scalar, b: Scalar, exact = false): number {
  if (a === null && b === null) return 0;
  if (a === null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (typeof a === "number" && typeof b === "number") {
    if (exact ? a === b : numbersEqual(a, b)) return 0;
    return a < b ? -1 : 1;
  }
  if (typeof a === "string" && typeof b === "string") return compareText(a, b);
  if (typeof a === "boolean" && typeof b === "boolean") return a === b ? 0 : a ? 1 : -1;
  return 0;
}

/** `compare` with numbers compared exactly: the ordering lookups, matches and sorting use. */
export const compareExact = (a: Scalar, b: Scalar): number => compare(a, b, true);

export function compareText(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y ? 0 : x < y ? -1 : 1;
}

/** A value fit to store in a cell: no -0, and a result Excel cannot hold becomes #NUM!. */
export function settle(value: Scalar): Scalar {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return NUM;
    if (Object.is(value, -0)) return 0;
  }
  return value;
}
