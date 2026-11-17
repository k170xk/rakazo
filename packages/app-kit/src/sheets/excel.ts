import * as XLSX from "xlsx";
import type { Cell, Sheet } from "./csv.js";

const MAX_SHEETS = 30;
const MAX_ROWS = 20_000;
const MAX_COLUMNS = 200;

function sheetName(name: string, taken: Set<string>): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Sheet";
  let candidate = cleaned;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${cleaned.slice(0, 28)} ${n}`;
  taken.add(candidate);
  return candidate;
}

function cellValue(value: unknown): Cell {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/** An .xlsx workbook as bytes. */
export function writeSheets(sheets: Sheet[]): Uint8Array {
  if (!sheets.length) throw new Error("A workbook needs at least one sheet.");
  if (sheets.length > MAX_SHEETS) throw new Error(`A workbook can have at most ${MAX_SHEETS} sheets.`);
  const book = XLSX.utils.book_new();
  const taken = new Set<string>();
  for (const sheet of sheets) {
    if (sheet.rows.length > MAX_ROWS) throw new Error(`"${sheet.name}" has more than ${MAX_ROWS} rows.`);
    const width = Math.max(0, ...sheet.rows.map((row) => row.length));
    if (width > MAX_COLUMNS) throw new Error(`"${sheet.name}" has more than ${MAX_COLUMNS} columns.`);
    const grid = sheet.rows.map((row) => row.map((cell) => (cell === null ? "" : cell)));
    const page = XLSX.utils.aoa_to_sheet(grid);
    XLSX.utils.book_append_sheet(book, page, sheetName(sheet.name, taken));
  }
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Uint8Array(bytes);
}

/** Sheets from an .xlsx file the person dropped in. */
export function readSheets(data: ArrayBuffer | Uint8Array): Sheet[] {
  const book = XLSX.read(data, { type: "array", cellDates: true });
  return book.SheetNames.slice(0, MAX_SHEETS).map((name) => {
    const page = book.Sheets[name];
    const grid = page ? (XLSX.utils.sheet_to_json(page, { header: 1, raw: true, defval: null }) as unknown[][]) : [];
    return {
      name,
      rows: grid.slice(0, MAX_ROWS).map((row) => (Array.isArray(row) ? row : []).slice(0, MAX_COLUMNS).map(cellValue)),
    };
  });
}
