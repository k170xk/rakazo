import type { Cell, CellValue, FormulaValue } from "@office-kit/xlsx/cell";
import { isFormulaValue, makeFormula } from "@office-kit/xlsx/cell";
import { fromArrayBuffer, loadWorkbook, workbookToBytes } from "@office-kit/xlsx/io";
import { cellStyleToCss, getCellDate, getCellDisplayText } from "@office-kit/xlsx/styles";
import type { Workbook } from "@office-kit/xlsx/workbook";
import { getSheet, setFullCalcOnLoad } from "@office-kit/xlsx/workbook";
import type { Worksheet } from "@office-kit/xlsx/worksheet";
import {
  getCell,
  getColumnDimension,
  getFreezePanes,
  getMaxCol,
  getMaxRow,
  getRowDimension,
  setCell,
  setColumnWidth,
  setFreezePanes,
} from "@office-kit/xlsx/worksheet";
import type { CellPos, CellRange } from "./address";
import { cellRef, parseCellRef, parseRangeRef, rangeContains } from "./address";

export type { Workbook, Worksheet };

/** What a load may build, so a huge file fails clearly instead of freezing a phone. */
const LOAD_LIMITS = { contentLimits: { maxCells: 2_000_000, maxRows: 500_000 } } as const;

export async function openWorkbook(bytes: Uint8Array): Promise<Workbook> {
  const copy = bytes.slice().buffer;
  return loadWorkbook(fromArrayBuffer(copy), LOAD_LIMITS);
}

export type SheetTab = { title: string; kind: "worksheet" | "chartsheet"; hidden: boolean };

export function sheetTabs(wb: Workbook): SheetTab[] {
  return wb.sheets.map((ref) => ({
    title: ref.sheet.title,
    kind: ref.kind,
    hidden: ref.state !== "visible",
  }));
}

/** The worksheet a tab names; undefined for a chart sheet or a missing title. */
export function worksheetOf(wb: Workbook, title: string): Worksheet | undefined {
  return getSheet(wb, title);
}

/** The tab that opens first: the file's active sheet when it is a visible worksheet. */
export function firstSheetTitle(wb: Workbook): string | undefined {
  const tabs = sheetTabs(wb);
  const active = tabs[wb.activeSheetIndex];
  if (active && active.kind === "worksheet" && !active.hidden) return active.title;
  return tabs.find((tab) => tab.kind === "worksheet" && !tab.hidden)?.title ?? tabs[0]?.title;
}

export type CellView = {
  text: string;
  /** Right-aligned unless the style says otherwise. */
  numeric: boolean;
  /** A formula whose result is only known once a spreadsheet app opens the file. */
  pending: boolean;
  styleId: number;
};

function cachedOf(value: CellValue): CellValue | undefined {
  return isFormulaValue(value) ? value.cachedValue : value;
}

export function cellView(wb: Workbook, cell: Cell): CellView {
  const value = cell.value;
  const shown = cachedOf(value);
  return {
    text: getCellDisplayText(wb, cell),
    numeric: typeof shown === "number" || shown instanceof Date,
    pending: isFormulaValue(value) && value.cachedValue === undefined && value.formula !== "",
    styleId: cell.styleId,
  };
}

const KEBAB = /-([a-z])/g;
const KEPT_CSS = new Set([
  "fontWeight",
  "fontStyle",
  "textDecoration",
  "color",
  "backgroundColor",
  "textAlign",
  "borderTop",
  "borderRight",
  "borderBottom",
  "borderLeft",
]);

const VERTICAL: Record<string, string> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
};

/** Wrapped text and top or middle alignment, laid out inside a fixed-height grid cell. */
export function layoutCss(
  vertical: string | undefined,
  whiteSpace: string | undefined,
): Record<string, string> {
  const wrap = whiteSpace === "pre-wrap" || whiteSpace === "normal";
  const justify = vertical ? VERTICAL[vertical] : undefined;
  if (!wrap && !justify) return {};
  return {
    display: "flex",
    flexDirection: "column",
    justifyContent: justify ?? "flex-end",
    lineHeight: "1.25",
    ...(wrap ? { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } : {}),
  };
}

/**
 * The cell's look for the grid, cached per style. Font family and size are left to the grid so
 * rows keep a steady height.
 */
export function styleCache(wb: Workbook): (cell: Cell) => Record<string, string> {
  const cache = new Map<number, Record<string, string>>();
  return (cell) => {
    const hit = cache.get(cell.styleId);
    if (hit) return hit;
    const css: Record<string, string> = {};
    if (cell.styleId) {
      const all = cellStyleToCss(wb, cell);
      for (const [key, value] of Object.entries(all)) {
        const name = key.replace(KEBAB, (_, char: string) => char.toUpperCase());
        if (KEPT_CSS.has(name)) css[name] = value;
      }
      Object.assign(css, layoutCss(all["vertical-align"], all["white-space"]));
    }
    cache.set(cell.styleId, css);
    return css;
  };
}

function isoDate(date: Date): string {
  const iso = date.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 19).replace("T", " ");
}

function looksTyped(text: string): boolean {
  return /^[=']/.test(text) || parseNumber(text) !== null || /^(true|false)$/i.test(text);
}

/** What the formula bar shows and what editing starts from: the formula, or the stored value. */
export function rawInput(wb: Workbook, cell: Cell | undefined): string {
  if (!cell) return "";
  const value = cell.value;
  if (value === null) return "";
  if (isFormulaValue(value)) {
    return value.formula ? `=${value.formula}` : getCellDisplayText(wb, cell);
  }
  if (typeof value === "number") {
    const date = getCellDate(wb, cell);
    return date ? isoDate(date) : String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return isoDate(value);
  if (typeof value === "string") return looksTyped(value) ? `'${value}` : value;
  if (value.kind === "rich-text") return value.runs.map((run) => run.text).join("");
  if (value.kind === "error") return value.code;
  return getCellDisplayText(wb, cell);
}

function parseNumber(text: string): number | null {
  const clean = text.trim();
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(clean)) return Number(clean);
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(clean)) return Number(clean.replace(/,/g, ""));
  return null;
}

export class FormulaInputError extends Error {}

/**
 * What typing `text` into a cell stores, the way a spreadsheet reads it: `=` starts a formula,
 * a leading `'` keeps text, numbers and TRUE/FALSE are values, and a date typed into a
 * date-formatted cell stays a date. Anything else is text.
 */
export function parseInput(wb: Workbook, existing: Cell | undefined, text: string): CellValue {
  if (text === "") return null;
  if (text.startsWith("'")) return text.slice(1);
  if (text.startsWith("=") && text.trim().length > 1) {
    // The last known result stays shown until a spreadsheet app recalculates the file.
    const prior = existing && isFormulaValue(existing.value) ? existing.value : undefined;
    try {
      return makeFormula(
        text.trim(),
        prior?.cachedValue === undefined
          ? undefined
          : { cachedValue: prior.cachedValue, cachedValueType: prior.cachedValueType },
      );
    } catch {
      throw new FormulaInputError(text);
    }
  }
  if (/^(true|false)$/i.test(text.trim())) return text.trim().toUpperCase() === "TRUE";
  const number = parseNumber(text);
  if (number !== null) return number;
  const dated = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text.trim());
  if (dated && existing && getCellDate(wb, existing)) {
    const [, y, m, d, hh = "0", mm = "0", ss = "0"] = dated;
    const date = new Date(
      Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)),
    );
    if (!Number.isNaN(date.getTime()) && date.getUTCDate() === Number(d)) return date;
  }
  return text;
}

export type LockReason = "shared" | "array" | "table";

/** Cells an edit here would break: formulas other cells share, array results and table headers. */
export type LockedRange = { range: CellRange; reason: LockReason };

export function lockedRanges(ws: Worksheet): LockedRange[] {
  const locked: LockedRange[] = [];
  for (const row of ws.rows.values()) {
    for (const cell of row.values()) {
      const value = cell.value;
      if (!isFormulaValue(value)) continue;
      const formula = value as FormulaValue;
      if (formula.t === "normal") continue;
      const own = { top: cell.row, left: cell.col, bottom: cell.row, right: cell.col };
      if (formula.t === "shared") {
        // Only the cell that carries the text matters; the others just point at it.
        if (formula.formula) locked.push({ range: own, reason: "shared" });
        continue;
      }
      const spread = formula.ref ? parseRangeRef(formula.ref) : null;
      locked.push({ range: spread ?? own, reason: "array" });
    }
  }
  for (const table of ws.tables) {
    const range = parseRangeRef(table.ref);
    if (!range || table.headerRowCount === 0) continue;
    locked.push({ range: { ...range, bottom: range.top }, reason: "table" });
  }
  return locked;
}

export function lockAt(locked: readonly LockedRange[], pos: CellPos): LockReason | null {
  return locked.find((entry) => rangeContains(entry.range, pos))?.reason ?? null;
}

/** Writes typed text into a cell; false when it stores what was there already. */
export function applyInput(wb: Workbook, ws: Worksheet, pos: CellPos, text: string): boolean {
  const existing = getCell(ws, pos.row, pos.col);
  if (text === rawInput(wb, existing)) return false;
  const value = parseInput(wb, existing, text);
  if (value === null && !existing) return false;
  // An existing cell keeps its style, so a cleared cell keeps its formatting as Delete does.
  setCell(ws, pos.row, pos.col, value);
  return true;
}

/** Delete over a range: values go, formatting stays. Returns how many cells changed. */
export function clearRange(
  ws: Worksheet,
  range: CellRange,
  locked: readonly LockedRange[] = [],
): number {
  let changed = 0;
  for (let row = range.top; row <= range.bottom; row += 1) {
    const cells = ws.rows.get(row);
    if (!cells) continue;
    for (const cell of cells.values()) {
      if (cell.col < range.left || cell.col > range.right || cell.value === null) continue;
      if (lockAt(locked, cell)) continue;
      setCell(ws, cell.row, cell.col, null);
      changed += 1;
    }
  }
  return changed;
}

/** Tab-separated text of a range, for the clipboard. */
export function rangeText(wb: Workbook, ws: Worksheet, range: CellRange): string {
  const lines: string[] = [];
  for (let row = range.top; row <= range.bottom; row += 1) {
    const cells: string[] = [];
    for (let col = range.left; col <= range.right; col += 1) {
      const cell = getCell(ws, row, col);
      cells.push(cell ? getCellDisplayText(wb, cell).replace(/[\t\n]/g, " ") : "");
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

/** Clipboard text as rows of cells. A trailing newline does not add a row. */
export function parsePastedText(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  return lines.map((line) => line.split("\t"));
}

const DEFAULT_COLUMN_PX = 64;
const DEFAULT_ROW_PX = 20;

/** Stored width (characters plus padding) to screen pixels, as a spreadsheet app draws it. */
export function widthToPx(width: number): number {
  return Math.max(0, Math.trunc(width * 7 + 0.5));
}

export function pxToWidth(px: number): number {
  return Math.trunc((Math.max(px, 8) / 7) * 256) / 256;
}

export function columnPx(ws: Worksheet, col: number): number {
  const dim = getColumnDimension(ws, col);
  if (dim?.hidden) return 0;
  if (dim?.width !== undefined) return widthToPx(dim.width);
  return ws.defaultColumnWidth !== undefined ? widthToPx(ws.defaultColumnWidth) : DEFAULT_COLUMN_PX;
}

export function rowPx(ws: Worksheet, row: number): number {
  const dim = getRowDimension(ws, row);
  if (dim?.hidden) return 0;
  const points = dim?.height ?? ws.defaultRowHeight;
  return points !== undefined ? Math.max(0, Math.round((points * 4) / 3)) : DEFAULT_ROW_PX;
}

export function setColumnPx(ws: Worksheet, col: number, px: number): void {
  setColumnWidth(ws, col, pxToWidth(px));
}

export function freezeCounts(ws: Worksheet): { rows: number; cols: number } {
  const ref = getFreezePanes(ws);
  const pos = ref ? parseCellRef(ref) : null;
  return pos ? { rows: pos.row - 1, cols: pos.col - 1 } : { rows: 0, cols: 0 };
}

export function setFreeze(ws: Worksheet, rows: number, cols: number): void {
  if (rows <= 0 && cols <= 0) setFreezePanes(ws, undefined);
  else setFreezePanes(ws, { rows: Math.max(0, rows), cols: Math.max(0, cols) });
}

/** How far the grid draws: the used area plus room to type past it. */
export function gridExtent(ws: Worksheet): { rows: number; cols: number } {
  return {
    rows: Math.min(Math.max(getMaxRow(ws) + 100, 200), 1_048_576),
    cols: Math.min(Math.max(getMaxCol(ws) + 8, 26), 16_384),
  };
}

export function mergedRanges(ws: Worksheet): CellRange[] {
  return ws.mergedCells.map((merge) => ({
    top: merge.minRow,
    left: merge.minCol,
    bottom: merge.maxRow,
    right: merge.maxCol,
  }));
}

/** Charts and pictures placed on the sheet, which the grid does not draw but the file keeps. */
export function hasDrawings(ws: Worksheet): boolean {
  return (ws.drawing?.items.length ?? 0) > 0;
}

/** What a reload of a saved file must show again in a cell. */
export type SavedExpectation = { sheet: string; pos: CellPos; raw: string };

export class SaveCheckError extends Error {}

/**
 * The file to upload. Formulas are not calculated here, so the file asks to be recalculated when
 * it opens; the bytes are reloaded and checked before anything is sent.
 */
export async function saveVerified(
  wb: Workbook,
  expectations: readonly SavedExpectation[],
): Promise<Uint8Array> {
  setFullCalcOnLoad(wb, true);
  const bytes = await workbookToBytes(wb);
  let reloaded: Workbook;
  try {
    reloaded = await openWorkbook(bytes);
  } catch (error) {
    throw new SaveCheckError("The saved file did not open again.", { cause: error });
  }
  const before = wb.sheets.map((ref) => ref.sheet.title).join("\n");
  const after = reloaded.sheets.map((ref) => ref.sheet.title).join("\n");
  if (before !== after) throw new SaveCheckError("The saved file lost a sheet.");
  for (const expected of expectations) {
    const ws = getSheet(reloaded, expected.sheet);
    const shown = ws ? rawInput(reloaded, getCell(ws, expected.pos.row, expected.pos.col)) : null;
    if (shown !== expected.raw) {
      throw new SaveCheckError(`${expected.sheet}!${cellRef(expected.pos)} did not save.`);
    }
  }
  return bytes;
}

function signature(wb: Workbook, cell: Cell): string {
  return `${rawInput(wb, cell)}\u0000${getCellDisplayText(wb, cell)}`;
}

/** Cells whose value or shown text differ between two loads of a sheet; at most `limit`. */
export function changedCells(
  before: Workbook,
  after: Workbook,
  title: string,
  limit = 2000,
): Set<string> {
  const changed = new Set<string>();
  const old = getSheet(before, title);
  const next = getSheet(after, title);
  if (!old || !next) return changed;
  const seen = new Set<string>();
  for (const row of next.rows.values()) {
    for (const cell of row.values()) {
      const key = cellRef(cell);
      seen.add(key);
      const prior = getCell(old, cell.row, cell.col);
      const was = prior ? signature(before, prior) : "\u0000";
      if (was !== signature(after, cell)) changed.add(key);
      if (changed.size >= limit) return changed;
    }
  }
  for (const row of old.rows.values()) {
    for (const cell of row.values()) {
      const key = cellRef(cell);
      if (seen.has(key) || cell.value === null) continue;
      changed.add(key);
      if (changed.size >= limit) return changed;
    }
  }
  return changed;
}
