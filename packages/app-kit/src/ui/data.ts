type AnyRow = Record<string, unknown>;

const num = (value: unknown) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
};

/** Rows grouped by a field's value, in first-seen order. */
export function groupBy<T extends AnyRow>(rows: T[], key: string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const value =
      row[key] === null || row[key] === undefined || row[key] === "" ? "—" : String(row[key]);
    groups.set(value, [...(groups.get(value) ?? []), row]);
  }
  return groups;
}

/** The total of a field, or of a field per group as chart data ({label, value}). */
export function sumBy<T extends AnyRow>(rows: T[], field: string): number;
export function sumBy<T extends AnyRow>(
  rows: T[],
  field: string,
  by: string,
): Array<{ label: string; value: number }>;
export function sumBy<T extends AnyRow>(rows: T[], field: string, by?: string) {
  if (!by) return rows.reduce((sum, row) => sum + num(row[field]), 0);
  return [...groupBy(rows, by)].map(([label, items]) => ({
    label,
    value: Math.round(items.reduce((sum, row) => sum + num(row[field]), 0) * 100) / 100,
  }));
}

/** How many rows have each value of a field, as chart data, largest first. */
export function countBy<T extends AnyRow>(
  rows: T[],
  by: string,
): Array<{ label: string; value: number }> {
  return [...groupBy(rows, by)]
    .map(([label, items]) => ({ label, value: items.length }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Rows bucketed by the month of a date field: [{ month: "Jan 26", count, <field>: total }], in
 * date order, with empty months filled in.
 */
export function byMonth<T extends AnyRow>(
  rows: T[],
  dateKey: string,
  fields: string[] = [],
): Array<Record<string, number | string>> {
  const buckets = new Map<string, Record<string, number | string>>();
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const time = Date.parse(String(row[dateKey] ?? ""));
    if (Number.isNaN(time)) continue;
    const date = new Date(time);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    min = Math.min(min, new Date(date.getFullYear(), date.getMonth(), 1).getTime());
    max = Math.max(max, new Date(date.getFullYear(), date.getMonth(), 1).getTime());
    const bucket = buckets.get(key) ?? {
      count: 0,
      ...Object.fromEntries(fields.map((field) => [field, 0])),
    };
    bucket.count = Number(bucket.count) + 1;
    for (const field of fields)
      bucket[field] = Math.round((Number(bucket[field]) + num(row[field])) * 100) / 100;
    buckets.set(key, bucket);
  }
  if (!Number.isFinite(min)) return [];
  const out: Array<Record<string, number | string>> = [];
  for (
    let cursor = new Date(min);
    cursor.getTime() <= max && out.length < 120;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  ) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    out.push({
      month: cursor.toLocaleDateString("en-IE", { month: "short", year: "2-digit" }),
      key,
      ...(buckets.get(key) ?? {
        count: 0,
        ...Object.fromEntries(fields.map((field) => [field, 0])),
      }),
    });
  }
  return out;
}

export type Period = "7d" | "30d" | "90d" | "ytd" | "12m" | "all";

export const PERIODS: Record<Period, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "Quarter",
  ytd: "This year",
  "12m": "12 months",
  all: "All time",
};

const DAY = 86_400_000;

/** The [start, end) times of a period ending now, and of the same length just before it. */
export function periodRange(period: Period, now = Date.now()) {
  if (period === "all") return null;
  const start =
    period === "ytd"
      ? new Date(new Date(now).getFullYear(), 0, 1).getTime()
      : period === "12m"
        ? new Date(new Date(now).setFullYear(new Date(now).getFullYear() - 1)).getTime()
        : now - Number.parseInt(period, 10) * DAY;
  const length = now - start;
  return { start, end: now, previousStart: start - length, previousEnd: start };
}

/** The rows whose date falls in the period (all rows for "all"). */
export function inPeriod<T extends AnyRow>(
  rows: T[],
  dateKey: string,
  period: Period,
  now?: number,
): T[] {
  const range = periodRange(period, now);
  if (!range) return rows;
  return rows.filter((row) => {
    const time = Date.parse(String(row[dateKey] ?? ""));
    return time >= range.start && time < range.end + 1;
  });
}

/**
 * A figure for the period against the one before it, ready for KpiCard: rows counted, or
 * `field` summed. `delta` is the change in percent (12 = up 12%), null without a baseline.
 */
export function periodChange<T extends AnyRow>(
  rows: T[],
  dateKey: string,
  period: Period,
  field?: string,
  now?: number,
): { value: number; previous: number; delta: number | null } {
  const range = periodRange(period, now);
  const total = (items: T[]) =>
    field ? items.reduce((sum, row) => sum + num(row[field]), 0) : items.length;
  if (!range) return { value: total(rows), previous: 0, delta: null };
  let value = 0;
  let previous = 0;
  for (const row of rows) {
    const time = Date.parse(String(row[dateKey] ?? ""));
    if (Number.isNaN(time)) continue;
    const amount = field ? num(row[field]) : 1;
    if (time >= range.start && time <= range.end) value += amount;
    else if (time >= range.previousStart && time < range.previousEnd) previous += amount;
  }
  return {
    value,
    previous,
    delta: previous ? Math.round(((value - previous) / Math.abs(previous)) * 1000) / 10 : null,
  };
}

/** A JSON value kept in a longtext column (checklists, line items), or the fallback. */
export function readJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
