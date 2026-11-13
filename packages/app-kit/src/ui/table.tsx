import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Inbox,
  Minus,
} from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { Column, Row, TableSchema, Tone } from "../schema.js";
import { formatValue } from "../schema.js";
import { Avatar, Badge, EmptyState, FilterChips, SearchInput, Skeleton } from "./basic.js";
import { cn, toneFor } from "./cn.js";
import { Photos } from "./media.js";

export type TableColumn<T> = {
  key: string;
  label: ReactNode;
  type?: Column["type"];
  currency?: string;
  options?: Column["options"];
  render?: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  width?: number | string;
  sortable?: boolean;
  /** Value used for sorting and search when render shows something else. */
  value?: (row: T) => unknown;
};

const NUMERIC = new Set(["number", "currency", "percent"]);

/** How one value of a column looks in a table, card or detail panel. */
export function CellValue({
  column,
  value,
}: {
  column: Pick<Column, "type" | "currency" | "options">;
  value: unknown;
}) {
  if (value === null || value === undefined || value === "")
    return <span className="text-muted-foreground/50">—</span>;
  switch (column.type) {
    case "enum": {
      const option = column.options?.find((item) => item.value === value);
      return (
        <Badge tone={(option?.tone as Tone | undefined) ?? toneFor(value, "neutral")} dot>
          {String(value)}
        </Badge>
      );
    }
    case "boolean":
      return value ? (
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-success/15 text-success">
          <Check className="size-3" strokeWidth={3} />
        </span>
      ) : (
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Minus className="size-3" strokeWidth={3} />
        </span>
      );
    case "image":
      return <Photos value={value} size="sm" limit={3} />;
    case "person":
      return (
        <span className="inline-flex items-center gap-2">
          <Avatar name={String(value)} size={22} />
          <span className="truncate">{String(value)}</span>
        </span>
      );
    case "email":
    case "url":
      return <span className="truncate text-info">{String(value)}</span>;
    case "percent": {
      const number = Number(value);
      const pct = Math.abs(number) <= 1.5 ? number * 100 : number;
      return (
        <span className="inline-flex items-center gap-2">
          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
            />
          </span>
          <span className="tabular">{formatValue(column, value)}</span>
        </span>
      );
    }
    default:
      return (
        <span className={cn(NUMERIC.has(column.type) && "tabular")}>
          {formatValue(column, value)}
        </span>
      );
  }
}

export function columnsFromSchema<T extends Row>(
  schema: TableSchema,
  only?: string[],
): TableColumn<T>[] {
  const list = only
    ? only
        .map((key) => schema.columns.find((column) => column.key === key))
        .filter((column): column is Column => Boolean(column))
    : schema.columns.filter((column) => !column.hidden && column.type !== "longtext").slice(0, 8);
  return list.map((column) => ({
    key: column.key,
    label: column.label,
    type: column.type,
    currency: column.currency,
    options: column.options,
    align: NUMERIC.has(column.type) ? "right" : "left",
  }));
}

type Props<T extends Record<string, unknown>> = {
  rows: T[];
  /** Columns to show; or pass schema to build them from the table. */
  columns?: TableColumn<T>[];
  schema?: TableSchema | null;
  loading?: boolean;
  /** Show a search box over every visible column. */
  search?: boolean;
  searchPlaceholder?: string;
  /** An enum column to offer as filter chips. */
  filterBy?: string;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  selectedId?: string | null;
  toolbar?: ReactNode;
  empty?: ReactNode;
  initialSort?: { key: string; dir: "asc" | "desc" };
  /** Bare table without the card around it. */
  plain?: boolean;
  className?: string;
  /**
   * The server searches, filters, sorts and pages (a large table): rows is the current page,
   * total how many match, and onQuery is told whenever the reader changes what they want.
   */
  remote?: {
    total: number;
    onQuery: (query: RemoteQuery) => void;
    /** Chip values and counts for filterBy, from useAggregate. */
    chips?: Array<{ value: string; count?: number }>;
  };
};

export type RemoteQuery = {
  search: string;
  /** The chosen filterBy value. */
  chip: string | null;
  sort: { key: string; dir: "asc" | "desc" } | null;
  page: number;
  pageSize: number;
};

function compare(a: unknown, b: unknown) {
  if (a === b) return 0;
  if (a === null || a === undefined || a === "") return 1;
  if (b === null || b === undefined || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

/** A searchable, sortable, paged table with chips to filter and rows that open. */
export function DataTable<T extends Record<string, unknown>>({
  rows,
  columns,
  schema,
  loading,
  search = true,
  searchPlaceholder,
  filterBy,
  pageSize = 25,
  onRowClick,
  selectedId,
  toolbar,
  empty,
  initialSort,
  plain,
  className,
  remote,
}: Props<T>) {
  const cols = useMemo(
    () =>
      columns ??
      (schema ? (columnsFromSchema(schema as TableSchema) as unknown as TableColumn<T>[]) : []),
    [columns, schema],
  );
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    initialSort ?? null,
  );
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [query, chip, sort]);
  const onQuery = remote?.onQuery;
  useEffect(() => {
    onQuery?.({ search: query, chip, sort, page, pageSize });
  }, [onQuery, query, chip, sort, page, pageSize]);
  const cellOf = (row: T, column: TableColumn<T>) =>
    column.value ? column.value(row) : row[column.key];
  const chipColumn = filterBy
    ? schema?.columns.find((column) => column.key === filterBy)
    : undefined;
  const chipOptions = useMemo(() => {
    if (!filterBy) return [];
    if (remote)
      return (
        remote.chips ??
        chipColumn?.options?.map((option) => ({ value: option.value, count: undefined })) ??
        []
      ).map((option) => ({
        ...option,
        tone: chipColumn?.options?.find((item) => item.value === option.value)?.tone as
          | Tone
          | undefined,
      }));
    const counts = new Map<string, number>();
    for (const row of rows) {
      const value = row[filterBy];
      if (value === null || value === undefined || value === "") continue;
      counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
    }
    const ordered =
      chipColumn?.options?.map((option) => option.value).filter((value) => counts.has(value)) ?? [];
    for (const value of counts.keys()) if (!ordered.includes(value)) ordered.push(value);
    return ordered.map((value) => ({
      value,
      count: counts.get(value),
      tone: chipColumn?.options?.find((option) => option.value === value)?.tone as Tone | undefined,
    }));
  }, [rows, filterBy, chipColumn, remote]);
  const filtered = useMemo(() => {
    if (remote) return rows;
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    let list = rows;
    if (chip && filterBy) list = list.filter((row) => String(row[filterBy] ?? "") === chip);
    if (words.length) {
      list = list.filter((row) => {
        const text = cols
          .map((column) => String(cellOf(row, column) ?? ""))
          .join(" ")
          .toLowerCase();
        return words.every((word) => text.includes(word));
      });
    }
    if (sort) {
      const column = cols.find((item) => item.key === sort.key);
      if (column) {
        list = [...list].sort(
          (a, b) => compare(cellOf(a, column), cellOf(b, column)) * (sort.dir === "asc" ? 1 : -1),
        );
      }
    }
    return list;
  }, [rows, query, chip, filterBy, sort, cols, remote]);
  const matching = remote ? remote.total : filtered.length;
  const pages = Math.max(1, Math.ceil(matching / pageSize));
  const visible = remote ? rows : filtered.slice(page * pageSize, page * pageSize + pageSize);
  const anything = remote ? remote.total > 0 || query !== "" || chip !== null : rows.length > 0;
  const toggleSort = (key: string) =>
    setSort((current) =>
      current?.key !== key
        ? { key, dir: "asc" }
        : current.dir === "asc"
          ? { key, dir: "desc" }
          : null,
    );

  const body = (
    <>
      {(search || toolbar || chipOptions.length > 0) && (
        <div className="flex flex-col gap-3 border-b border-border/70 px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            {search && (
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder={searchPlaceholder}
                className="w-full max-w-xs"
              />
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}</div>
          </div>
          {chipOptions.length > 1 && (
            <FilterChips options={chipOptions} value={chip} onChange={setChip} />
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border/70 bg-muted/40">
              {cols.map((column) => {
                const sortable = column.sortable !== false;
                const active = sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    style={{ width: column.width }}
                    className={cn(
                      "h-10 px-4 text-xs font-bold tracking-wide whitespace-nowrap text-muted-foreground uppercase",
                      column.align === "right"
                        ? "text-right"
                        : column.align === "center"
                          ? "text-center"
                          : "text-left",
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={cn(
                          "inline-flex items-center gap-1 hover:text-foreground",
                          active && "text-foreground",
                        )}
                      >
                        {column.label}
                        {active ? (
                          sort?.dir === "asc" ? (
                            <ArrowUp className="size-3" />
                          ) : (
                            <ArrowDown className="size-3" />
                          )
                        ) : (
                          <ChevronsUpDown className="size-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }, (_, index) => (
                  <tr key={index} className="border-b border-border/50">
                    {cols.map((column) => (
                      <td key={column.key} className="px-4 py-3">
                        <Skeleton className="h-4 w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              : visible.map((row, index) => {
                  const id = String(row._id ?? index);
                  return (
                    <motion.tr
                      key={id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.25, delay: Math.min(index, 12) * 0.018 }}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={cn(
                        "border-b border-border/50 transition-colors last:border-0",
                        onRowClick && "cursor-pointer hover:bg-muted/50",
                        selectedId === id && "bg-primary/8 hover:bg-primary/10",
                      )}
                    >
                      {cols.map((column, columnIndex) => (
                        <td
                          key={column.key}
                          className={cn(
                            "max-w-[320px] truncate px-4 py-3",
                            column.align === "right"
                              ? "text-right"
                              : column.align === "center"
                                ? "text-center"
                                : "text-left",
                            columnIndex === 0 && "font-semibold",
                          )}
                        >
                          {column.render ? (
                            column.render(row)
                          ) : (
                            <CellValue
                              column={{
                                type: column.type ?? "text",
                                currency: column.currency,
                                options: column.options,
                              }}
                              value={row[column.key]}
                            />
                          )}
                        </td>
                      ))}
                    </motion.tr>
                  );
                })}
          </tbody>
        </table>
        {!loading && visible.length === 0 && (
          <EmptyState
            icon={<Inbox />}
            title={anything ? "Nothing matches" : "No rows yet"}
            description={anything ? "Try a different search or filter." : undefined}
            action={empty}
          />
        )}
      </div>
      {matching > pageSize && (
        <div className="flex items-center justify-between border-t border-border/70 px-4 py-2.5 text-[13px] text-muted-foreground">
          <span className="tabular">
            {page * pageSize + 1}–{Math.min(matching, (page + 1) * pageSize)} of{" "}
            {matching.toLocaleString("en-IE")}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
              className="flex size-8 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="px-2 tabular">
              {page + 1} / {pages}
            </span>
            <button
              type="button"
              disabled={page >= pages - 1}
              onClick={() => setPage((value) => value + 1)}
              className="flex size-8 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
  return plain ? (
    <div className={className}>{body}</div>
  ) : (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card",
        className,
      )}
    >
      {body}
    </div>
  );
}
