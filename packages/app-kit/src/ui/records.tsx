import { Download, Pencil, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import type { RowQuery } from "../query.js";
import type { Column, Row, TableSchema } from "../schema.js";
import { coerceRow } from "../schema.js";
import { useAggregate, useApp, useFocus, useRows } from "../sdk/index.js";
import { Button, Checkbox, Field, Input, Select, Stat, Textarea } from "./basic.js";
import { cn } from "./cn.js";
import { PhotoInput, Photos } from "./media.js";
import { ConfirmDialog, Drawer, toast } from "./overlay.js";
import type { RemoteQuery, TableColumn } from "./table.js";
import { CellValue, DataTable } from "./table.js";
import { PresenceStack, RowActivity } from "./together.js";

function inputValue(column: Column, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (column.type === "date") return String(value).slice(0, 10);
  return String(value);
}

/** A form for one row, built from its table: the right control for each column type. */
export function RecordForm({
  schema,
  value,
  onChange,
  columns,
  errors,
}: {
  schema: TableSchema;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  /** Only these columns, in this order. */
  columns?: string[];
  errors?: Record<string, string>;
}) {
  const list = (columns ?? schema.columns.filter((column) => !column.hidden).map((column) => column.key))
    .map((key) => schema.columns.find((column) => column.key === key))
    .filter((column): column is Column => Boolean(column) && !column?.formula);
  const set = (key: string, next: unknown) => onChange({ ...value, [key]: next });
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {list.map((column) => {
        const wide = column.type === "longtext" || column.type === "url" || column.type === "image";
        const label = (
          <>
            {column.label}
            {column.required && <span className="text-destructive"> *</span>}
          </>
        );
        if (column.type === "boolean") {
          return (
            <div key={column.key} className="flex items-end pb-2">
              <Checkbox
                checked={Boolean(value[column.key])}
                onChange={(checked) => set(column.key, checked)}
                label={column.label}
              />
            </div>
          );
        }
        return (
          <Field
            key={column.key}
            label={label}
            error={errors?.[column.key]}
            className={cn(wide && "sm:col-span-2")}
          >
            {(id) =>
              column.type === "image" ? (
                <PhotoInput value={value[column.key]} onChange={(next) => set(column.key, next)} />
              ) : column.type === "longtext" ? (
                <Textarea
                  id={id}
                  value={inputValue(column, value[column.key])}
                  onChange={(event) => set(column.key, event.target.value)}
                />
              ) : column.type === "enum" ? (
                <Select
                  id={id}
                  value={inputValue(column, value[column.key])}
                  onChange={(event) => set(column.key, event.target.value)}
                  placeholder="Choose…"
                  options={(column.options ?? []).map((option) => option.value)}
                />
              ) : (
                <Input
                  id={id}
                  type={
                    column.type === "date"
                      ? "date"
                      : column.type === "number" ||
                          column.type === "currency" ||
                          column.type === "percent"
                        ? "number"
                        : column.type === "email"
                          ? "email"
                          : column.type === "url"
                            ? "url"
                            : "text"
                  }
                  step="any"
                  value={inputValue(column, value[column.key])}
                  onChange={(event) => set(column.key, event.target.value)}
                />
              )
            }
          </Field>
        );
      })}
    </div>
  );
}

/** Every column of a row as labelled values. */
export function RecordDetail({
  schema,
  row,
  columns,
}: {
  schema: TableSchema;
  row: Record<string, unknown>;
  columns?: string[];
}) {
  const list = (columns ?? schema.columns.filter((column) => !column.hidden).map((column) => column.key))
    .map((key) => schema.columns.find((column) => column.key === key))
    .filter((column): column is Column => Boolean(column));
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
      {list.map((column) => (
        <Stat
          key={column.key}
          label={column.label}
          className={cn(
            column.type === "longtext" &&
              "sm:col-span-2 [&>div]:whitespace-pre-wrap [&>div]:overflow-visible",
            column.type === "image" && "sm:col-span-2 [&>div]:overflow-visible",
          )}
          value={
            column.type === "image" ? (
              <Photos value={row[column.key]} size="lg" limit={8} />
            ) : (
              <CellValue column={column} value={row[column.key]} />
            )
          }
        />
      ))}
    </div>
  );
}

type TableLike = {
  /** The table's name (useTable gives it): adds comments, history and presence. */
  name?: string;
  /** Read page by page from the server instead of rows. */
  large?: boolean;
  rows: Row[];
  schema: TableSchema | null;
  loading: boolean;
  canEdit: boolean;
  canEditRow?: (row: Row) => boolean;
  insert: (row: Record<string, unknown>) => Promise<Row>;
  update: (id: string, patch: Record<string, unknown>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  exportFile: (format?: "xlsx" | "csv") => Promise<void>;
  canExport?: boolean;
};

const LARGE_PAGE = 25;

/**
 * A whole screen for one table: search, filter chips, sorting, a drawer to read and edit a row
 * (with its comments and history), adding, deleting (with a check first) and export, plus the
 * faces of who else is looking. Pass what useTable returns; large tables page from the server.
 */
export function TableView({
  table,
  columns,
  filterBy,
  formColumns,
  title,
  newLabel = "Add",
  renderDetail,
  toolbar,
  activity,
}: {
  table: TableLike;
  /** Columns for the list; the first eight by default. */
  columns?: Array<string | TableColumn<Row>>;
  filterBy?: string;
  formColumns?: string[];
  /** How a row is named in the drawer; the schema's title column by default. */
  title?: (row: Row) => ReactNode;
  newLabel?: string;
  /** Extra content under a row's details (related rows, a chart). */
  renderDetail?: (row: Row) => ReactNode;
  toolbar?: ReactNode;
  /** Show comments and history in the drawer (on when the table has a name). */
  activity?: boolean;
}) {
  const { schema } = table;
  const large = Boolean(table.large && table.name);
  const { features, local } = useApp();
  const [remoteQuery, setRemoteQuery] = useState<RemoteQuery | null>(null);
  const rowQuery = useMemo<RowQuery>(() => {
    if (!remoteQuery) return { pageSize: LARGE_PAGE };
    return {
      search: remoteQuery.search,
      filters:
        remoteQuery.chip && filterBy
          ? [{ column: filterBy, op: "eq", value: remoteQuery.chip }]
          : undefined,
      sort: remoteQuery.sort
        ? { column: remoteQuery.sort.key, dir: remoteQuery.sort.dir }
        : undefined,
      page: remoteQuery.page,
      pageSize: remoteQuery.pageSize,
    };
  }, [remoteQuery, filterBy]);
  const paged = useRows(table.name ?? "", rowQuery, { skip: !large });
  const chipCounts = useAggregate(
    table.name ?? "",
    { groupBy: filterBy, metrics: [{ op: "count", as: "count" }], limit: 30 },
    { skip: !large || !filterBy },
  );
  const onQuery = useCallback((next: RemoteQuery) => setRemoteQuery(next), []);
  const rows = large ? paged.rows : table.rows;
  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "new">("view");
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const open = openId ? rows.find((row) => row._id === openId) : undefined;
  useFocus(table.name, open?._id);
  const showActivity =
    activity !== false &&
    Boolean(table.name) &&
    (local || features.includes("comments") || features.includes("history"));
  const cols = useMemo(() => {
    if (!schema || !columns) return undefined;
    return columns
      .map((item) => {
        if (typeof item !== "string") return item;
        const column = schema.columns.find((entry) => entry.key === item);
        return column
          ? ({
              key: column.key,
              label: column.label,
              type: column.type,
              currency: column.currency,
              options: column.options,
              align: ["number", "currency", "percent"].includes(column.type) ? "right" : "left",
            } as TableColumn<Row>)
          : null;
      })
      .filter((item): item is TableColumn<Row> => item !== null);
  }, [schema, columns]);
  if (!schema) return <DataTable rows={[]} loading />;
  const titleKey = schema.title ?? schema.key ?? schema.columns[0]?.key;
  const nameOf = (row: Row) =>
    title ? title(row) : String((titleKey && row[titleKey]) ?? "Untitled");
  const close = () => {
    setOpenId(null);
    setMode("view");
    setErrors({});
  };
  const save = async () => {
    const checked = coerceRow(schema, draft);
    if (!checked.ok) {
      const column = schema.columns.find((item) => checked.error.startsWith(item.label));
      setErrors(column ? { [column.key]: checked.error } : {});
      toast.error("Check the form", checked.error);
      return;
    }
    setSaving(true);
    try {
      if (mode === "new") {
        const saved = await table.insert(checked.row);
        toast.success("Added");
        setOpenId(saved._id);
      } else if (open) {
        await table.update(open._id, checked.row);
        toast.success("Saved");
      }
      setMode("view");
      setErrors({});
    } catch (error) {
      toast.error("Not saved", error instanceof Error ? error.message : undefined);
    } finally {
      setSaving(false);
    }
  };
  const drawerOpen = mode === "new" || Boolean(open);
  return (
    <>
      <DataTable
        rows={rows}
        schema={schema}
        columns={cols}
        loading={table.loading || (large && paged.loading && !paged.rows.length)}
        pageSize={large ? LARGE_PAGE : undefined}
        remote={
          large
            ? {
                total: paged.total,
                onQuery,
                chips: filterBy
                  ? chipCounts.groups
                      .filter((group) => group.key !== null)
                      .map((group) => ({
                        value: String(group.key),
                        count: group.values.count ?? undefined,
                      }))
                  : undefined,
              }
            : undefined
        }
        filterBy={filterBy}
        selectedId={openId}
        onRowClick={(row) => {
          setOpenId(row._id);
          setMode("view");
        }}
        searchPlaceholder={`Search ${schema.label.toLowerCase()}`}
        toolbar={
          <>
            {table.name && <PresenceStack table={table.name} className="mr-1" />}
            {toolbar}
            {table.canExport !== false && (
              <Button
                variant="outline"
                size="sm"
                icon={<Download />}
                onClick={() =>
                  void table.exportFile("xlsx").catch(() => toast.error("Export did not work"))
                }
              >
                Export
              </Button>
            )}
            {table.canEdit && (
              <Button
                size="sm"
                icon={<Plus />}
                onClick={() => {
                  setDraft({});
                  setOpenId(null);
                  setMode("new");
                }}
              >
                {newLabel}
              </Button>
            )}
          </>
        }
      />
      <Drawer
        open={drawerOpen}
        onClose={close}
        title={mode === "new" ? `${newLabel} to ${schema.label}` : open ? nameOf(open) : ""}
        description={
          mode === "view"
            ? open && typeof open._by === "string"
              ? `${schema.label} · added by ${open._by}`
              : schema.label
            : undefined
        }
        footer={
          mode === "view" ? (
            open && (table.canEditRow ? table.canEditRow(open) : table.canEdit) ? (
              <>
                <Button
                  variant="ghost"
                  icon={<Trash2 />}
                  className="mr-auto text-destructive"
                  onClick={() => setConfirming(true)}
                >
                  Delete
                </Button>
                <Button
                  variant="outline"
                  icon={<Pencil />}
                  onClick={() => {
                    setDraft({ ...open });
                    setMode("edit");
                  }}
                >
                  Edit
                </Button>
              </>
            ) : undefined
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => (mode === "new" ? close() : setMode("view"))}
              >
                Cancel
              </Button>
              <Button loading={saving} onClick={() => void save()}>
                {mode === "new" ? "Add" : "Save"}
              </Button>
            </>
          )
        }
      >
        {mode === "view" && open ? (
          <div className="flex flex-col gap-6">
            <RecordDetail schema={schema} row={open} />
            {renderDetail?.(open)}
            {showActivity && table.name && (
              <RowActivity
                table={table.name}
                rowId={open._id}
                schema={schema}
                className="border-t border-border/70 pt-5"
              />
            )}
          </div>
        ) : (
          <RecordForm
            schema={schema}
            value={draft}
            onChange={setDraft}
            columns={formColumns}
            errors={errors}
          />
        )}
      </Drawer>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Delete ${open ? nameOf(open) : "this row"}?`}
        description="It is removed for everyone using this app."
        onConfirm={async () => {
          if (!open) return;
          try {
            await table.remove(open._id);
            toast.success("Deleted");
            close();
          } catch (error) {
            toast.error("Not deleted", error instanceof Error ? error.message : undefined);
          }
        }}
      />
    </>
  );
}
