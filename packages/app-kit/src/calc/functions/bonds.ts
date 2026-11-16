import type { Context } from "../engine.js";
import type { Node } from "../parse.js";
import { DIV0, dateFromSerial, NUM, serialFromDate, VALUE, XlError } from "../values.js";
import type { Fn } from "./helpers.js";
import { evaluate, flat, numeric } from "./helpers.js";

/** Bond, security and depreciation schedule functions. */

type Ymd = { y: number; m: number; d: number };

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** Days in a month of the real calendar, where February 1900 has 28 days. */
const monthDays = (y: number, m: number) =>
  m === 2 ? (isLeap(y) ? 29 : 28) : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;

function ymd(serial: number): Ymd {
  const { year, month, day } = dateFromSerial(serial);
  return { y: year, m: month, d: day };
}

const serialOf = (date: Ymd) => serialFromDate(date.y, date.m, date.d);

/** A date argument: truncated to a whole day, #NUM! outside Excel's calendar. */
function dateArg(value: number): number {
  const serial = Math.floor(value);
  if (serial < 0 || serial > 2958465) throw NUM;
  return serial;
}

function basisArg(value: number): number {
  const basis = Math.trunc(value);
  if (basis < 0 || basis > 4) throw NUM;
  return basis;
}

function frequencyArg(value: number): number {
  const frequency = Math.trunc(value);
  if (frequency !== 1 && frequency !== 2 && frequency !== 4) throw NUM;
  return frequency;
}

/** Days from a to b on the real calendar, so the Lotus 29 February 1900 is not counted. */
const actualDays = (a: number, b: number) => b - a - (a <= 60 && b > 60 ? 1 : 0);

/** 30/360 day count: US (NASD) for basis 0, European for basis 4. */
function days360(a: number, b: number, basis: number): number {
  const s = ymd(a);
  const e = ymd(b);
  let d1 = Math.min(s.d, 30);
  let d2 = e.d;
  if (basis === 4 || d1 === 30) d2 = Math.min(d2, 30);
  else if (s.m === 2 && s.d === monthDays(s.y, 2)) d1 = 30;
  return 360 * (e.y - s.y) + 30 * (e.m - s.m) + (d2 - d1);
}

/** Days between two dates under a basis; `exact` leaves out the Lotus leap day for actual counts. */
function dayCount(a: number, b: number, basis: number, exact = true): number {
  if (basis === 0 || basis === 4) return days360(a, b, basis);
  return exact ? actualDays(a, b) : b - a;
}

/** Days in a year under a basis; actual/actual averages the years the period touches. */
function yearDays(a: number, b: number, basis: number): number {
  if (basis === 3) return 365;
  if (basis !== 1) return 360;
  const y1 = ymd(a).y;
  const y2 = ymd(b).y;
  let leaps = 0;
  for (let y = y1; y <= y2; y++) if (isLeap(y)) leaps++;
  return 365 + leaps / (y2 - y1 + 1);
}

const yearFrac = (a: number, b: number, basis: number, exact = true) =>
  dayCount(a, b, basis, exact) / yearDays(a, b, basis);

/** A date moved by whole months, ending on the month's last day when `endOfMonth`. */
function addMonths(date: Ymd, months: number, endOfMonth: boolean): Ymd {
  const total = date.y * 12 + date.m - 1 + months;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  const last = monthDays(y, m);
  return { y, m, d: endOfMonth ? last : Math.min(date.d, last) };
}

/** A coupon date as a serial; dates before Excel's calendar starts read as day 0. */
function couponSerial(date: Ymd): number {
  if (date.y < 1900) return 0;
  return serialOf(date);
}

type Coupons = { pcd: number; ncd: number; count: number };

/**
 * The coupon dates either side of settlement, counted back from maturity in whole periods so a
 * maturity on the 31st or the last day of the month keeps its day.
 */
function coupons(settlement: number, maturity: number, frequency: number): Coupons {
  if (settlement >= maturity) throw NUM;
  const mat = ymd(maturity);
  const set = ymd(settlement);
  const endOfMonth = mat.d === monthDays(mat.y, mat.m);
  const step = 12 / frequency;
  const months = (mat.y - set.y) * 12 + mat.m - set.m;
  let k = Math.max(0, Math.floor(months / step) - 1);
  while (couponSerial(addMonths(mat, -(k + 1) * step, endOfMonth)) > settlement) k++;
  while (k > 0 && couponSerial(addMonths(mat, -k * step, endOfMonth)) <= settlement) k--;
  const pcd = couponSerial(addMonths(mat, -(k + 1) * step, endOfMonth));
  const ncd = couponSerial(addMonths(mat, -k * step, endOfMonth));
  return { pcd, ncd, count: k + 1 };
}

const coupDays = (c: Coupons, frequency: number, basis: number) =>
  basis === 1 ? actualDays(c.pcd, c.ncd) : (basis === 3 ? 365 : 360) / frequency;
const coupDayBs = (c: Coupons, settlement: number, basis: number) =>
  dayCount(c.pcd, settlement, basis);
const coupDaysNc = (c: Coupons, settlement: number, basis: number) =>
  dayCount(settlement, c.ncd, basis || 4, false);

/** A coupon function of (settlement, maturity, frequency, [basis]). */
function coupon(
  impl: (c: Coupons, settlement: number, frequency: number, basis: number) => number,
): Fn {
  return numeric(
    (settlement, maturity, frequency, basis) => {
      const s = dateArg(settlement);
      const m = dateArg(maturity);
      const f = frequencyArg(frequency);
      const b = basisArg(basis);
      return impl(coupons(s, m, f), s, f, b);
    },
    [0, 0, 0, 0],
  );
}

function price(
  settlement: number,
  maturity: number,
  rate: number,
  yld: number,
  redemption: number,
  frequency: number,
  basis: number,
): number {
  const c = coupons(settlement, maturity, frequency);
  const e = coupDays(c, frequency, basis);
  const dsc = coupDaysNc(c, settlement, basis);
  const a = coupDayBs(c, settlement, basis);
  const coupon = (100 * rate) / frequency;
  if (c.count === 1)
    return (coupon + redemption) / (1 + ((dsc / e) * yld) / frequency) - (coupon * a) / e;
  const base = 1 + yld / frequency;
  let result = redemption / base ** (c.count - 1 + dsc / e);
  for (let k = 1; k <= c.count; k++) result += coupon / base ** (k - 1 + dsc / e);
  return result - (coupon * a) / e;
}

function duration(
  settlement: number,
  maturity: number,
  rate: number,
  yld: number,
  frequency: number,
  basis: number,
): number {
  const c = coupons(settlement, maturity, frequency);
  const dsc = coupDaysNc(c, settlement, basis);
  const e = coupDays(c, frequency, basis);
  const base = 1 + yld / frequency;
  const first = Math.min(1, dsc / e);
  const flow = (rate * 100) / frequency;
  let total = 0;
  let weighted = 0;
  for (let k = 0; k < c.count; k++) {
    const t = first + k;
    const pv = (k === c.count - 1 ? flow + 100 : flow) / base ** t;
    total += pv;
    weighted += (t / frequency) * pv;
  }
  if (total === 0) throw DIV0;
  return weighted / total;
}

/** Newton's method from 0 with a numeric slope, the yield functions' solver. */
function solveYield(f: (y: number) => number): number {
  let x = 0;
  for (let i = 0; i < 100; i++) {
    const y = f(x);
    const h = Math.abs(x) > 1e-4 ? Math.abs(x) * 1e-7 : 1e-11;
    const slope = (f(x + h) - y) / h;
    if (!Number.isFinite(y) || !Number.isFinite(slope) || slope === 0) throw NUM;
    const next = x - y / slope;
    if (Math.abs(next - x) <= 1e-14 * Math.max(1, Math.abs(next))) return next;
    x = next;
  }
  throw NUM;
}

/** ODDFPRICE's price at a yield, with the odd first period split into quasi-coupon periods. */
function oddFirst(
  settlement: number,
  maturity: number,
  issue: number,
  first: number,
  rate: number,
  redemption: number,
  frequency: number,
  basis: number,
) {
  if (!(maturity > first && first > settlement && settlement > issue)) throw NUM;
  const sf = coupons(settlement, first, frequency);
  const e = coupDays(sf, frequency, basis);
  const dfc = dayCount(issue, first, basis);
  const coupon = (100 * rate) / frequency;
  if (dfc < e) {
    const n = coupons(settlement, maturity, frequency).count;
    const dsc = dayCount(settlement, first, basis);
    const a = dayCount(issue, settlement, basis);
    const y = dsc / e;
    return (yld: number) => {
      const x = 1 + yld / frequency;
      let result = redemption / x ** (n - 1 + y) + (coupon * dfc) / e / x ** y;
      for (let i = 1; i < n; i++) result += coupon / x ** (i + y);
      return result - (a / e) * coupon;
    };
  }
  // Quasi-coupon periods from the first coupon back past the issue date.
  const fi = coupons(issue, first, frequency);
  const fd = ymd(first);
  const endOfMonth = fd.d === monthDays(fd.y, fd.m);
  const step = 12 / frequency;
  let dcnl = 0;
  let anl = 0;
  for (let k = 0; k < fi.count; k++) {
    const end = couponSerial(addMonths(fd, -k * step, endOfMonth));
    const start = couponSerial(addMonths(fd, -(k + 1) * step, endOfMonth));
    const nl = basis === 1 ? dayCount(start, end, basis) : e;
    const dci = k < fi.count - 1 ? nl : Math.max(0, dayCount(issue, end, basis));
    const a = Math.max(0, dayCount(Math.max(issue, start), Math.min(settlement, end), basis));
    dcnl += dci / nl;
    anl += a / nl;
  }
  const dsc =
    basis === 2 || basis === 3
      ? dayCount(settlement, sf.ncd, basis)
      : e - dayCount(sf.pcd, settlement, basis);
  const nq = sf.count - 1;
  const n = coupons(first, maturity, frequency).count;
  const y = dsc / e;
  return (yld: number) => {
    const x = 1 + yld / frequency;
    let result = redemption / x ** (nq + n + y) + (coupon * dcnl) / x ** (nq + y);
    for (let i = nq + 1; i <= nq + n; i++) result += coupon / x ** (i + y);
    return result - anl * coupon;
  };
}

/** ODDLPRICE/ODDLYIELD's year fractions: last coupon to maturity, settlement to maturity, last coupon to settlement. */
function oddLast(settlement: number, maturity: number, last: number, basis: number) {
  if (settlement >= maturity || last >= settlement) throw NUM;
  return {
    dc: yearFrac(last, maturity, basis),
    dsc: yearFrac(settlement, maturity, basis),
    a: yearFrac(last, settlement, basis),
  };
}

/** TBILL functions' dates: maturity after settlement and within a year of it. */
function tbillDays(settlement: number, maturity: number): number {
  const s = dateArg(settlement);
  const m = dateArg(maturity);
  if (s >= m) throw NUM;
  const d = ymd(s);
  if (m > serialOf({ y: d.y + 1, m: d.m, d: d.d })) throw NUM;
  return actualDays(s, m);
}

function round(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/**
 * Depreciation to the end of a (possibly fractional) period: declining balance on the book value,
 * capped at salvage, switching to straight line over the remaining life once that gives more; only
 * the last period is prorated.
 */
function depreciated(
  cost: number,
  salvage: number,
  life: number,
  period: number,
  factor: number,
  straightLine: boolean,
): number {
  const whole = Math.floor(period);
  const fraction = period - whole;
  const declining = (total: number) =>
    Math.min((cost - total) * (factor / life), cost - total - salvage);
  const straight = (total: number, per: number) => (cost - total - salvage) / (life - per);
  const step = (total: number, per: number) => {
    const d = declining(total);
    if (!straightLine) return d;
    const s = straight(total, per);
    return d < s ? s : d;
  };
  let total = 0;
  for (let per = 0; ; per++) {
    const next = total + step(total, per);
    if (whole === 0) return next * fraction;
    if (per === whole - 1) {
      let last = step(next, per + 1);
      if (straightLine && whole === Math.floor(life) && declining(next) < straight(next, per + 1))
        last = 0;
      return next + last * fraction;
    }
    total = next;
  }
}

function accrint(
  issue: number,
  first: number,
  settlement: number,
  rate: number,
  par: number,
  frequency: number,
  basis: number,
  fromIssue: boolean,
): number {
  if (issue >= settlement) throw NUM;
  if (rate <= 0 || par <= 0) throw NUM;
  const fd = ymd(first);
  const endOfMonth = fd.d === monthDays(fd.y, fd.m);
  const step = 12 / frequency;
  const at = (k: number) => couponSerial(addMonths(fd, k * step, endOfMonth));
  // Coupon periods from before the start of accrual to past settlement.
  const from = fromIssue ? issue : Math.min(at(-1), settlement);
  let k = 0;
  while (at(k) > from) k--;
  const periods: Array<[number, number]> = [];
  for (let j = k; at(j) < settlement || j <= 0; j++) periods.push([at(j), at(j + 1)]);
  if (!fromIssue) {
    const c = coupons(issue, first, frequency);
    if (c.pcd < issue && issue < c.ncd) periods.unshift([c.pcd, c.ncd]);
  }
  let days = (basis === 3 ? 365 : 360) / frequency;
  let total = 0;
  for (const [start, end] of periods) {
    const s = Math.max(start, issue);
    const e = Math.min(end, settlement);
    if (e <= s) continue;
    if (basis === 1) days = dayCount(start, end, basis);
    total += dayCount(s, e, basis) / days;
  }
  return (total * par * rate) / frequency;
}

const amorCoefficient = (life: number) => (life <= 2 ? 0 : life <= 4 ? 1.5 : life <= 6 ? 2 : 2.5);

export const BONDS: Record<string, Fn> = {
  ACCRINT: numeric(
    (issue, first, settlement, rate, par, frequency, basis, method) =>
      accrint(
        dateArg(issue),
        dateArg(first),
        dateArg(settlement),
        rate,
        par,
        frequencyArg(frequency),
        basisArg(basis),
        method !== 0,
      ),
    [0, 0, 0, 0, 1000, 0, 0, 1],
  ),
  ACCRINTM: numeric(
    (issue, settlement, rate, par, basis) => {
      const i = dateArg(issue);
      const s = dateArg(settlement);
      const b = basisArg(basis);
      if (i >= s || rate <= 0 || par <= 0) return NUM;
      return par * rate * yearFrac(i, s, b);
    },
    [0, 0, 0, 1000, 0],
  ),
  AMORDEGRC: numeric(
    (cost, purchased, first, salvage, period, rate, basis) => {
      const p = dateArg(purchased);
      const f = dateArg(first);
      const b = basisArg(basis);
      const n = Math.trunc(period);
      if (!(cost > salvage && p <= f && salvage >= 0 && n >= 0 && rate > 0)) return NUM;
      const life = Math.ceil(1 / rate);
      if (n >= life) return 0;
      const coefficient = amorCoefficient(life);
      if (!coefficient) return NUM;
      const cap = cost - salvage;
      let depreciation = round(Math.min(yearFrac(p, f, b) * coefficient * cost * rate, cap));
      let sum = 0;
      for (let i = 3; i < n + 3; i++) {
        sum += depreciation;
        if (sum > cap) return 0;
        if (i < life) depreciation = coefficient * rate * (cost - sum);
        else if (i === life) depreciation = (cost - sum) / 2;
      }
      return round(depreciation);
    },
    [0, 0, 0, 0, 0, 0, 0],
  ),
  AMORLINC: numeric(
    (cost, purchased, first, salvage, period, rate, basis) => {
      const p = dateArg(purchased);
      const f = dateArg(first);
      const b = basisArg(basis);
      const n = Math.trunc(period);
      if (p > f || rate <= 0 || salvage > cost || cost <= 0 || salvage < 0 || n < 0) return NUM;
      const full = cost * rate;
      const firstRate = yearFrac(p, f, b) * rate * cost;
      const periods = Math.trunc((cost - salvage - firstRate) / full);
      let result = 0;
      if (n === 0) result = firstRate;
      else if (n <= periods) result = full;
      else if (n === periods + 1) result = cost - salvage - full * periods - firstRate;
      return result > 0 ? result : 0;
    },
    [0, 0, 0, 0, 0, 0, 0],
  ),
  COUPDAYBS: coupon((c, s, _f, b) => coupDayBs(c, s, b)),
  COUPDAYS: coupon((c, _s, f, b) => coupDays(c, f, b)),
  COUPDAYSNC: coupon((c, s, _f, b) => coupDaysNc(c, s, b)),
  COUPNCD: coupon((c) => c.ncd),
  COUPNUM: coupon((c) => c.count),
  COUPPCD: coupon((c) => c.pcd),
  DISC: numeric(
    (settlement, maturity, pr, redemption, basis) => {
      const s = dateArg(settlement);
      const m = dateArg(maturity);
      const b = basisArg(basis);
      if (s >= m || pr <= 0 || redemption <= 0) return NUM;
      return (redemption - pr) / redemption / yearFrac(s, m, b, false);
    },
    [0, 0, 0, 0, 0],
  ),
  DOLLARDE: numeric((dollar, fraction) => {
    const f = Math.trunc(fraction);
    if (f < 0) return NUM;
    if (f === 0) return DIV0;
    const whole = Math.trunc(dollar);
    return whole + ((dollar - whole) * 10 ** Math.ceil(Math.log10(f))) / f;
  }),
  DOLLARFR: numeric((dollar, fraction) => {
    const f = Math.trunc(fraction);
    if (f < 0) return NUM;
    if (f === 0) return DIV0;
    const whole = Math.trunc(dollar);
    return whole + (dollar - whole) * 10 ** -Math.ceil(Math.log10(f)) * f;
  }),
  DURATION: numeric(
    (settlement, maturity, rate, yld, frequency, basis) => {
      const s = dateArg(settlement);
      const m = dateArg(maturity);
      const f = frequencyArg(frequency);
      const b = basisArg(basis);
      if (rate < 0 || yld < 0) return NUM;
      return duration(s, m, rate, yld, f, b);
    },
    [0, 0, 0, 0, 0, 0],
  ),
  MDURATION: numeric(
    (settlement, maturity, rate, yld, frequency, basis) => {
      const s = dateArg(settlement);
      const m = dateArg(maturity);
      const f = frequencyArg(frequency);
      const b = basisArg(basis);
      if (rate < 0 || yld < 0) return NUM;
      return duration(s, m, rate, yld, f, b) / (1 + yld / f);
    },
    [0, 0, 0, 0, 0, 0],
  ),
  FVSCHEDULE: (args, ctx) => fvschedule(args, ctx),
  INTRATE: numeric(
    (settlement, maturity, investment, redemption, basis) => {
      const s = dateArg(settlement);
      const m = dateArg(maturity);
      const b = basisArg(basis);
      if (s >= m || investment <= 0 || redemption <= 0) return NUM;
      return (redemption - investment) / investment / yearFrac(s, m, b, false);
    },
    [0, 0, 0, 0, 0],
  ),
  ISPMT: numeric((rate, per, nper, pv) => (nper === 0 ? DIV0 : pv * rate * (per / nper - 1))),
  ODDFPRICE: numeric(
    (settlement, maturity, issue, first, rate, yld, redemption, frequency, basis) => {
      const f = frequencyArg(frequency);
      const b = basisArg(basis);
      if (rate < 0 || yld < 0 || redemption <= 0) return NUM;
      return oddFirst(
        dateArg(settlement),
        dateArg(maturity),
        dateArg(issue),
        dateArg(first),
        rate,
        redemption,
        f,
        b,
      )(yld);
    },
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
  ),
  ODDFYIELD: numeric(
    (settlement, maturity, issue, first, rate, pr, redemption, frequency, basis) => {
      const f = frequencyArg(frequency);
      const b = basisArg(basis);
      if (rate < 0 || pr <= 0 || redemption <= 0) return NUM;
      const priceAt = oddFirst(
        dateArg(settlement),
        dateArg(maturity),
        dateArg(issue),
        dateArg(first),
        rate,
        redemption,
        f,
        b,
      );
      return solveYield((y) => priceAt(y) - pr);
    },
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
  ),
  ODDLPRICE: numeric(
    (settlement, maturity, last, rate, yld, redemption, frequency, basis) => {
      frequencyArg(frequency);
      const b = basisArg(basis);
      if (rate < 0 || yld < 0 || redemption <= 0) return NUM;
      const { dc, dsc, a } = oddLast(dateArg(settlement), dateArg(maturity), dateArg(last), b);
      return (redemption + 100 * dc * rate) / (dsc * yld + 1) - 100 * a * rate;
    },
    [0, 0, 0, 0, 0, 0, 0, 0],
  ),
  ODDLYIELD: numeric(
    (settlement, maturity, last, rate, pr, redemption, frequency, basis) => {
      frequencyArg(frequency);
      const b = basisArg(basis);
      if (rate < 0 || pr <= 0 || redemption <= 0) return NUM;
      const { dc, dsc, a } = oddLast(dateArg(settlement), dateArg(maturity), dateArg(last), b);
      return ((redemption + 100 * dc * rate) / (pr + 100 * a * rate) - 1) / dsc;
    },
    [0, 0, 0, 0, 0, 0, 0, 0],
  ),
  PRICE: numeric(
    (settlement, maturity, rate, yld, redemption, frequency, basis) => {
      const s = dateArg(settlement);
      const m = dateArg(maturity);
      const f = frequencyArg(frequency);
      const b = basisArg(basis);
      if (rate < 0 || yld < 0 || redemption <= 0) return NUM;
      return price(s, m, rate, yld, redemption, f, b);
    },
    [0, 0, 0, 0, 0, 0, 0],
  ),
  PRICEDISC: numeric(
    (settlement, maturity, discount, redemption, basis) => {
      const s = dateArg(settlement);
      const m = dateArg(maturity);
      const b = basisArg(basis);
      if (s >= m || discount <= 0 || redemption <= 0) return NUM;
      return redemption * (1 - (discount * dayCount(s, m, b)) / yearDays(s, m, b));
    },
    [0, 0, 0, 0, 0],
  ),
  PRICEMAT: numeric(
    (settlement, maturity, issue, rate, yld, basis) => {
      const s = dateArg(settlement);
      const m = dateArg(maturity);
      const i = dateArg(issue);
      const b = basisArg(basis);
      if (s >= m || rate < 0 || yld < 0) return NUM;
      const dsm = dayCount(s, m, b);
      const year = yearDays(s, m, b);
      const dim = dayCount(i, m, b);
      const a = dayCount(i, s, b);
      return (100 + (dim / year) * rate * 100) / (1 + (dsm / year) * yld) - (a / year) * rate * 100;
    },
    [0, 0, 0, 0, 0, 0],
  ),
  RECEIVED: numeric(
    (settlement, maturity, investment, discount, basis) => {
      const s = dateArg(settlement);
      const m = dateArg(maturity);
      const b = basisArg(basis);
      if (s >= m || investment <= 0 || discount <= 0) return NUM;
      return investment / (1 - discount * yearFrac(s, m, b, false));
    },
    [0, 0, 0, 0, 0],
  ),
  TBILLEQ: numeric((settlement, maturity, discount) => {
    const days = tbillDays(settlement, maturity);
    if (!(discount > 0 && discount <= 1)) return NUM;
    let result: number;
    if (days <= 182) result = (365 * discount) / (360 - days * discount);
    else {
      const v = days / 365;
      const p = 100 * (1 - (discount * days) / 360);
      result = (Math.sqrt(v * v - (2 * v - 1) * (1 - 100 / p)) - v) / (v - 0.5);
    }
    return result < 0 || !Number.isFinite(result) ? NUM : result;
  }),
  TBILLPRICE: numeric((settlement, maturity, discount) => {
    const days = tbillDays(settlement, maturity);
    if (!(discount > 0 && discount <= 1)) return NUM;
    const result = 100 * (1 - (days * discount) / 360);
    return result < 0 ? NUM : result;
  }),
  TBILLYIELD: numeric((settlement, maturity, pr) => {
    const days = tbillDays(settlement, maturity);
    if (pr <= 0) return NUM;
    return ((100 - pr) / pr) * (360 / days);
  }),
  VDB: numeric(
    (cost, salvage, life, start, end, factor, noSwitch) => {
      if (
        start < 0 ||
        end < start ||
        end > life ||
        cost < 0 ||
        salvage < 0 ||
        salvage > cost ||
        life <= 0 ||
        factor <= 0
      )
        return NUM;
      return (
        depreciated(cost, salvage, life, end, factor, !noSwitch) -
        depreciated(cost, salvage, life, start, factor, !noSwitch)
      );
    },
    [0, 0, 0, 0, 0, 2, 0],
    [6],
  ),
  YIELD: numeric(
    (settlement, maturity, rate, pr, redemption, frequency, basis) => {
      const s = dateArg(settlement);
      const m = dateArg(maturity);
      const f = frequencyArg(frequency);
      const b = basisArg(basis);
      if (rate < 0 || pr <= 0 || redemption <= 0) return NUM;
      const c = coupons(s, m, f);
      if (c.count === 1) {
        const dsr = dayCount(s, m, b);
        const a = coupDayBs(c, s, b);
        const e = coupDays(c, f, b);
        const coupon = rate / f;
        const paid = pr / 100 + (a / e) * coupon;
        return ((redemption / 100 + coupon - paid) / paid) * ((f * e) / dsr);
      }
      return solveYield((y) => price(s, m, rate, y, redemption, f, b) - pr);
    },
    [0, 0, 0, 0, 0, 0, 0],
  ),
  YIELDDISC: numeric(
    (settlement, maturity, pr, redemption, basis) => {
      const s = dateArg(settlement);
      const m = dateArg(maturity);
      const b = basisArg(basis);
      if (s >= m || pr <= 0 || redemption <= 0) return NUM;
      return ((redemption / pr - 1) / dayCount(s, m, b)) * yearDays(s, m, b);
    },
    [0, 0, 0, 0, 0],
  ),
  YIELDMAT: numeric(
    (settlement, maturity, issue, rate, pr, basis) => {
      const s = dateArg(settlement);
      const m = dateArg(maturity);
      const i = dateArg(issue);
      const b = basisArg(basis);
      if (s >= m || rate < 0 || pr <= 0) return NUM;
      const im = yearFrac(i, m, b);
      const is = yearFrac(i, s, b);
      const sm = yearFrac(s, m, b);
      return (1 + rate * im - rate * is - pr / 100) / (pr / 100 + rate * is) / sm;
    },
    [0, 0, 0, 0, 0, 0],
  ),
};

/** FVSCHEDULE: blanks in the schedule are skipped, text and logicals are #VALUE!. */
function fvschedule(args: Node[], ctx: Context) {
  const schedule = flat(evaluate(args[1]!, ctx), ctx);
  return numeric((principal) => {
    let total = principal;
    for (const item of schedule) {
      if (item === null) continue;
      if (item instanceof XlError) return item;
      if (typeof item !== "number") return VALUE;
      total *= 1 + item;
    }
    return total;
  })([args[0]!], ctx);
}
