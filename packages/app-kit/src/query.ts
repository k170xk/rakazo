import type { Column, Row, TableSchema } from "./schema.js";

/**
 * Searching, filtering, sorting, paging and summing a table's rows. One implementation serves
 * both sides: the server runs it over a large table it keeps in memory, and a preview runs it
 * over its sample rows, so an app sees the same answer either way.
 */

export type FilterOp =
  | "eq"
  | "ne"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "contains"
  | "in"
  | "empty"
  | "filled";

export type RowFilter = { column: string; op: FilterOp; value?: unknown };
export type RowSort = { column: string; dir?: "asc" | "desc" };

export type RowQuery = {
  /** Words that must all appear (in any order) in the row's text columns. */
  search?: string;
  filters?: RowFilter[];
  sort?: RowSort | RowSort[];
  /** 0-based. */
  page?: number;
  pageSize?: number;
};

export type MetricOp = "count" | "sum" | "avg" | "min" | "max";
export type Metric = { op: MetricOp; column?: string; as?: string };

export type AggregateQuery = {
  search?: string;
  filters?: RowFilter[];
  /** A column to group by; dates group by bucket. Without it there is one group, "all". */
  groupBy?: string;
  bucket?: "day" | "week" | "month" | "year";
  metrics?: Metric[];
  /** Most groups returned, largest count first (dates oldest first). */
  limit?: number;
};

export type QueryResult = { rows: Row[]; total: number };
export type AggregateGroup = { key: string | null; values: Record<string, number | null> };
export type AggregateResult = { groups: AggregateGroup[]; total: number };

export const MAX_PAGE_SIZE = 200;
export const MAX_FILTERS = 20;
export const MAX_METRICS = 8;
export const MAX_GROUPS = 500;

const FILTER_OPS = new Set<FilterOp>([
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  "contains",
  "in",
  "empty",
  "filled",
]);
const METRIC_OPS = new Set<MetricOp>(["count", "sum", "avg", "min", "max"]);
const SYSTEM_COLUMNS = new Set(["_id", "_updatedAt", "_by", "_mine"]);
const TEXT_TYPES = new Set(["text", "longtext", "enum", "email", "url", "person", "relation"]);
const NUMBER_TYPES = new Set(["number", "currency", "percent"]);

export class QueryError extends Error {}

function columnOf(schema: TableSchema, key: unknown): Column | { key: string; type: "text" } {
  if (typeof key === "string" && SYSTEM_COLUMNS.has(key)) return { key, type: "text" };
  const column =
    typeof key === "string" ? schema.columns.find((entry) => entry.key === key) : undefined;
  if (!column) throw new QueryError(`${schema.label} has no column ${String(key)}.`);
  return column;
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const isEmpty = (value: unknown) =>
  value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length);

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value)))
    return Number(value);
  return null;
}

/** Orders values as the table does: blanks last, numbers by size, text naturally. */
export function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (isEmpty(a)) return isEmpty(b) ? 0 : 1;
  if (isEmpty(b)) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b ? 0 : a ? -1 : 1;
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

function matches(row: Row, filter: RowFilter, type: string): boolean {
  const value = row[filter.column];
  const wanted = filter.value;
  switch (filter.op) {
    case "empty":
      return isEmpty(value);
    case "filled":
      return !isEmpty(value);
    case "eq":
    case "ne": {
      const same = NUMBER_TYPES.has(type)
        ? asNumber(value) !== null && asNumber(value) === asNumber(wanted)
        : typeof wanted === "boolean"
          ? (value === true) === wanted
          : fold(String(value ?? "")) === fold(String(wanted ?? ""));
      return filter.op === "eq" ? same : !same;
    }
    case "in": {
      const list = Array.isArray(wanted) ? wanted.map((item) => fold(String(item))) : [];
      return list.includes(fold(String(value ?? "")));
    }
    case "contains":
      return fold(String(value ?? "")).includes(fold(String(wanted ?? "")));
    default: {
      if (isEmpty(value)) return false;
      const order = NUMBER_TYPES.has(type)
        ? (asNumber(value) ?? 0) - (asNumber(wanted) ?? 0)
        : compareValues(value, wanted);
      if (filter.op === "lt") return order < 0;
      if (filter.op === "lte") return order <= 0;
      if (filter.op === "gt") return order > 0;
      return order >= 0;
    }
  }
}

function checkedFilters(
  schema: TableSchema,
  filters: unknown,
): Array<RowFilter & { type: string }> {
  if (filters === undefined) return [];
  if (!Array.isArray(filters)) throw new QueryError("filters must be a list.");
  if (filters.length > MAX_FILTERS) throw new QueryError(`Use at most ${MAX_FILTERS} filters.`);
  return filters.map((raw) => {
    const filter = raw as Partial<RowFilter> | null;
    if (!filter || !FILTER_OPS.has(filter.op as FilterOp))
      throw new QueryError(`A filter's op is one of ${[...FILTER_OPS].join(", ")}.`);
    const column = columnOf(schema, filter.column);
    return { column: column.key, op: filter.op!, value: filter.value, type: column.type };
  });
}

function searchText(schema: TableSchema, row: Row): string {
  return fold(
    schema.columns
      .filter((column) => TEXT_TYPES.has(column.type) || NUMBER_TYPES.has(column.type))
      .map((column) => row[column.key])
      .filter((value) => !isEmpty(value))
      .join(" "),
  );
}

function filtered(schema: TableSchema, rows: Row[], search: unknown, filters: unknown): Row[] {
  const checks = checkedFilters(schema, filters);
  const words = typeof search === "string" ? fold(search).split(/\s+/).filter(Boolean) : [];
  if (!checks.length && !words.length) return rows;
  return rows.filter((row) => {
    if (!checks.every((check) => matches(row, check, check.type))) return false;
    if (!words.length) return true;
    const text = searchText(schema, row);
    return words.every((word) => text.includes(word));
  });
}

/** One page of rows matching the query, and how many match in all. */
export function runQuery(schema: TableSchema, rows: Row[], query: RowQuery = {}): QueryResult {
  const list = filtered(schema, rows, query.search, query.filters);
  const sorts = (Array.isArray(query.sort) ? query.sort : query.sort ? [query.sort] : []).slice(
    0,
    4,
  );
  const order = sorts.map((sort) => ({
    key: columnOf(schema, sort?.column).key,
    sign: sort?.dir === "desc" ? -1 : 1,
  }));
  const sorted = order.length
    ? [...list].sort((a, b) => {
        for (const { key, sign } of order) {
          // Blanks stay last whichever way the column is sorted.
          if (isEmpty(a[key]) !== isEmpty(b[key])) return isEmpty(a[key]) ? 1 : -1;
          const result = compareValues(a[key], b[key]);
          if (result) return result * sign;
        }
        return 0;
      })
    : list;
  const pageSize = Math.min(Math.max(Math.floor(query.pageSize ?? 50), 1), MAX_PAGE_SIZE);
  const page = Math.max(Math.floor(query.page ?? 0), 0);
  return { rows: sorted.slice(page * pageSize, page * pageSize + pageSize), total: list.length };
}

function bucketOf(value: unknown, bucket: AggregateQuery["bucket"]): string | null {
  if (isEmpty(value)) return null;
  const text = String(value);
  const date = new Date(text.length === 10 ? `${text}T00:00:00Z` : text);
  if (Number.isNaN(date.getTime())) return text;
  const iso = date.toISOString();
  if (bucket === "year") return iso.slice(0, 4);
  if (bucket === "month") return iso.slice(0, 7);
  if (bucket === "week") {
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return monday.toISOString().slice(0, 10);
  }
  return iso.slice(0, 10);
}

/** Counts and sums over the matching rows, in one group or one per value of a column. */
export function runAggregate(
  schema: TableSchema,
  rows: Row[],
  query: AggregateQuery = {},
): AggregateResult {
  const list = filtered(schema, rows, query.search, query.filters);
  const metrics = (query.metrics?.length ? query.metrics : [{ op: "count" } as Metric]).slice(
    0,
    MAX_METRICS,
  );
  const checked = metrics.map((metric) => {
    if (!METRIC_OPS.has(metric?.op))
      throw new QueryError(`A metric's op is one of ${[...METRIC_OPS].join(", ")}.`);
    if (metric.op !== "count" && !metric.column)
      throw new QueryError(`A ${metric.op} metric needs a column.`);
    const column = metric.column ? columnOf(schema, metric.column).key : null;
    return {
      op: metric.op,
      column,
      as: metric.as || (column ? `${metric.op}_${column}` : "count"),
    };
  });
  const group = query.groupBy ? columnOf(schema, query.groupBy) : null;
  const isDate = group?.type === "date";
  const buckets = new Map<string | null, Row[]>();
  for (const row of list) {
    const raw = group ? row[group.key] : "all";
    const key = isDate ? bucketOf(raw, query.bucket ?? "month") : isEmpty(raw) ? null : String(raw);
    const members = buckets.get(key);
    if (members) members.push(row);
    else buckets.set(key, [row]);
  }
  const groups = [...buckets.entries()].map(([key, members]) => {
    const values: Record<string, number | null> = {};
    for (const metric of checked) {
      if (metric.op === "count") {
        values[metric.as] = metric.column
          ? members.filter((row) => !isEmpty(row[metric.column!])).length
          : members.length;
        continue;
      }
      const numbers = members
        .map((row) => asNumber(row[metric.column!]))
        .filter((value): value is number => value !== null);
      values[metric.as] = !numbers.length
        ? null
        : metric.op === "sum"
          ? round(numbers.reduce((sum, value) => sum + value, 0))
          : metric.op === "avg"
            ? round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length)
            : metric.op === "min"
              ? Math.min(...numbers)
              : Math.max(...numbers);
    }
    return { key, values, size: members.length };
  });
  groups.sort((a, b) =>
    isDate ? compareValues(a.key, b.key) : b.size - a.size || compareValues(a.key, b.key),
  );
  const limit = Math.min(Math.max(Math.floor(query.limit ?? 100), 1), MAX_GROUPS);
  return {
    groups: groups.slice(0, limit).map(({ key, values }) => ({ key, values })),
    total: list.length,
  };
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;
