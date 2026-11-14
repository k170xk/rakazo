import type { Cell, CellValue } from "@office-kit/xlsx/cell";
import { isFormulaValue, isRichTextValue } from "@office-kit/xlsx/cell";
import type { HorizontalAlignment, VerticalAlignment } from "@office-kit/xlsx/styles";
import {
  clearCellBackground,
  clearRangeStyle,
  getCellAlignment,
  getCellBorder,
  getCellFill,
  getCellFont,
  getCellNumberFormat,
  makeBorder,
  patchCellFont,
  setCellBorder,
  setRangeAlignment,
  setRangeBackgroundColor,
  setRangeBorderBox,
  setRangeNumberFormat,
  setRangeWrapText,
} from "@office-kit/xlsx/styles";
import type { Workbook } from "@office-kit/xlsx/workbook";
import { addWorksheet, removeSheet, renameSheet } from "@office-kit/xlsx/workbook";
import type { Worksheet } from "@office-kit/xlsx/worksheet";
import {
  deleteRows,
  ensureCell,
  getCell,
  getMaxCol,
  getMaxRow,
  insertRows,
  mergeCells,
  setCell,
  setSheetZoom,
  unmergeCells,
} from "@office-kit/xlsx/worksheet";
import type { CellPos, CellRange } from "./address";
import { cellRef, columnLetters, rangeSize, rangesOverlap } from "./address";
import { mergedRanges, sheetTabs } from "./workbook";

/** The most cells one formatting change touches; bigger selections are trimmed to the used area. */
export const MAX_FORMAT_CELLS = 100_000;

export type FontToggle = "bold" | "italic" | "underline" | "strike";
export type BorderKind = "all" | "outside" | "none";

export type CellLook = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  horizontal: HorizontalAlignment | null;
  vertical: VerticalAlignment | null;
  wrap: boolean;
  numberFormat: string;
};

function refOf(range: CellRange): string {
  return `${cellRef({ row: range.top, col: range.left })}:${cellRef({ row: range.bottom, col: range.right })}`;
}

/**
 * The part of `range` a formatting change applies to: all of it when small, otherwise only the
 * rows and columns in use, so selecting whole columns does not create a million empty cells.
 * Null when even that is too big.
 */
export function formatTarget(ws: Worksheet, range: CellRange): CellRange | null {
  if (rangeSize(range) <= MAX_FORMAT_CELLS) return range;
  const trimmed = {
    top: range.top,
    left: range.left,
    bottom: Math.min(range.bottom, Math.max(range.top, getMaxRow(ws))),
    right: Math.min(range.right, Math.max(range.left, getMaxCol(ws))),
  };
  return rangeSize(trimmed) <= MAX_FORMAT_CELLS ? trimmed : null;
}

function eachCell(ws: Worksheet, range: CellRange, run: (cell: Cell) => void) {
  for (let row = range.top; row <= range.bottom; row += 1) {
    for (let col = range.left; col <= range.right; col += 1) run(ensureCell(ws, row, col));
  }
}

function eachExisting(ws: Worksheet, range: CellRange, run: (cell: Cell) => void) {
  for (let row = range.top; row <= range.bottom; row += 1) {
    const cells = ws.rows.get(row);
    if (!cells) continue;
    for (const cell of cells.values()) {
      if (cell.col >= range.left && cell.col <= range.right) run(cell);
    }
  }
}

export function cellLook(wb: Workbook, ws: Worksheet, pos: CellPos): CellLook {
  const cell = getCell(ws, pos.row, pos.col);
  if (!cell) {
    return {
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      horizontal: null,
      vertical: null,
      wrap: false,
      numberFormat: "General",
    };
  }
  const font = getCellFont(wb, cell);
  const align = getCellAlignment(wb, cell);
  return {
    bold: font.bold === true,
    italic: font.italic === true,
    underline: font.underline !== undefined && font.underline !== "none",
    strike: font.strike === true,
    horizontal: align.horizontal ?? null,
    vertical: align.vertical ?? null,
    wrap: align.wrapText === true,
    numberFormat: getCellNumberFormat(wb, cell),
  };
}

/** Turns a font style on or off across the range. */
export function setFontStyle(
  wb: Workbook,
  ws: Worksheet,
  range: CellRange,
  style: FontToggle,
  on: boolean,
): void {
  const patch =
    style === "underline"
      ? { underline: on ? ("single" as const) : undefined }
      : { [style]: on || undefined };
  eachCell(ws, range, (cell) => patchCellFont(wb, cell, patch));
}

/** `#RRGGBB` as the file stores colours. */
function argb(hex: string): string {
  return `FF${hex.replace("#", "").toUpperCase()}`;
}

export function setFontColor(
  wb: Workbook,
  ws: Worksheet,
  range: CellRange,
  hex: string | null,
): void {
  const color = hex ? { rgb: argb(hex) } : undefined;
  eachCell(ws, range, (cell) => patchCellFont(wb, cell, { color }));
}

export function setFillColor(
  wb: Workbook,
  ws: Worksheet,
  range: CellRange,
  hex: string | null,
): void {
  if (hex) setRangeBackgroundColor(wb, ws, refOf(range), argb(hex));
  else eachExisting(ws, range, (cell) => clearCellBackground(wb, cell));
}

export function fillColorOf(wb: Workbook, ws: Worksheet, pos: CellPos): string | null {
  const cell = getCell(ws, pos.row, pos.col);
  const fill = cell ? getCellFill(wb, cell) : null;
  const rgb = fill && fill.kind === "pattern" ? fill.fgColor?.rgb : undefined;
  return rgb ? `#${rgb.slice(-6)}` : null;
}

export function setHorizontal(
  wb: Workbook,
  ws: Worksheet,
  range: CellRange,
  horizontal: HorizontalAlignment,
): void {
  setRangeAlignment(wb, ws, refOf(range), { horizontal });
}

export function setVertical(
  wb: Workbook,
  ws: Worksheet,
  range: CellRange,
  vertical: VerticalAlignment,
): void {
  setRangeAlignment(wb, ws, refOf(range), { vertical });
}

export function setWrap(wb: Workbook, ws: Worksheet, range: CellRange, on: boolean): void {
  setRangeWrapText(wb, ws, refOf(range), on);
}

export type MergeResult = "merged" | "single" | "values" | "overlap";

/**
 * Merges the range. Refuses when more than the top-left cell holds a value, so nothing typed is
 * lost, or when it would cut through another merged block.
 */
export function mergeRange(
  ws: Worksheet,
  range: CellRange,
  center: boolean,
  wb?: Workbook,
): MergeResult {
  if (range.top === range.bottom && range.left === range.right) return "single";
  let filled = 0;
  eachExisting(ws, range, (cell) => {
    if (cell.value !== null && (cell.row !== range.top || cell.col !== range.left)) filled += 1;
  });
  if (filled > 0) return "values";
  const others = mergedRanges(ws).filter((merge) => rangesOverlap(merge, range));
  if (others.some((merge) => !inside(merge, range))) return "overlap";
  for (const merge of others) unmergeCells(ws, refOf(merge));
  mergeCells(ws, refOf(range));
  if (center && wb) {
    setRangeAlignment(wb, ws, refOf({ ...range, bottom: range.top, right: range.left }), {
      horizontal: "center",
      vertical: "center",
    });
  }
  return "merged";
}

function inside(inner: CellRange, outer: CellRange): boolean {
  return (
    inner.top >= outer.top &&
    inner.bottom <= outer.bottom &&
    inner.left >= outer.left &&
    inner.right <= outer.right
  );
}

/** Splits every merged block the range touches; returns how many were split. */
export function unmergeRange(ws: Worksheet, range: CellRange): number {
  const touched = mergedRanges(ws).filter((merge) => rangesOverlap(merge, range));
  for (const merge of touched) unmergeCells(ws, refOf(merge));
  return touched.length;
}

export const NUMBER_FORMATS = {
  general: "General",
  number: "#,##0.00",
  pounds: "£#,##0.00",
  euros: "€#,##0.00",
  dollars: "$#,##0.00",
  percent: "0%",
  date: "dd/mm/yyyy",
  text: "@",
} as const;

export type NumberFormatKey = keyof typeof NUMBER_FORMATS;

export function setNumberFormat(wb: Workbook, ws: Worksheet, range: CellRange, code: string): void {
  setRangeNumberFormat(wb, ws, refOf(range), code);
}

const QUOTED = /"[^"]*"|\\./g;
const DIGITS = /([#0?,]*[0#?])(\.([0#?]*))?/;

/** One format section with one decimal place more or fewer; quoted text is left alone. */
function stepSection(section: string, direction: 1 | -1): string {
  const masked = section.replace(QUOTED, (part) => "\u0000".repeat(part.length));
  const match = DIGITS.exec(masked);
  if (!match || match.index === undefined) return section;
  const start = match.index;
  const whole = match[0];
  const integer = match[1] ?? "";
  const decimals = match[3] ?? "";
  let next: string;
  if (direction > 0) next = `${integer}.${decimals}0`;
  else if (decimals.length > 1) next = `${integer}.${decimals.slice(0, -1)}`;
  else next = integer;
  return section.slice(0, start) + next + section.slice(start + whole.length);
}

/**
 * The number format with one more or one fewer decimal place, as the ribbon's decimal buttons
 * change it. General becomes a fixed format based on the decimals the value shows now.
 */
export function stepDecimals(code: string, direction: 1 | -1, shownDecimals = 0): string {
  if (code === "General" || code === "") {
    const places = Math.max(0, shownDecimals + direction);
    return places > 0 ? `0.${"0".repeat(places)}` : "0";
  }
  if (code === "@") return code;
  return code
    .split(";")
    .map((section) => stepSection(section, direction))
    .join(";");
}

/** How many decimal places a number shows when nothing formats it. */
export function decimalsOf(value: CellValue): number {
  const shown = isFormulaValue(value) ? value.cachedValue : value;
  if (typeof shown !== "number" || !Number.isFinite(shown)) return 0;
  const text = String(shown);
  const dot = text.indexOf(".");
  return dot < 0 || text.includes("e") ? 0 : Math.min(10, text.length - dot - 1);
}

export function setBorders(wb: Workbook, ws: Worksheet, range: CellRange, kind: BorderKind): void {
  const ref = refOf(range);
  if (kind === "all") setRangeBorderBox(wb, ws, ref, { style: "thin", inner: "thin" });
  else if (kind === "outside") setRangeBorderBox(wb, ws, ref, { style: "thin" });
  else eachExisting(ws, range, (cell) => setCellBorder(wb, cell, makeBorder()));
}

export function hasBorder(wb: Workbook, ws: Worksheet, pos: CellPos): boolean {
  const cell = getCell(ws, pos.row, pos.col);
  if (!cell) return false;
  const border = getCellBorder(wb, cell);
  return [border.top, border.bottom, border.left, border.right].some(
    (side) => side?.style !== undefined && side.style !== "none",
  );
}

/** Clear Formats: every cell in the range goes back to the default look; values stay. */
export function clearFormats(wb: Workbook, ws: Worksheet, range: CellRange): void {
  clearRangeStyle(wb, ws, refOf(range));
}

export function insertRowsAt(wb: Workbook, ws: Worksheet, at: number, count: number): void {
  insertRows(wb, ws, at, count);
}

export function deleteRowsAt(wb: Workbook, ws: Worksheet, at: number, count: number): void {
  deleteRows(wb, ws, at, count);
}

/** A name like "Sheet4" that no sheet has yet. */
export function freshSheetName(wb: Workbook, base = "Sheet"): string {
  const taken = new Set(sheetTabs(wb).map((tab) => tab.title.toLowerCase()));
  for (let n = taken.size + 1; ; n += 1) {
    const name = `${base}${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** Adds an empty sheet after `after` (or at the end); returns its name. */
export function addSheet(wb: Workbook, after: string | null, base?: string): string {
  const name = freshSheetName(wb, base);
  const at = after ? wb.sheets.findIndex((ref) => ref.sheet.title === after) : -1;
  addWorksheet(wb, name, at >= 0 ? { index: at + 1 } : undefined);
  return name;
}

export type SheetNameProblem = "empty" | "long" | "characters" | "quote" | "taken";

/** Why a spreadsheet app would refuse a sheet name, or null when it is fine. */
export function sheetNameProblem(
  wb: Workbook,
  current: string,
  name: string,
): SheetNameProblem | null {
  if (!name.trim()) return "empty";
  if (name.length > 31) return "long";
  if (/[\\/?*[\]:]/.test(name)) return "characters";
  if (name.startsWith("'") || name.endsWith("'")) return "quote";
  const lower = name.toLowerCase();
  if (
    lower !== current.toLowerCase() &&
    sheetTabs(wb).some((tab) => tab.title.toLowerCase() === lower)
  ) {
    return "taken";
  }
  if (lower === "history") return "taken";
  return null;
}

export function renameSheetTo(
  wb: Workbook,
  current: string,
  name: string,
): SheetNameProblem | null {
  const problem = sheetNameProblem(wb, current, name);
  if (problem) return problem;
  if (name !== current) renameSheet(wb, current, name);
  return null;
}

/** Deletes a sheet unless it is the last visible worksheet. Returns whether it went. */
export function deleteSheet(wb: Workbook, title: string): boolean {
  const visible = sheetTabs(wb).filter((tab) => !tab.hidden && tab.kind === "worksheet");
  if (visible.length <= 1 && visible.some((tab) => tab.title === title)) return false;
  removeSheet(wb, title);
  return true;
}

function isNumberCell(cell: Cell | undefined): boolean {
  if (!cell) return false;
  const value = isFormulaValue(cell.value) ? cell.value.cachedValue : cell.value;
  return (
    typeof value === "number" ||
    (isFormulaValue(cell.value) && cell.value.cachedValue === undefined)
  );
}

/**
 * AutoSum for the cell at `pos`: the SUM of the numbers just above it, or else just to its left,
 * as a spreadsheet app guesses it. `=SUM()` when there is nothing to add up.
 */
export function autoSumFormula(ws: Worksheet, pos: CellPos): string {
  const above = (row: number) => getCell(ws, row, pos.col);
  let top = pos.row - 1;
  while (top >= 1 && isNumberCell(above(top))) top -= 1;
  if (top < pos.row - 1) {
    return `=SUM(${columnLetters(pos.col)}${top + 1}:${columnLetters(pos.col)}${pos.row - 1})`;
  }
  let left = pos.col - 1;
  while (left >= 1 && isNumberCell(getCell(ws, pos.row, left))) left -= 1;
  if (left < pos.col - 1) {
    return `=SUM(${columnLetters(left + 1)}${pos.row}:${columnLetters(pos.col - 1)}${pos.row})`;
  }
  return "=SUM()";
}

export type FunctionGroup = "common" | "logical" | "lookup" | "text" | "date" | "maths";

export const FUNCTIONS: readonly { name: string; group: FunctionGroup }[] = [
  { name: "SUM", group: "common" },
  { name: "AVERAGE", group: "common" },
  { name: "COUNT", group: "common" },
  { name: "COUNTA", group: "common" },
  { name: "MIN", group: "common" },
  { name: "MAX", group: "common" },
  { name: "IF", group: "logical" },
  { name: "IFS", group: "logical" },
  { name: "IFERROR", group: "logical" },
  { name: "AND", group: "logical" },
  { name: "OR", group: "logical" },
  { name: "SUMIF", group: "maths" },
  { name: "SUMIFS", group: "maths" },
  { name: "COUNTIF", group: "maths" },
  { name: "COUNTIFS", group: "maths" },
  { name: "AVERAGEIF", group: "maths" },
  { name: "ROUND", group: "maths" },
  { name: "ROUNDUP", group: "maths" },
  { name: "ROUNDDOWN", group: "maths" },
  { name: "ABS", group: "maths" },
  { name: "SUMPRODUCT", group: "maths" },
  { name: "XLOOKUP", group: "lookup" },
  { name: "VLOOKUP", group: "lookup" },
  { name: "INDEX", group: "lookup" },
  { name: "MATCH", group: "lookup" },
  { name: "CONCAT", group: "text" },
  { name: "TEXTJOIN", group: "text" },
  { name: "LEFT", group: "text" },
  { name: "RIGHT", group: "text" },
  { name: "MID", group: "text" },
  { name: "LEN", group: "text" },
  { name: "TRIM", group: "text" },
  { name: "UPPER", group: "text" },
  { name: "LOWER", group: "text" },
  { name: "TEXT", group: "text" },
  { name: "TODAY", group: "date" },
  { name: "NOW", group: "date" },
  { name: "DATE", group: "date" },
  { name: "EOMONTH", group: "date" },
  { name: "NETWORKDAYS", group: "date" },
];

/** What the formula bar holds after picking a function: it is added to a formula being typed. */
export function insertFunction(current: string, name: string): string {
  const text = current.trimEnd();
  if (!text.startsWith("=")) return `=${name}(`;
  const needsComma = /[\w)"]$/.test(text) && text !== "=";
  return `${text}${needsComma ? "," : ""}${name}(`;
}

/**
 * The block of filled cells around `pos`, as a spreadsheet app picks it when one cell is
 * selected: grown a row or column at a time while any neighbouring cell has something in it.
 */
export function currentRegion(ws: Worksheet, pos: CellPos): CellRange {
  const filled = (row: number, col: number) => {
    const cell = getCell(ws, row, col);
    return cell !== undefined && cell.value !== null;
  };
  const region = { top: pos.row, left: pos.col, bottom: pos.row, right: pos.col };
  const lineFilled = (fixed: "row" | "col", at: number, from: number, to: number) => {
    for (let i = Math.max(1, from); i <= to; i += 1) {
      if (fixed === "row" ? filled(at, i) : filled(i, at)) return true;
    }
    return false;
  };
  for (let grew = true; grew; ) {
    grew = false;
    if (region.top > 1 && lineFilled("row", region.top - 1, region.left - 1, region.right + 1)) {
      region.top -= 1;
      grew = true;
    }
    if (lineFilled("row", region.bottom + 1, region.left - 1, region.right + 1)) {
      region.bottom += 1;
      grew = true;
    }
    if (region.left > 1 && lineFilled("col", region.left - 1, region.top - 1, region.bottom + 1)) {
      region.left -= 1;
      grew = true;
    }
    if (lineFilled("col", region.right + 1, region.top - 1, region.bottom + 1)) {
      region.right += 1;
      grew = true;
    }
  }
  return region;
}

function plainText(value: CellValue): string | null {
  if (typeof value === "string") return value;
  if (isRichTextValue(value)) return value.runs.map((run) => run.text).join("");
  return null;
}

/** Whether the first row of a region reads as headings: all text, over rows that are not. */
export function looksLikeHeader(ws: Worksheet, region: CellRange): boolean {
  if (region.bottom <= region.top) return false;
  let firstAllText = true;
  for (let col = region.left; col <= region.right; col += 1) {
    const value = getCell(ws, region.top, col)?.value ?? null;
    if (value !== null && plainText(value) === null) firstAllText = false;
  }
  if (!firstAllText) return false;
  for (let col = region.left; col <= region.right; col += 1) {
    const value = getCell(ws, region.top + 1, col)?.value ?? null;
    if (value !== null && plainText(value) === null) return true;
  }
  return false;
}

export type SortResult = "sorted" | "formulas" | "merged" | "nothing";

type SortKey = { rank: number; number: number; text: string };

function sortKey(value: CellValue | undefined): SortKey {
  if (value === null || value === undefined) return { rank: 4, number: 0, text: "" };
  if (typeof value === "number") return { rank: 0, number: value, text: "" };
  if (value instanceof Date) return { rank: 0, number: value.getTime(), text: "" };
  const text = plainText(value);
  if (text !== null)
    return text.trim() ? { rank: 1, number: 0, text } : { rank: 4, number: 0, text: "" };
  if (typeof value === "boolean") return { rank: 2, number: value ? 1 : 0, text: "" };
  return { rank: 3, number: 0, text: "" };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Sorts the rows of `range` by column `byCol`, smallest first or last, keeping each row's values
 * and formatting together. Blanks always go last. Refuses ranges holding formulas or merged
 * cells, since moving those would change what they mean.
 */
export function sortRows(
  ws: Worksheet,
  range: CellRange,
  byCol: number,
  descending: boolean,
): SortResult {
  if (range.bottom <= range.top) return "nothing";
  if (mergedRanges(ws).some((merge) => rangesOverlap(merge, range))) return "merged";
  let formulas = false;
  eachExisting(ws, range, (cell) => {
    if (isFormulaValue(cell.value)) formulas = true;
  });
  if (formulas) return "formulas";

  type Row = { key: SortKey; cells: { value: CellValue; styleId: number }[]; at: number };
  const rows: Row[] = [];
  for (let row = range.top; row <= range.bottom; row += 1) {
    const cells: Row["cells"] = [];
    for (let col = range.left; col <= range.right; col += 1) {
      const cell = getCell(ws, row, col);
      cells.push({ value: cell?.value ?? null, styleId: cell?.styleId ?? 0 });
    }
    rows.push({ key: sortKey(getCell(ws, row, byCol)?.value), cells, at: row });
  }
  const sign = descending ? -1 : 1;
  const sorted = [...rows].sort((a, b) => {
    if (a.key.rank !== b.key.rank) {
      if (a.key.rank === 4 || b.key.rank === 4) return a.key.rank - b.key.rank;
      return sign * (a.key.rank - b.key.rank);
    }
    const diff =
      a.key.rank === 1 ? collator.compare(a.key.text, b.key.text) : a.key.number - b.key.number;
    return diff !== 0 ? sign * diff : a.at - b.at;
  });
  if (sorted.every((row, i) => row === rows[i])) return "sorted";
  sorted.forEach((source, i) => {
    const row = range.top + i;
    source.cells.forEach((cell, j) => {
      const col = range.left + j;
      const existing = getCell(ws, row, col);
      if (!existing && cell.value === null && cell.styleId === 0) return;
      setCell(ws, row, col, cell.value, cell.styleId);
    });
  });
  return "sorted";
}

export function gridlinesShown(ws: Worksheet): boolean {
  return ws.views[0]?.showGridLines !== false;
}

export function setGridlines(ws: Worksheet, show: boolean): void {
  // The library's own gridline setter is not exported at runtime; a zoom write creates the view.
  if (!ws.views[0]) setSheetZoom(ws, 100);
  const view = ws.views[0];
  if (view) ws.views[0] = { ...view, showGridLines: show };
}

/** The sheet's saved zoom as a fraction, 1 being 100%. */
export function sheetZoom(ws: Worksheet): number {
  const percent = ws.views[0]?.zoomScale;
  return percent && percent >= 10 && percent <= 400 ? percent / 100 : 1;
}

export function setZoom(ws: Worksheet, zoom: number): void {
  setSheetZoom(ws, Math.round(Math.min(4, Math.max(0.1, zoom)) * 100));
}
