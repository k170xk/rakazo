import * as XLSX from "xlsx";
import type { Column, ColumnType, TableSchema } from "../schema.js";
import {
  evaluateFormula,
  formatValue,
  MAX_COLUMNS,
  MAX_ROWS_PER_TABLE,
  MAX_TABLES,
} from "../schema.js";

/**
 * Reads a spreadsheet into app tables the same way every time: the header row is found by
 * scoring the first rows, each column's type comes from its values and number formats, the key
 * is the first unique identifier column, totals rows are left out, same-row formulas become
 * computed columns and columns whose values name another sheet's keys become links to it.
 */

export type ImportedTable = {
  schema: TableSchema;
  rows: Array<Record<string, unknown>>;
  sheet: string;
  headerRow: number;
};

export type WorkbookImport = { tables: ImportedTable[]; report: string[] };

export const MAX_WORKBOOK_BYTES = 20 * 1024 * 1024;
const HEADER_SCAN_ROWS = 30;

type Cell = { v: unknown; t: string; f?: string; z?: string; w?: string };

const isEmpty = (value: unknown) =>
  value === null || value === undefined || (typeof value === "string" && value.trim() === "");

export function keyFor(label: string, taken: Set<string>): string {
  let key = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[€£$]/g, " ")
    .replace(/%/g, " pct ")
    .replace(/#/g, " no ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  if (!key) key = "column";
  if (!/^[a-z]/.test(key)) key = `c_${key}`;
  let candidate = key;
  for (let n = 2; taken.has(candidate); n++) candidate = `${key}_${n}`;
  taken.add(candidate);
  return candidate;
}

function tableName(sheet: string, taken: Set<string>): string {
  const key = keyFor(sheet, new Set()).slice(0, 36);
  let candidate = key;
  for (let n = 2; taken.has(candidate); n++) candidate = `${key}_${n}`;
  taken.add(candidate);
  return candidate;
}

function cellText(cell: Cell | undefined): string {
  if (!cell || isEmpty(cell.v)) return "";
  if (cell.v instanceof Date) return cell.v.toISOString().slice(0, 10);
  return String(cell.w ?? cell.v).trim();
}

function isoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** Cells of a sheet as rows, with merged ranges filled from their top-left cell. */
function sheetGrid(sheet: XLSX.WorkSheet): {
  grid: Array<Array<Cell | undefined>>;
  merged: Set<string>;
} {
  const ref = sheet["!ref"];
  if (!ref) return { grid: [], merged: new Set() };
  const range = XLSX.utils.decode_range(ref);
  const lastRow = Math.min(range.e.r, range.s.r + MAX_ROWS_PER_TABLE + HEADER_SCAN_ROWS);
  const lastCol = Math.min(range.e.c, range.s.c + MAX_COLUMNS + 20);
  const grid: Array<Array<Cell | undefined>> = [];
  for (let r = range.s.r; r <= lastRow; r++) {
    const row: Array<Cell | undefined> = [];
    for (let c = range.s.c; c <= lastCol; c++)
      row.push(sheet[XLSX.utils.encode_cell({ r, c })] as Cell | undefined);
    grid.push(row);
  }
  const merged = new Set<string>();
  for (const merge of sheet["!merges"] ?? []) {
    const top = sheet[XLSX.utils.encode_cell(merge.s)] as Cell | undefined;
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        const gr = r - range.s.r;
        const gc = c - range.s.c;
        if (gr < 0 || gc < 0 || gr >= grid.length) continue;
        merged.add(`${gr}:${gc}`);
        if (top && (r !== merge.s.r || c !== merge.s.c) && grid[gr])
          grid[gr]![gc] = { ...top, f: undefined };
      }
    }
  }
  return { grid, merged };
}

/** The row most likely to be the header: many distinct short labels, with data under it. */
export function findHeaderRow(grid: Array<Array<Cell | undefined>>): number {
  let best = -1;
  let bestScore = 0;
  for (let r = 0; r < Math.min(grid.length, HEADER_SCAN_ROWS); r++) {
    const row = grid[r] ?? [];
    const texts = row.map(cellText);
    const filled = texts.filter(Boolean);
    if (filled.length < 2) continue;
    const labels = row.filter(
      (cell) => cell && typeof cell.v === "string" && cellText(cell).length <= 60,
    );
    const distinct = new Set(labels.map((cell) => cellText(cell).toLowerCase())).size;
    if (labels.length < Math.max(2, filled.length * 0.6)) continue;
    let below = 0;
    for (let next = r + 1; next < Math.min(grid.length, r + 6); next++) {
      below +=
        (grid[next] ?? []).filter((cell) => !isEmpty(cell?.v)).length >=
        Math.max(1, filled.length * 0.4)
          ? 1
          : 0;
    }
    if (!below) continue;
    const score = distinct * 2 + below + (labels.length === filled.length ? 2 : 0);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

const CURRENCY_SYMBOL: Array<[RegExp, string]> = [
  [/€|EUR/, "EUR"],
  [/£|GBP/, "GBP"],
  [/\$|USD/, "USD"],
];
const MONEY_WORDS =
  /\b(fee|fees|cost|costs|price|amount|value|budget|invoice|invoiced|billed|revenue|spend|total|salary|rate|wip|margin|profit|paid|due|balance)\b|€|£/i;
const PERSON_WORDS =
  /\b(owner|lead|manager|assignee|engineer|director|responsible|contact|pm|staff|assigned|by|reviewer|designer|author|partner)\b/i;
const KEY_WORDS = /\b(ref|reference|no|number|id|code|job|project no|job no)\b|#/i;
const TITLE_WORDS = /\b(name|title|project|description|subject|client|task|item)\b/i;
const NOT_CHOICE_WORDS =
  /\b(name|title|description|note|notes|comment|comments|remark|remarks|address|summary)\b/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/\S+$/i;
const YES_NO = /^(yes|no|y|n|true|false|✓|✔|x)$/i;
const NAME_LIKE = /^[A-Z][a-zA-Z'’-]+(?: [A-Z][a-zA-Z'’-]+){1,3}$/;
const TOTAL_ROW = /^(grand\s+)?(sub-?)?totals?\b/i;

type ColumnDraft = {
  index: number;
  label: string;
  key: string;
  cells: Array<Cell | undefined>;
};

function inferType(draft: ColumnDraft): {
  type: ColumnType;
  currency?: string;
  options?: string[];
} {
  const cells = draft.cells.filter((cell): cell is Cell => !!cell && !isEmpty(cell.v));
  if (!cells.length) return { type: "text" };
  const share = (test: (cell: Cell) => boolean) => cells.filter(test).length / cells.length;
  if (
    share((cell) => cell.t === "b" || (typeof cell.v === "string" && YES_NO.test(cell.v.trim()))) >=
    0.95
  ) {
    const distinct = new Set(cells.map((cell) => String(cell.v).toLowerCase()));
    if (distinct.size <= 3) return { type: "boolean" };
  }
  if (
    share(
      (cell) =>
        cell.v instanceof Date || (typeof cell.v === "string" && /^\d{4}-\d{2}-\d{2}/.test(cell.v)),
    ) >= 0.9
  ) {
    return { type: "date" };
  }
  if (share((cell) => cell.t === "n") >= 0.9) {
    const formats = cells.map((cell) => cell.z ?? "").join(" ");
    for (const [pattern, code] of CURRENCY_SYMBOL)
      if (pattern.test(formats)) return { type: "currency", currency: code };
    if (/%/.test(formats)) return { type: "percent" };
    if (
      MONEY_WORDS.test(draft.label) &&
      !/\b(no|number|qty|quantity|count|hours|days|%)\b/i.test(draft.label)
    ) {
      return {
        type: "currency",
        currency: /£/.test(draft.label) ? "GBP" : /\$/.test(draft.label) ? "USD" : "EUR",
      };
    }
    if (
      /%|percent|pct|progress|complete/i.test(draft.label) &&
      cells.every((cell) => Number(cell.v) >= 0 && Number(cell.v) <= 1.5)
    ) {
      return { type: "percent" };
    }
    return { type: "number" };
  }
  const texts = cells.map((cell) => cellText(cell));
  if (texts.filter((text) => EMAIL.test(text)).length / texts.length >= 0.9)
    return { type: "email" };
  if (texts.filter((text) => URL_RE.test(text)).length / texts.length >= 0.9)
    return { type: "url" };
  const average = texts.reduce((sum, text) => sum + text.length, 0) / texts.length;
  if (average > 80) return { type: "longtext" };
  if (
    PERSON_WORDS.test(draft.label) &&
    texts.filter((text) => NAME_LIKE.test(text)).length / texts.length >= 0.7
  ) {
    return { type: "person" };
  }
  const distinct = [...new Set(texts)];
  if (
    texts.length >= 4 &&
    distinct.length >= 2 &&
    distinct.length <= Math.max(2, Math.min(15, texts.length * 0.35)) &&
    average <= 30 &&
    !NOT_CHOICE_WORDS.test(draft.label)
  ) {
    return { type: "enum", options: distinct };
  }
  return { type: "text" };
}

function cellValue(cell: Cell | undefined, type: ColumnType): unknown {
  if (!cell || isEmpty(cell.v)) return null;
  const value = cell.v;
  switch (type) {
    case "date":
      if (value instanceof Date) return isoDate(value);
      return String(value).slice(0, 10);
    case "number":
    case "currency":
    case "percent":
      return typeof value === "number"
        ? Math.round(value * 1e6) / 1e6
        : Number(String(value).replace(/[^0-9.-]/g, "")) || null;
    case "boolean":
      return typeof value === "boolean"
        ? value
        : /^(yes|y|true|✓|✔|x)$/i.test(String(value).trim());
    default:
      return value instanceof Date
        ? isoDate(value)
        : String(
            cell.w && typeof value === "number" && /[a-z]/i.test(cell.w) ? cell.w : value,
          ).trim();
  }
}

/** A same-row formula ("=C5*D5*(1+$F$2)") as a column formula, or null when it cannot be. */
export function translateFormula(
  formula: string,
  row: number,
  columnByLetter: Map<string, string>,
): string | null {
  const body = formula.replace(/^=/, "").replace(/\s+/g, "");
  if (!/^[A-Z0-9$+\-*/().]+$/i.test(body)) return null;
  let failed = false;
  const translated = body.replace(
    /\$?([A-Z]{1,3})\$?(\d+)/gi,
    (_, letters: string, digits: string) => {
      const key = columnByLetter.get(letters.toUpperCase());
      if (!key || Number(digits) !== row) failed = true;
      return key ?? "";
    },
  );
  if (failed || !/[a-z]/.test(translated)) return null;
  return translated;
}

function readSheet(
  name: string,
  sheet: XLSX.WorkSheet,
  takenNames: Set<string>,
  report: string[],
): ImportedTable | null {
  const { grid } = sheetGrid(sheet);
  const header = findHeaderRow(grid);
  if (header < 0) {
    report.push(`Sheet "${name}": no header row found, so it was left out.`);
    return null;
  }
  const range = XLSX.utils.decode_range(sheet["!ref"]!);
  const headerCells = grid[header] ?? [];
  const groupCells = header > 0 ? (grid[header - 1] ?? []) : [];
  const dataRows = grid.slice(header + 1);
  const taken = new Set<string>();
  const drafts: ColumnDraft[] = [];
  headerCells.forEach((cell, index) => {
    let label = cellText(cell);
    const hasData = dataRows.some((row) => !isEmpty(row[index]?.v));
    if (!label && !hasData) return;
    const group = cellText(groupCells[index]);
    if (
      label &&
      group &&
      group !== label &&
      groupCells.filter((other) => cellText(other) === group).length > 1
    )
      label = `${group} ${label}`;
    label = (label || `Column ${XLSX.utils.encode_col(range.s.c + index)}`)
      .replace(/\s+/g, " ")
      .slice(0, 80);
    drafts.push({ index, label, key: keyFor(label, taken), cells: [] });
  });
  if (drafts.length > MAX_COLUMNS) {
    report.push(`Sheet "${name}": only the first ${MAX_COLUMNS} columns were kept.`);
    drafts.length = MAX_COLUMNS;
  }
  const rows: Array<Array<Cell | undefined>> = [];
  let totals = 0;
  for (const row of dataRows) {
    const filled = drafts.filter((draft) => !isEmpty(row[draft.index]?.v));
    if (!filled.length) continue;
    const first = cellText(row[drafts[0]!.index]) || cellText(row[filled[0]!.index]);
    if (TOTAL_ROW.test(first)) {
      totals++;
      continue;
    }
    rows.push(row);
    if (rows.length >= MAX_ROWS_PER_TABLE) break;
  }
  if (!rows.length) {
    report.push(`Sheet "${name}": the header was found but no rows under it, so it was left out.`);
    return null;
  }
  for (const draft of drafts) draft.cells = rows.map((row) => row[draft.index]);
  const columnByLetter = new Map(
    drafts.map((draft) => [XLSX.utils.encode_col(range.s.c + draft.index), draft.key]),
  );
  const columns: Column[] = [];
  const notes: string[] = [];
  for (const draft of drafts) {
    const inferred = inferType(draft);
    const column: Column = { key: draft.key, label: draft.label, type: inferred.type };
    if (inferred.currency) column.currency = inferred.currency;
    if (inferred.options) column.options = inferred.options.map((value) => ({ value }));
    const formulas = draft.cells.filter((cell) => cell?.f);
    if (formulas.length >= draft.cells.length * 0.8 && formulas.length > 0) {
      const firstIndex = draft.cells.findIndex((cell) => cell?.f);
      const sheetRow = range.s.r + header + 2 + dataRows.indexOf(rows[firstIndex]!);
      const translated = translateFormula(draft.cells[firstIndex]!.f!, sheetRow, columnByLetter);
      if (translated) {
        column.formula = translated;
        const money = (translated.match(/[a-z][a-z0-9_]*/g) ?? [])
          .map((key) => columns.find((other) => other.key === key))
          .find((other) => other?.type === "currency");
        if (money && /\*|\+|-/.test(translated)) {
          column.type = "currency";
          column.currency = money.currency;
        }
        notes.push(`${draft.label} is worked out as ${translated}`);
      } else {
        notes.push(`${draft.label} kept its values (its formula reaches outside the row)`);
      }
    }
    columns.push(column);
  }
  // A computed column can only use columns that are stored, not other computed ones.
  for (const column of columns) {
    if (!column.formula) continue;
    const uses = column.formula.match(/[a-z][a-z0-9_]*/g) ?? [];
    if (uses.some((key) => columns.find((other) => other.key === key)?.formula)) {
      notes.push(`${column.label} kept its values (its formula uses another formula)`);
      delete column.formula;
    }
  }
  const values = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [index, draft] of drafts.entries()) {
      const column = columns[index]!;
      if (column.formula) continue;
      out[column.key] = cellValue(row[draft.index], column.type);
    }
    return out;
  });
  for (const column of columns) {
    if (!column.formula) continue;
    const sample = values[0] ? evaluateFormula(column.formula, values[0]) : null;
    if (sample === null) {
      notes.push(`${column.label} kept its values (its formula did not work out)`);
      delete column.formula;
      for (const [index, row] of rows.entries())
        values[index]![column.key] = cellValue(
          row[drafts[columns.indexOf(column)]!.index],
          "number",
        );
    }
  }
  const unique = (column: Column) => {
    const seen = new Set<string>();
    for (const row of values) {
      const value = row[column.key];
      if (isEmpty(value)) return false;
      const text = String(value);
      if (seen.has(text)) return false;
      seen.add(text);
    }
    return true;
  };
  const stored = columns.filter((column) => !column.formula);
  const identifier = (column: Column | undefined) =>
    !!column && ["text", "number"].includes(column.type) && unique(column);
  const first = stored[0];
  const key =
    (identifier(first) && (KEY_WORDS.test(first!.label) || first!.type === "text")
      ? first
      : undefined) ??
    stored.find((column) => KEY_WORDS.test(column.label) && identifier(column)) ??
    stored.find((column) => column.type === "text" && unique(column));
  const title =
    stored.find(
      (column) => column.type === "text" && TITLE_WORDS.test(column.label) && column !== key,
    ) ??
    key ??
    stored.find((column) => column.type === "text");
  const schema: TableSchema = {
    name: tableName(name, takenNames),
    label: name.trim().slice(0, 80) || "Sheet",
    columns,
    ...(key ? { key: key.key } : {}),
    ...(title ? { title: title.key } : {}),
  };
  const kinds = columns
    .filter((column) => column.type !== "text")
    .slice(0, 6)
    .map((column) => `${column.label} → ${describeType(column)}`);
  report.push(
    `Sheet "${name}" → table ${schema.name}: ${values.length} rows, ${columns.length} columns (header on row ${range.s.r + header + 1})` +
      (key ? `, key ${key.label}` : "") +
      (totals
        ? `, ${totals} totals row${totals > 1 ? "s" : ""} left out (the app adds them up itself)`
        : "") +
      ".",
  );
  if (kinds.length) report.push(`  ${kinds.join("; ")}.`);
  if (notes.length) report.push(`  ${notes.join("; ")}.`);
  return { schema, rows: values, sheet: name, headerRow: range.s.r + header + 1 };
}

function describeType(column: Column): string {
  switch (column.type) {
    case "currency":
      return `${column.currency ?? "EUR"} amounts`;
    case "enum":
      return `a choice of ${column.options?.length ?? 0}`;
    case "relation":
      return `links to ${column.relation}`;
    case "longtext":
      return "long text";
    default:
      return `${column.type}s`;
  }
}

/** Text columns whose values are another table's keys become links to that table. */
function linkTables(tables: ImportedTable[], report: string[]) {
  for (const table of tables) {
    for (const column of table.schema.columns) {
      if (column.type !== "text" && column.type !== "enum") continue;
      if (column.key === table.schema.key) continue;
      const values = table.rows
        .map((row) => row[column.key])
        .filter((value) => !isEmpty(value))
        .map(String);
      if (values.length < 2) continue;
      for (const other of tables) {
        if (other === table || !other.schema.key) continue;
        const keys = new Set(other.rows.map((row) => String(row[other.schema.key!] ?? "")));
        const found = values.filter((value) => keys.has(value)).length;
        if (found / values.length >= 0.9 && keys.size > 1) {
          column.type = "relation";
          column.relation = other.schema.name;
          delete column.options;
          report.push(`  ${table.schema.label}.${column.label} links to ${other.schema.label}.`);
          break;
        }
      }
    }
  }
}

export function importWorkbook(bytes: Uint8Array): WorkbookImport {
  if (bytes.byteLength > MAX_WORKBOOK_BYTES) throw new Error("That workbook is larger than 20 MB.");
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: "array",
      cellDates: true,
      cellFormula: true,
      cellNF: true,
      cellStyles: false,
      sheetRows: MAX_ROWS_PER_TABLE + HEADER_SCAN_ROWS,
      WTF: false,
    });
  } catch {
    throw new Error("That file could not be read as a spreadsheet (xlsx, xls, csv or ods).");
  }
  const report: string[] = [];
  const takenNames = new Set<string>();
  const tables: ImportedTable[] = [];
  workbook.SheetNames.forEach((name, index) => {
    const hidden = workbook.Workbook?.Sheets?.[index]?.Hidden;
    if (hidden) {
      report.push(`Sheet "${name}" is hidden, so it was left out.`);
      return;
    }
    if (tables.length >= MAX_TABLES) return;
    const sheet = workbook.Sheets[name];
    if (!sheet) return;
    const table = readSheet(name, sheet, takenNames, report);
    if (table) tables.push(table);
  });
  if (!tables.length)
    throw new Error("No sheet in that workbook has a header row with data under it.");
  linkTables(tables, report);
  return { tables, report };
}

/** A table as a spreadsheet, values typed so Excel sums and sorts them. */
export function exportTable(
  schema: TableSchema,
  rows: Array<Record<string, unknown>>,
  format: "xlsx" | "csv",
): Uint8Array {
  const header = schema.columns.map((column) => column.label);
  const body = rows.map((row) =>
    schema.columns.map((column) => {
      const value = column.formula ? evaluateFormula(column.formula, row) : row[column.key];
      if (value === null || value === undefined) return null;
      if (column.type === "image") return formatValue(column, value) || null;
      if (column.type === "date") {
        const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
        return Number.isNaN(date.getTime()) ? String(value) : date;
      }
      return value as string | number | boolean;
    }),
  );
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body], { cellDates: true });
  sheet["!cols"] = schema.columns.map((column) => ({
    wch: Math.min(40, Math.max(10, column.label.length + 2)),
  }));
  schema.columns.forEach((column, index) => {
    const format =
      column.type === "currency"
        ? `${column.currency === "GBP" ? "£" : column.currency === "USD" ? "$" : "€"}#,##0.00`
        : column.type === "percent"
          ? "0%"
          : column.type === "date"
            ? "dd mmm yyyy"
            : null;
    if (!format) return;
    for (let r = 1; r <= body.length; r++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c: index })];
      if (cell) cell.z = format;
    }
  });
  if (format === "csv") return new TextEncoder().encode(XLSX.utils.sheet_to_csv(sheet));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    sheet,
    schema.label.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1",
  );
  return new Uint8Array(
    XLSX.write(book, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer,
  );
}
