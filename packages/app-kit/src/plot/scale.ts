import { exponentOf, fmt } from "../eng/format.js";

/** Tick values are rebuilt from whole multiples of the step so they never drift (0.30000000000000004). */
const tidy = (x: number) => (x === 0 ? 0 : Number(x.toPrecision(12)));

/** A 1, 2, 2.5 or 5 × 10ⁿ step giving about `count` intervals over `span`. */
export function niceStep(span: number, count = 5): number {
  const raw = Math.abs(span) / Math.max(1, count);
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const magnitude = 10 ** exponentOf(raw);
  const normal = raw / magnitude;
  return tidy(
    (normal > 5 ? 10 : normal > 2.5 ? 5 : normal > 2 ? 2.5 : normal > 1 ? 2 : 1) * magnitude,
  );
}

/** Round tick values inside min..max, about `count` of them. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min > max) [min, max] = [max, min];
  if (min === max) return [tidy(min)];
  const step = niceStep(max - min, count);
  const first = Math.ceil(tidy(min / step));
  const last = Math.floor(tidy(max / step));
  const ticks: number[] = [];
  for (let k = first; k <= last && ticks.length < 1000; k++) ticks.push(tidy(k * step));
  return ticks;
}

/** min..max widened to whole steps, so the axis starts and ends on a tick. */
export function niceDomain(min: number, max: number, count = 5): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
    return niceDomain(min - pad, max + pad, count);
  }
  const step = niceStep(max - min, count);
  return [tidy(Math.floor(tidy(min / step)) * step), tidy(Math.ceil(tidy(max / step)) * step)];
}

/** Whole decades covering min..max (both positive). */
export function logDomain(min: number, max: number): [number, number] {
  const lo = min > 0 ? min : 1;
  const hi = max > 0 ? max : lo * 10;
  const a = 10 ** Math.floor(Math.log10(lo) + 1e-12);
  const b = 10 ** Math.ceil(Math.log10(hi) - 1e-12);
  return [tidy(a), tidy(b > a ? b : a * 10)];
}

/** Decade ticks (labelled) and 2–9 ticks between (grid only); short ranges label 2 and 5 too. */
export function logTicks(min: number, max: number): { major: number[]; minor: number[] } {
  if (!(min > 0) || !(max > min)) return { major: [], minor: [] };
  const major: number[] = [];
  const minor: number[] = [];
  const from = Math.floor(Math.log10(min) + 1e-12);
  const to = Math.ceil(Math.log10(max) - 1e-12);
  const few = to - from <= 2;
  for (let p = from; p <= to; p++) {
    for (let m = 1; m <= 9; m++) {
      const value = tidy(m * 10 ** p);
      if (value < min * (1 - 1e-12) || value > max * (1 + 1e-12)) continue;
      if (m === 1 || (few && (m === 2 || m === 5))) major.push(value);
      else minor.push(value);
    }
  }
  return { major, minor };
}

/** One label format for a whole axis: the same decimals on every tick, powers of ten when huge or tiny. */
export function tickFormat(ticks: readonly number[]): (value: number) => string {
  const largest = Math.max(0, ...ticks.map(Math.abs));
  const smallest = Math.min(...ticks.filter((t) => t !== 0).map(Math.abs));
  if (largest >= 1e6 || (largest > 0 && smallest < 1e-3)) {
    const exponents = ticks
      .filter((t) => t !== 0)
      .map((t) => Math.floor(Math.log10(Math.abs(t)) + 1e-9));
    const all = { sciAbove: Math.min(...exponents) - 1, sciBelow: Math.max(...exponents) + 1 };
    return (value) => fmt(value, { sf: 3, ...all });
  }
  const decimals = Math.min(
    6,
    Math.max(0, ...ticks.map((t) => (tidy(t).toString().split(".")[1] ?? "").length)),
  );
  return (value) => fmt(value, { dp: decimals });
}

export type ScaleType = "linear" | "log";

export type Scale = ((value: number) => number) & {
  type: ScaleType;
  domain: [number, number];
  range: [number, number];
  invert: (pixel: number) => number;
};

export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const scale = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as Scale;
  scale.type = "linear";
  scale.domain = domain;
  scale.range = range;
  scale.invert = (pixel) => d0 + ((pixel - r0) / (r1 - r0 || 1)) * span;
  return scale;
}

/** Log scale; zero and negative values map to NaN so lines break instead of plunging. */
export function logScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain.map((d) => Math.log10(d)) as [number, number];
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const scale = ((value: number) =>
    value > 0 ? r0 + ((Math.log10(value) - d0) / span) * (r1 - r0) : Number.NaN) as Scale;
  scale.type = "log";
  scale.domain = domain;
  scale.range = range;
  scale.invert = (pixel) => 10 ** (d0 + ((pixel - r0) / (r1 - r0 || 1)) * span);
  return scale;
}

/** Rounds pixel positions to 0.01 so the SVG text is short and the same on every run. */
export const px = (value: number) => Math.round(value * 100) / 100;
