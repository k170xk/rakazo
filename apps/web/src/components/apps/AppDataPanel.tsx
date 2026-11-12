import { useLingui } from "@lingui/react/macro";
import type { Column, ColumnType, TableSchema } from "@rakazo/app-kit/schema";
import { COLUMN_KEY, COLUMN_TYPES, formatValue } from "@rakazo/app-kit/schema";
import { Button, Input, Spinner } from "@rakazo/ui-web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { saveFile } from "../../lib/app-host";
import { useSpaceQueries } from "../../lib/query";

type Row = Record<string, unknown> & { _id?: string };
const PAGE_SIZE = 100;

/** The app's tables as an editable grid, for the owner: rows, columns, export and update from Excel. */
export function AppDataPanel({ pageId }: { pageId: string }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const data = useQuery({
    ...queries.apps.data.queryOptions({ input: { pageId } }),
    refetchInterval: 5000,
  });
  const names = Object.keys(data.data?.tables ?? {});
  const [chosen, setChosen] = useState<string | null>(null);
  const name = chosen && names.includes(chosen) ? chosen : (names[0] ?? null);
  const table = name ? data.data?.tables[name] : undefined;
  const schema = table?.schema as TableSchema | undefined;
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: queries.apps.key() });
  const fail = (failure: unknown) =>
    setError(failure instanceof Error ? failure.message : t`That change wasn't saved.`);
  const update = useMutation({
    mutationFn: (input: { id: string; patch: Record<string, unknown> }) =>
      queries.apps.updateRow.call({ pageId, table: name ?? "", ...input }),
    onSuccess: () => {
      setError(null);
      void refresh();
    },
    onError: fail,
  });
  const insert = useMutation({
    mutationFn: () => queries.apps.insertRow.call({ pageId, table: name ?? "", row: {} }),
    onSuccess: () => {
      setError(null);
      void refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => queries.apps.removeRow.call({ pageId, table: name ?? "", id }),
    onSuccess: () => void refresh(),
    onError: fail,
  });
  const define = useMutation({
    mutationFn: (next: TableSchema) => queries.apps.defineTable.call({ pageId, schema: next }),
    onSuccess: () => {
      setError(null);
      void refresh();
    },
    onError: fail,
  });
  const exportFile = useMutation({
    mutationFn: (format: "xlsx" | "csv") =>
      queries.apps.export.call({ pageId, table: name ?? "", format }),
    onSuccess: (file) => saveFile(file.filename, file.mime, file.base64, true),
    onError: fail,
  });
  const reimport = useMutation({
    mutationFn: async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text = "";
      for (let at = 0; at < bytes.length; at += 0x8000) {
        text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
      }
      return queries.apps.reimportWorkbook.call({
        pageId,
        fileName: file.name,
        base64: btoa(text),
      });
    },
    onSuccess: (result) => {
      setReport(result.report);
      void refresh();
    },
    onError: fail,
  });

  const columns = (schema?.columns ?? []).filter((column) => !column.hidden) as Column[];
  const rows = useMemo(() => {
    const all = (table?.rows ?? []) as Row[];
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return all;
    return all.filter((row) => {
      const text = Object.values(row).join(" ").toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [table, search]);

  if (data.isPending) {
    return (
      <div className="grid h-40 place-items-center">
        <Spinner />
      </div>
    );
  }
  if (!names.length || !schema || !name) {
    return (
      <div className="flex flex-col items-start gap-3 p-4 text-[14px] text-muted-foreground">
        <p>{t`This app has no tables yet. Ask the bot to add one, or bring in a spreadsheet.`}</p>
        <ImportButton
          pending={reimport.isPending}
          onPick={() => fileInput.current?.click()}
          label={t`Add from Excel`}
        />
        <HiddenFileInput input={fileInput} onFile={(file) => reimport.mutate(file)} />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-foreground/[0.06] bg-card px-3 pt-3 pb-2">
        <div className="flex flex-wrap gap-1">
          {names.map((tableName) => (
            <button
              key={tableName}
              type="button"
              aria-pressed={tableName === name}
              onClick={() => {
                setChosen(tableName);
                setShown(PAGE_SIZE);
              }}
              className="rounded-full px-2.5 py-1 text-[13px] text-foreground/70 hover:bg-foreground/[0.05] aria-pressed:bg-primary/15 aria-pressed:font-medium aria-pressed:text-primary"
            >
              {data.data?.tables[tableName]?.schema.label ?? tableName}
              <span className="ml-1 text-foreground/40 tabular-nums">
                {data.data?.tables[tableName]?.rows.length ?? 0}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t`Search rows`}
              aria-label={t`Search rows`}
              className="h-8 pl-8 text-[13px]"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={insert.isPending}
            onClick={() => insert.mutate()}
          >
            <Plus />
            {t`Row`}
          </Button>
          <AddColumn
            existing={schema.columns.map((column) => column.key)}
            pending={define.isPending}
            onAdd={(column) => define.mutate({ ...schema, columns: [...schema.columns, column] })}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t`Download as Excel`}
            title={t`Download as Excel`}
            disabled={exportFile.isPending}
            onClick={() => exportFile.mutate("xlsx")}
          >
            <Download />
          </Button>
          <ImportButton
            pending={reimport.isPending}
            onPick={() => fileInput.current?.click()}
            label={t`Update from Excel`}
            iconOnly
          />
          <HiddenFileInput input={fileInput} onFile={(file) => reimport.mutate(file)} />
        </div>
        {error ? (
          <p role="alert" className="text-[12px] text-destructive">
            {error}
          </p>
        ) : null}
        {report ? (
          <div className="rounded-lg bg-primary/10 px-2.5 py-2 text-[12px] text-foreground">
            <div className="flex items-center justify-between">
              <span className="font-medium">{t`Updated from Excel`}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setReport(null)}
              >
                {t`Dismiss`}
              </button>
            </div>
            <ul className="mt-1 list-disc pl-4 text-muted-foreground">
              {report.slice(0, 12).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto">
        <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className="sticky top-0 border-b border-foreground/[0.06] bg-card px-2.5 py-2 text-left font-medium whitespace-nowrap text-muted-foreground"
                >
                  {column.label}
                  <span className="ml-1 text-[11px] font-normal text-foreground/35">
                    {column.formula ? "ƒ" : column.type}
                  </span>
                </th>
              ))}
              <th className="w-8 border-b border-foreground/[0.06] bg-card" />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((row) => (
              <tr key={String(row._id)} className="group/row hover:bg-foreground/[0.025]">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className="max-w-[260px] border-b border-foreground/[0.04] px-1 py-0.5"
                  >
                    <Cell
                      column={column}
                      value={row[column.key]}
                      onSave={(value) =>
                        update.mutate({ id: String(row._id), patch: { [column.key]: value } })
                      }
                    />
                  </td>
                ))}
                <td className="border-b border-foreground/[0.04] pr-1">
                  <button
                    type="button"
                    aria-label={t`Delete row`}
                    onClick={() => remove.mutate(String(row._id))}
                    className="grid size-7 place-items-center rounded-md text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > shown ? (
          <div className="p-3">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShown((count) => count + PAGE_SIZE)}
            >
              {t`Show more (${rows.length - shown} left)`}
            </Button>
          </div>
        ) : null}
        {rows.length === 0 ? (
          <p className="p-4 text-[13px] text-muted-foreground">{t`No rows match.`}</p>
        ) : null}
      </div>
    </div>
  );
}

function Cell({
  column,
  value,
  onSave,
}: {
  column: Column;
  value: unknown;
  onSave: (value: unknown) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = formatValue(column, value);
  const base =
    "w-full rounded-md px-1.5 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring";
  if (column.formula || column.type === "image")
    return <span className={`${base} block text-muted-foreground`}>{shown || "—"}</span>;
  if (column.type === "boolean") {
    return (
      <input
        type="checkbox"
        aria-label={column.label}
        checked={value === true}
        onChange={(event) => onSave(event.target.checked)}
        className="mx-1.5 size-4 accent-primary"
      />
    );
  }
  if (column.type === "enum" && column.options?.length) {
    return (
      <select
        aria-label={column.label}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onSave(event.target.value || null)}
        className={`${base} bg-transparent hover:bg-foreground/[0.04]`}
      >
        <option value="">—</option>
        {column.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.value}
          </option>
        ))}
      </select>
    );
  }
  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(editable(column.type, value))}
        className={`${base} block truncate hover:bg-foreground/[0.04] ${shown ? "" : "text-foreground/25"}`}
      >
        {shown || "—"}
      </button>
    );
  }
  const commit = () => {
    const next = draft;
    setDraft(null);
    if (next === editable(column.type, value)) return;
    onSave(next.trim() === "" ? null : next);
  };
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: the field opens because the cell was clicked.
      autoFocus
      aria-label={column.label}
      type={column.type === "date" ? "date" : "text"}
      inputMode={NUMERIC.has(column.type) ? "decimal" : undefined}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") {
          event.stopPropagation();
          setDraft(null);
        }
      }}
      className={`${base} bg-background ring-1 ring-ring`}
    />
  );
}

const NUMERIC = new Set<ColumnType>(["number", "currency", "percent"]);

function editable(type: ColumnType, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (type === "date" && typeof value === "string") return value.slice(0, 10);
  return String(value);
}

function AddColumn({
  existing,
  pending,
  onAdd,
}: {
  existing: string[];
  pending: boolean;
  onAdd: (column: Column) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<ColumnType>("text");
  const key = columnKey(label, existing);
  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Plus />
        {t`Column`}
      </Button>
    );
  }
  return (
    <form
      className="absolute inset-x-3 top-full z-20 mt-1 flex items-center gap-1.5 rounded-xl border border-foreground/[0.08] bg-card p-2 shadow-lg"
      onSubmit={(event) => {
        event.preventDefault();
        if (!key) return;
        onAdd({ key, label: label.trim(), type });
        setOpen(false);
        setLabel("");
      }}
    >
      <Input
        autoFocus
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder={t`Column name`}
        aria-label={t`Column name`}
        className="h-8 text-[13px]"
      />
      <select
        aria-label={t`Column type`}
        value={type}
        onChange={(event) => setType(event.target.value as ColumnType)}
        className="h-8 rounded-md border border-border bg-transparent px-2 text-[13px]"
      >
        {COLUMN_TYPES.filter(
          (option) => option !== "relation" && option !== "enum" && option !== "image",
        ).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <Button size="sm" type="submit" disabled={!key || pending}>
        {t`Add`}
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
        {t`Cancel`}
      </Button>
    </form>
  );
}

function columnKey(label: string, existing: string[]): string | null {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "c_$1")
    .slice(0, 50);
  if (!base || !COLUMN_KEY.test(base)) return null;
  let key = base;
  for (let n = 2; existing.includes(key); n++) key = `${base}_${n}`;
  return key;
}

function ImportButton({
  pending,
  onPick,
  label,
  iconOnly = false,
}: {
  pending: boolean;
  onPick: () => void;
  label: string;
  iconOnly?: boolean;
}) {
  return (
    <Button
      size={iconOnly ? "icon-sm" : "sm"}
      variant={iconOnly ? "ghost" : "outline"}
      aria-label={label}
      title={label}
      disabled={pending}
      onClick={onPick}
    >
      {pending ? <Spinner /> : <FileSpreadsheet />}
      {iconOnly ? null : label}
    </Button>
  );
}

function HiddenFileInput({
  input,
  onFile,
}: {
  input: React.RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
}) {
  return (
    <input
      ref={input}
      type="file"
      hidden
      accept=".xlsx,.xlsm,.xls,.csv,.ods"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) onFile(file);
      }}
    />
  );
}
