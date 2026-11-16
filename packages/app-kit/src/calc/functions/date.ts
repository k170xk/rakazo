import type { Context } from "../engine.js";
import type { Node } from "../parse.js";
import type { Scalar, Value } from "../values.js";
import {
  dateFromSerial,
  Matrix,
  NUM,
  parseNumber,
  serialFromDate,
  VALUE,
  XlError,
} from "../values.js";
import type { Fn } from "./helpers.js";
import {
  check,
  collect,
  evaluate,
  flat,
  int,
  num,
  numeric,
  scalar,
  single,
  text,
} from "./helpers.js";

const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const daysInMonth = (year: number, month: number) =>
  year === 1900 && month === 2 ? 29 : new Date(Date.UTC(year, month, 0)).getUTCDate();

function parts(serial: number) {
  if (serial < 0 || serial >= 2958466) throw NUM;
  return dateFromSerial(Math.floor(serial));
}

/** Weekday 0 (Sunday) … 6 of a serial, on Excel's calendar. */
const weekday0 = (serial: number) => (((Math.floor(serial) - 1) % 7) + 7) % 7;

function edate(serial: number, months: number, endOfMonth: boolean): number {
  const d = parts(serial);
  const total = d.year * 12 + (d.month - 1) + Math.trunc(months);
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  if (year < 1900 || year > 9999) throw NUM;
  const day = endOfMonth ? daysInMonth(year, month) : Math.min(d.day, daysInMonth(year, month));
  return serialFromDate(year, month, day);
}

function secondsOf(serial: number) {
  if (serial < 0) throw NUM;
  const fraction = serial - Math.floor(serial);
  return Math.round(fraction * 86400 + 1e-9) % 86400;
}

/** Days off for a weekend code (1–7, 11–17) or a "0000011" mask, Monday first. */
function weekendMask(value: Scalar | undefined): boolean[] {
  if (value === undefined || value === null) return [false, false, false, false, false, true, true];
  if (typeof value === "string") {
    if (!/^[01]{7}$/.test(value) || value === "1111111") throw VALUE;
    return [...value].map((ch) => ch === "1");
  }
  const code = Math.trunc(num(value));
  const pairs: Record<number, [number, number]> = {
    1: [5, 6],
    2: [6, 0],
    3: [0, 1],
    4: [1, 2],
    5: [2, 3],
    6: [3, 4],
    7: [4, 5],
  };
  const mask = [false, false, false, false, false, false, false];
  if (pairs[code]) {
    for (const i of pairs[code]) mask[i] = true;
    return mask;
  }
  if (code >= 11 && code <= 17) {
    mask[(code - 11 + 6) % 7] = true;
    return mask;
  }
  throw NUM;
}

/** Monday-first index into a weekend mask. */
const mondayIndex = (serial: number) => (weekday0(serial) + 6) % 7;

/**
 * Runs an .INTL day count for its weekend argument (the third): a blank cell is code 0 and TRUE is
 * code 1, an error becomes the function's own, and an array of weekends gives an array of results.
 */
function withWeekend(
  args: Node[],
  ctx: Context,
  errorAs: (error: XlError) => XlError,
  run: (weekend: boolean[], holidays: () => Set<number>) => Scalar,
): Value {
  let holidays: Set<number> | undefined;
  const lazyHolidays = () => {
    holidays ??= holidaySet(args, 3, ctx);
    return holidays;
  };
  const arg = args[2];
  if (!arg || arg.k === "missing") return run(weekendMask(undefined), lazyHolidays);
  const one = (x: Scalar): Scalar => {
    if (x instanceof XlError) return errorAs(x);
    try {
      return run(
        weekendMask(x === null ? 0 : typeof x === "boolean" ? Number(x) : x),
        lazyHolidays,
      );
    } catch (error) {
      if (error instanceof XlError) return error;
      throw error;
    }
  };
  const value = ctx.engine.operand(evaluate(arg, ctx), ctx);
  return value instanceof Matrix ? ctx.engine.lift1(value, ctx, one) : one(value);
}

function holidaySet(args: Node[], index: number, ctx: Context): Set<number> {
  const arg = args[index];
  if (!arg || arg.k === "missing") return new Set();
  const out = new Set<number>();
  for (const item of flat(evaluate(arg, ctx), ctx)) {
    if (item instanceof XlError) throw item;
    if (typeof item === "number") out.add(Math.floor(item));
    else if (typeof item === "string") {
      const parsed = parseNumber(item);
      if (parsed === null) throw VALUE;
      out.add(Math.floor(parsed));
    }
  }
  return out;
}

function networkDays(
  start: number,
  end: number,
  weekend: boolean[],
  holidays: Set<number>,
): number {
  const sign = end >= start ? 1 : -1;
  let count = 0;
  for (
    let d = Math.floor(start);
    sign > 0 ? d <= Math.floor(end) : d >= Math.floor(end);
    d += sign
  ) {
    if (!weekend[mondayIndex(d)] && !holidays.has(d)) count++;
  }
  return count * sign;
}

function workday(start: number, days: number, weekend: boolean[], holidays: Set<number>): number {
  let d = Math.floor(start);
  let left = Math.trunc(days);
  const step = left >= 0 ? 1 : -1;
  while (left !== 0) {
    d += step;
    if (!weekend[mondayIndex(d)] && !holidays.has(d)) left -= step;
  }
  return d;
}

function yearfrac(start: number, end: number, basis: number): number {
  if (start > end) [start, end] = [end, start];
  const a = parts(start);
  const b = parts(end);
  let sd = a.day;
  let ed = b.day;
  const sm = a.month;
  const em = b.month;
  const sy = a.year;
  const ey = b.year;
  switch (basis) {
    case 0: {
      const lastFeb = (y: number, m: number, d: number) => m === 2 && d === daysInMonth(y, 2);
      if (lastFeb(sy, sm, sd) && lastFeb(ey, em, ed)) ed = 30;
      if (lastFeb(sy, sm, sd)) sd = 30;
      if (ed === 31 && sd >= 30) ed = 30;
      if (sd === 31) sd = 30;
      return (ed + em * 30 + ey * 360 - (sd + sm * 30 + sy * 360)) / 360;
    }
    case 1: {
      const days = Math.floor(end) - Math.floor(start);
      const withinYear = sy === ey || (sy + 1 === ey && (sm > em || (sm === em && sd >= ed)));
      if (withinYear) {
        let length = 365;
        if (sy === ey && isLeap(sy)) length = 366;
        else if (feb29Between(sy, sm, sd, ey, em, ed) || (em === 2 && ed === 29)) length = 366;
        return days / length;
      }
      const years = ey - sy + 1;
      const total = (Date.UTC(ey + 1, 0, 1) - Date.UTC(sy, 0, 1)) / 86_400_000;
      return days / (total / years);
    }
    case 2:
      return (Math.floor(end) - Math.floor(start)) / 360;
    case 3:
      return (Math.floor(end) - Math.floor(start)) / 365;
    case 4:
      if (sd === 31) sd = 30;
      if (ed === 31) ed = 30;
      return (ed + em * 30 + ey * 360 - (sd + sm * 30 + sy * 360)) / 360;
  }
  throw NUM;
}

function feb29Between(
  sy: number,
  sm: number,
  sd: number,
  ey: number,
  em: number,
  ed: number,
): boolean {
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  for (let y = sy; y <= ey; y++) {
    if (!isLeap(y)) continue;
    const feb29 = Date.UTC(y, 1, 29);
    if (feb29 >= start && feb29 <= end) return true;
  }
  return false;
}

function datevalue(value: Scalar): number {
  if (typeof value === "number") return value;
  const parsed = parseNumber(text(value ?? ""));
  if (parsed === null) throw VALUE;
  return parsed;
}

export const DATE_FNS: Record<string, Fn> = {
  TODAY: (_args, ctx) => Math.floor(ctx.engine.now),
  NOW: (_args, ctx) => ctx.engine.now,
  DATE: numeric((y, m, d) => {
    let year = Math.trunc(y);
    if (year < 0 || year >= 10000) return NUM;
    if (year < 1900) year += 1900;
    const serial = serialFromDate(year, Math.trunc(m), Math.trunc(d));
    if (serial < 0 || serial > 2958465) return NUM;
    return serial;
  }),
  TIME: numeric((h, m, s) => {
    const total = Math.trunc(h) * 3600 + Math.trunc(m) * 60 + Math.trunc(s);
    if (total < 0) return NUM;
    // Excel keeps the fraction of the day count, not of the seconds, so long times lose digits.
    const days = total / 86400;
    return days - Math.floor(days);
  }),
  YEAR: numeric((x) => parts(x).year),
  MONTH: numeric((x) => parts(x).month),
  DAY: numeric((x) => parts(x).day),
  HOUR: numeric((x) => Math.floor(secondsOf(x) / 3600)),
  MINUTE: numeric((x) => Math.floor((secondsOf(x) % 3600) / 60)),
  SECOND: numeric((x) => secondsOf(x) % 60),
  WEEKDAY: numeric(
    (x, type) => {
      if (x < 0) return NUM;
      const d = weekday0(x);
      switch (Math.trunc(type)) {
        case 1:
        case 17:
          return d + 1;
        case 2:
        case 11:
          return ((d + 6) % 7) + 1;
        case 3:
          return (d + 6) % 7;
        case 12:
          return ((d + 5) % 7) + 1;
        case 13:
          return ((d + 4) % 7) + 1;
        case 14:
          return ((d + 3) % 7) + 1;
        case 15:
          return ((d + 2) % 7) + 1;
        case 16:
          return ((d + 1) % 7) + 1;
      }
      return NUM;
    },
    [0, 1],
  ),
  WEEKNUM: numeric(
    (x, type) => {
      if (x < 0) return NUM;
      const t = Math.trunc(type);
      if (t === 21) return isoWeek(x);
      const starts: Record<number, number> = {
        1: 0,
        2: 1,
        11: 1,
        12: 2,
        13: 3,
        14: 4,
        15: 5,
        16: 6,
        17: 0,
      };
      const start = starts[t];
      if (start === undefined) return NUM;
      const year = parts(x).year;
      const jan1 = serialFromDate(year, 1, 1);
      const offset = (weekday0(jan1) - start + 7) % 7;
      return Math.floor((Math.floor(x) - jan1 + offset) / 7) + 1;
    },
    [0, 1],
  ),
  ISOWEEKNUM: numeric((x) => (x < 0 ? NUM : isoWeek(x))),
  EDATE: numeric((x, months) => edate(x, months, false)),
  EOMONTH: numeric((x, months) => edate(x, months, true)),
  DAYS: numeric((end, start) =>
    [end, start].some((d) => d < 0 || d > 2958465) ? NUM : Math.floor(end) - Math.floor(start),
  ),
  DAYS360: numeric(
    (start, end, method) => {
      if ([start, end].some((d) => d < 0 || d > 2958465)) return NUM;
      const a = parts(start);
      const b = parts(end);
      let sd = a.day;
      let ed = b.day;
      let em = b.month;
      let ey = b.year;
      if (method) {
        if (sd === 31) sd = 30;
        if (ed === 31) ed = 30;
      } else {
        if (sd === daysInMonth(a.year, a.month)) sd = 30;
        if (ed === daysInMonth(b.year, b.month)) {
          if (sd < 30) {
            ed = 1;
            em += 1;
            if (em > 12) {
              em = 1;
              ey += 1;
            }
          } else ed = 30;
        }
      }
      return (ey - a.year) * 360 + (em - a.month) * 30 + (ed - sd);
    },
    [0, 0, 0],
  ),
  DATEDIF: scalar((items) => {
    const start = Math.floor(num(items[0] ?? null));
    const end = Math.floor(num(items[1] ?? null));
    const unit = text(items[2] ?? "").toUpperCase();
    if (start > end) return NUM;
    const a = parts(start);
    const b = parts(end);
    let months = (b.year - a.year) * 12 + (b.month - a.month);
    if (b.day < a.day) months--;
    switch (unit) {
      case "Y":
        return Math.floor(months / 12);
      case "M":
        return months;
      case "D":
        return end - start;
      case "MD": {
        if (b.day >= a.day) return b.day - a.day;
        const prevMonth = b.month === 1 ? 12 : b.month - 1;
        const prevYear = b.month === 1 ? b.year - 1 : b.year;
        return daysInMonth(prevYear, prevMonth) - a.day + b.day;
      }
      case "YM":
        return ((months % 12) + 12) % 12;
      case "YD": {
        // Excel moves the end date into the start's year (1988-06-22 to 2012-05-11 is 323).
        const before = b.month < a.month || (b.month === a.month && b.day < a.day);
        return serialFromDate(a.year + (before ? 1 : 0), b.month, b.day) - start;
      }
    }
    return NUM;
  }),
  YEARFRAC: scalar((items) => {
    const basis = items[2] === undefined || items[2] === null ? 0 : Math.trunc(num(items[2]));
    if (basis < 0 || basis > 4) return NUM;
    return yearfrac(num(items[0] ?? null), num(items[1] ?? null), basis);
  }),
  NETWORKDAYS: (args, ctx) => {
    const start = num(check(single(args, 0, ctx) ?? null));
    const end = num(check(single(args, 1, ctx) ?? null));
    return networkDays(start, end, weekendMask(undefined), holidaySet(args, 2, ctx));
  },
  "NETWORKDAYS.INTL": (args, ctx) => {
    const start = num(check(single(args, 0, ctx) ?? null));
    const end = num(check(single(args, 1, ctx) ?? null));
    return withWeekend(
      args,
      ctx,
      () => VALUE,
      (weekend, holidays) => networkDays(start, end, weekend, holidays()),
    );
  },
  WORKDAY: (args, ctx) => {
    const start = num(check(single(args, 0, ctx) ?? null));
    const days = num(check(single(args, 1, ctx) ?? null));
    return workday(start, days, weekendMask(undefined), holidaySet(args, 2, ctx));
  },
  "WORKDAY.INTL": (args, ctx) => {
    const start = num(check(single(args, 0, ctx) ?? null));
    const days = num(check(single(args, 1, ctx) ?? null));
    return withWeekend(
      args,
      ctx,
      () => NUM,
      (weekend, holidays) => workday(start, days, weekend, holidays()),
    );
  },
  DATEVALUE: scalar(([x]) => {
    if (x instanceof XlError) return x;
    if (typeof x !== "string") return VALUE;
    return Math.floor(datevalue(x));
  }),
  TIMEVALUE: scalar(([x]) => {
    if (x instanceof XlError) return x;
    if (typeof x !== "string") return VALUE;
    const value = datevalue(x);
    return value - Math.floor(value);
  }),
};

function isoWeek(serial: number): number {
  const d = Math.floor(serial);
  const thursday = d - ((weekday0(d) + 6) % 7) + 3;
  // The first days of 1900 fall in the last ISO week of 1899, whose 1 January is serial -364.
  const jan1 = thursday < 1 ? -364 : serialFromDate(parts(thursday).year, 1, 1);
  return Math.floor((thursday - jan1) / 7) + 1;
}

void collect;
void int;
