/** A1 addresses and rectangular ranges, 1-based like the file. No workbook needed. */

export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;

export type CellPos = { row: number; col: number };
/** Inclusive bounds with `top <= bottom` and `left <= right`. */
export type CellRange = { top: number; left: number; bottom: number; right: number };

export function columnLetters(col: number): string {
  let n = Math.floor(col);
  if (n < 1 || n > MAX_COLS) throw new RangeError(`Column ${col} is outside the sheet.`);
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function columnNumber(letters: string): number {
  const clean = letters.toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(clean)) return 0;
  let n = 0;
  for (const char of clean) n = n * 26 + (char.charCodeAt(0) - 64);
  return n <= MAX_COLS ? n : 0;
}

export function cellRef(pos: CellPos): string {
  return `${columnLetters(pos.col)}${pos.row}`;
}

/** "B2", "$B$2" or "b2"; null for anything else. */
export function parseCellRef(text: string): CellPos | null {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(text.trim());
  if (!match) return null;
  const col = columnNumber(match[1]!);
  const row = Number(match[2]);
  if (!col || row < 1 || row > MAX_ROWS) return null;
  return { row, col };
}

export function rangeOf(a: CellPos, b: CellPos): CellRange {
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col),
  };
}

export function isSingleCell(range: CellRange): boolean {
  return range.top === range.bottom && range.left === range.right;
}

export function rangeRef(range: CellRange): string {
  const start = cellRef({ row: range.top, col: range.left });
  return isSingleCell(range)
    ? start
    : `${start}:${cellRef({ row: range.bottom, col: range.right })}`;
}

/** "B2:D9", "D9:B2" (normalised) or a single cell; null for anything else. */
export function parseRangeRef(text: string): CellRange | null {
  const [first, second, extra] = text.trim().split(":");
  if (extra !== undefined || !first) return null;
  const a = parseCellRef(first);
  if (!a) return null;
  if (second === undefined) return rangeOf(a, a);
  const b = parseCellRef(second);
  return b ? rangeOf(a, b) : null;
}

export function rangeContains(range: CellRange, pos: CellPos): boolean {
  return (
    pos.row >= range.top &&
    pos.row <= range.bottom &&
    pos.col >= range.left &&
    pos.col <= range.right
  );
}

export function rangesOverlap(a: CellRange, b: CellRange): boolean {
  return a.top <= b.bottom && b.top <= a.bottom && a.left <= b.right && b.left <= a.right;
}

export function rangeSize(range: CellRange): number {
  return (range.bottom - range.top + 1) * (range.right - range.left + 1);
}

/** Excel quotes a sheet name unless it is a plain word that cannot be read as a cell address. */
export function quoteSheetName(name: string): string {
  const plain =
    /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !parseCellRef(name) && !/^R\d*C\d*$/i.test(name);
  return plain ? name : `'${name.replace(/'/g, "''")}'`;
}

/** "Sheet1!B2:D9", "'Q1 costs'!A1". */
export function qualifiedRef(sheet: string, range: CellRange): string {
  return `${quoteSheetName(sheet)}!${rangeRef(range)}`;
}

/** The inverse of qualifiedRef; null when it does not name a sheet and a range. */
export function parseQualifiedRef(text: string): { sheet: string; range: CellRange } | null {
  const bang = text.lastIndexOf("!");
  if (bang <= 0) return null;
  let sheet = text.slice(0, bang);
  if (sheet.startsWith("'")) {
    if (!sheet.endsWith("'") || sheet.length < 3) return null;
    sheet = sheet.slice(1, -1).replace(/''/g, "'");
  }
  const range = parseRangeRef(text.slice(bang + 1));
  return range && sheet ? { sheet, range } : null;
}
