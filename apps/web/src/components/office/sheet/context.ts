import type { DocumentStudioFocus, DocumentStudioSelected } from "@rakazo/contracts";
import type { CellRange } from "./address";
import { cellRef, columnLetters, qualifiedRef, rangeRef, rangeSize } from "./address";

/** One cell as the note shows it: what it displays and the formula behind it, if any. */
export type SheetCellText = { value: string; formula: string | null };

export type SheetContextInput = {
  sheet: string;
  sheetCount: number;
  /** The cells on screen, when the grid has measured itself. */
  visible: CellRange | null;
  selection: CellRange;
  read: (row: number, col: number) => SheetCellText | null;
};

export type SheetChipWords = {
  cells: (ref: string, count: number) => string;
};

/** At most this many selected cells go into the note. */
export const SHEET_CELLS_MAX = 200;

function escapeCell(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

/**
 * The selected cells as a markdown table of values (row numbers and column letters as headers),
 * then each formula. Stops after `max` cells and says so.
 */
export function rangeContent(input: SheetContextInput, max = SHEET_CELLS_MAX): string {
  const { selection, read } = input;
  const total = rangeSize(selection);
  const width = selection.right - selection.left + 1;
  const rowsKept = Math.max(
    1,
    Math.min(selection.bottom - selection.top + 1, Math.floor(max / width)),
  );
  const colsKept = Math.min(width, max);
  const cols = Array.from({ length: colsKept }, (_, i) => selection.left + i);
  const lines = [
    `| | ${cols.map(columnLetters).join(" | ")} |`,
    `| --- | ${cols.map(() => "---").join(" | ")} |`,
  ];
  const formulas: string[] = [];
  let shown = 0;
  for (let row = selection.top; row < selection.top + rowsKept; row++) {
    const values = cols.map((col) => {
      const cell = read(row, col);
      shown++;
      if (cell?.formula)
        formulas.push(`${cellRef({ row, col })}: =${cell.formula.replace(/^=/, "")}`);
      return escapeCell(cell?.value ?? "");
    });
    lines.push(`| ${row} | ${values.join(" | ")} |`);
  }
  if (formulas.length) lines.push("Formulas:", ...formulas);
  if (shown < total) lines.push(`… showing the first ${shown} of ${total} cells (truncated)`);
  return lines.join("\n");
}

/** The studio note's focus and selection for a workbook. */
export function sheetContext(
  input: SheetContextInput,
  words: SheetChipWords,
): { focus: DocumentStudioFocus; selected: DocumentStudioSelected } {
  const { sheet, selection, visible } = input;
  const of = input.sheetCount > 1 ? ` (one of ${input.sheetCount} sheets)` : "";
  const focus: DocumentStudioFocus = {
    where: `sheet "${sheet}"${of}${visible ? `, cells ${rangeRef(visible)} visible` : ""}`,
    short: sheet,
  };
  const count = rangeSize(selection);
  const ref = qualifiedRef(sheet, selection);
  return {
    focus,
    selected: {
      what: count === 1 ? "cell" : "cell range",
      label: count === 1 ? ref : words.cells(ref, count),
      content: rangeContent(input),
      position: ref,
    },
  };
}
