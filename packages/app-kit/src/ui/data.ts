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
