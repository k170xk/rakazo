import { makeFormula } from "@office-kit/xlsx/cell";
import { workbookToBytes } from "@office-kit/xlsx/io";
import { addWorksheet, createWorkbook } from "@office-kit/xlsx/workbook";
import type { Worksheet } from "@office-kit/xlsx/worksheet";
import { getCell, setCell } from "@office-kit/xlsx/worksheet";
import { describe, expect, it } from "vitest";
import type { CellRange } from "./address";
import {
  addSheet,
  autoSumFormula,
  cellLook,
  clearFormats,
  currentRegion,
  decimalsOf,
  deleteRowsAt,
  deleteSheet,
  fillColorOf,
  formatTarget,
  gridlinesShown,
  hasBorder,
  insertFunction,
  insertRowsAt,
  looksLikeHeader,
  mergeRange,
  NUMBER_FORMATS,
  renameSheetTo,
  setBorders,
  setFillColor,
  setFontColor,
  setFontStyle,
  setGridlines,
  setHorizontal,
  setNumberFormat,
  setVertical,
  setWrap,
  setZoom,
  sheetZoom,
  sortRows,
  stepDecimals,
  unmergeRange,
} from "./commands";
import {
  mergedRanges,
  openWorkbook,
  rawInput,
  saveVerified,
  sheetTabs,
  worksheetOf,
} from "./workbook";

const box = (top: number, left: number, bottom: number, right: number): CellRange => ({
  top,
  left,
  bottom,
  right,
});

function sample() {
  const wb = createWorkbook();
  const ws = addWorksheet(wb, "Costs");
  const rows: (string | number)[][] = [
    ["Item", "Qty", "Price"],
    ["Survey", 12, 40],
    ["Drawings", 3, 250.5],
    ["Report", 7, 90],
  ];
  rows.forEach((values, r) => {
    values.forEach((value, c) => {
      setCell(ws, r + 1, c + 1, value);
    });
  });
  return { wb, ws };
}

async function reload(wb: ReturnType<typeof createWorkbook>, title = "Costs") {
  const back = await openWorkbook(await saveVerified(wb, []));
  const ws = worksheetOf(back, title);
  if (!ws) throw new Error(`${title} was lost`);
  return { wb: back, ws };
}

const column = (ws: Worksheet, col: number, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => getCell(ws, from + i, col)?.value ?? null);

describe("sheet ribbon commands", () => {
  it("formats cells and keeps the formatting after a save", async () => {
    const { wb, ws } = sample();
    const header = box(1, 1, 1, 3);
    setFontStyle(wb, ws, header, "bold", true);
    setFontStyle(wb, ws, header, "italic", true);
    setFontStyle(wb, ws, header, "underline", true);
    setFontStyle(wb, ws, header, "strike", true);
    setFontColor(wb, ws, header, "#FFFFFF");
    setFillColor(wb, ws, header, "#76BF43");
    setHorizontal(wb, ws, header, "center");
    setVertical(wb, ws, header, "top");
    setWrap(wb, ws, header, true);
    setNumberFormat(wb, ws, box(2, 3, 4, 3), NUMBER_FORMATS.pounds);
    setBorders(wb, ws, box(1, 1, 4, 3), "all");

    const back = await reload(wb);
    expect(cellLook(back.wb, back.ws, { row: 1, col: 2 })).toEqual({
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      horizontal: "center",
      vertical: "top",
      wrap: true,
      numberFormat: "General",
    });
    expect(fillColorOf(back.wb, back.ws, { row: 1, col: 1 })).toBe("#76BF43");
    expect(cellLook(back.wb, back.ws, { row: 3, col: 3 }).numberFormat).toBe("£#,##0.00");
    expect(hasBorder(back.wb, back.ws, { row: 2, col: 2 })).toBe(true);
    expect(rawInput(back.wb, getCell(back.ws, 3, 3))).toBe("250.5");

    setFontStyle(back.wb, back.ws, box(1, 1, 1, 1), "bold", false);
    setFillColor(back.wb, back.ws, box(1, 1, 1, 1), null);
    setBorders(back.wb, back.ws, box(2, 2, 2, 2), "none");
    clearFormats(back.wb, back.ws, box(1, 3, 1, 3));
    const again = await reload(back.wb);
    expect(cellLook(again.wb, again.ws, { row: 1, col: 1 }).bold).toBe(false);
    expect(cellLook(again.wb, again.ws, { row: 1, col: 1 }).italic).toBe(true);
    expect(fillColorOf(again.wb, again.ws, { row: 1, col: 1 })).toBeNull();
    expect(hasBorder(again.wb, again.ws, { row: 2, col: 2 })).toBe(false);
    expect(cellLook(again.wb, again.ws, { row: 1, col: 3 }).bold).toBe(false);
    expect(rawInput(again.wb, getCell(again.ws, 1, 3))).toBe("Price");
  });

  it("steps decimal places on number formats", () => {
    expect(stepDecimals("General", 1, 1)).toBe("0.00");
    expect(stepDecimals("General", -1, 2)).toBe("0.0");
    expect(stepDecimals("General", -1, 0)).toBe("0");
    expect(stepDecimals("#,##0.00", 1)).toBe("#,##0.000");
    expect(stepDecimals("#,##0.00", -1)).toBe("#,##0.0");
    expect(stepDecimals("#,##0.0", -1)).toBe("#,##0");
    expect(stepDecimals("#,##0", -1)).toBe("#,##0");
    expect(stepDecimals("£#,##0", 1)).toBe("£#,##0.0");
    expect(stepDecimals("0%", 1)).toBe("0.0%");
    expect(stepDecimals('"Qty "0', 1)).toBe('"Qty "0.0');
    expect(stepDecimals("#,##0.00;[Red]-#,##0.00", -1)).toBe("#,##0.0;[Red]-#,##0.0");
    expect(stepDecimals("@", 1)).toBe("@");
    expect(decimalsOf(250.5)).toBe(1);
    expect(decimalsOf(12)).toBe(0);
    expect(decimalsOf("x")).toBe(0);
  });

  it("merges, refuses to lose values, and unmerges", async () => {
    const { wb, ws } = sample();
    setCell(ws, 6, 1, "Notes");
    expect(mergeRange(ws, box(6, 1, 6, 3), true, wb)).toBe("merged");
    expect(mergeRange(ws, box(2, 1, 3, 1), false)).toBe("values");
    expect(mergeRange(ws, box(1, 1, 1, 1), false)).toBe("single");
    expect(mergeRange(ws, box(6, 2, 7, 4), false)).toBe("overlap");
    const back = await reload(wb);
    expect(mergedRanges(back.ws)).toEqual([box(6, 1, 6, 3)]);
    expect(cellLook(back.wb, back.ws, { row: 6, col: 1 }).horizontal).toBe("center");
    expect(unmergeRange(back.ws, box(6, 2, 6, 2))).toBe(1);
    expect(mergedRanges((await reload(back.wb)).ws)).toEqual([]);
  });

  it("inserts and deletes rows, moving what is below", async () => {
    const { wb, ws } = sample();
    setCell(ws, 5, 2, makeFormula("SUM(B2:B4)"));
    insertRowsAt(wb, ws, 3, 2);
    expect(getCell(ws, 5, 1)?.value).toBe("Drawings");
    expect(rawInput(wb, getCell(ws, 7, 2))).toBe("=SUM(B2:B6)");
    deleteRowsAt(wb, ws, 3, 2);
    const back = await reload(wb);
    expect(column(back.ws, 1, 1, 4)).toEqual(["Item", "Survey", "Drawings", "Report"]);
    expect(rawInput(back.wb, getCell(back.ws, 5, 2))).toBe("=SUM(B2:B4)");
  });

  it("adds, renames and deletes sheets", async () => {
    const { wb } = sample();
    const name = addSheet(wb, "Costs");
    expect(name).toBe("Sheet2");
    expect(renameSheetTo(wb, name, "Bad/Name")).toBe("characters");
    expect(renameSheetTo(wb, name, "costs")).toBe("taken");
    expect(renameSheetTo(wb, name, "x".repeat(32))).toBe("long");
    expect(renameSheetTo(wb, name, "  ")).toBe("empty");
    expect(renameSheetTo(wb, name, "'Quoted")).toBe("quote");
    expect(renameSheetTo(wb, name, "Fees")).toBeNull();
    const back = await reload(wb, "Fees");
    expect(sheetTabs(back.wb).map((tab) => tab.title)).toEqual(["Costs", "Fees"]);
    expect(deleteSheet(back.wb, "Fees")).toBe(true);
    expect(deleteSheet(back.wb, "Costs")).toBe(false);
    expect(sheetTabs((await reload(back.wb)).wb).map((tab) => tab.title)).toEqual(["Costs"]);
  });

  it("guesses AutoSum ranges and builds function calls", () => {
    const { ws } = sample();
    expect(autoSumFormula(ws, { row: 5, col: 2 })).toBe("=SUM(B2:B4)");
    expect(autoSumFormula(ws, { row: 2, col: 4 })).toBe("=SUM(B2:C2)");
    expect(autoSumFormula(ws, { row: 9, col: 9 })).toBe("=SUM()");
    expect(insertFunction("", "AVERAGE")).toBe("=AVERAGE(");
    expect(insertFunction("12", "SUM")).toBe("=SUM(");
    expect(insertFunction("=A1+", "MAX")).toBe("=A1+MAX(");
    expect(insertFunction("=SUM(A1", "MAX")).toBe("=SUM(A1,MAX(");
  });

  it("sorts a region by a column, keeping rows together and blanks last", async () => {
    const { wb, ws } = sample();
    setCell(ws, 5, 1, "Blank qty");
    const region = currentRegion(ws, { row: 2, col: 2 });
    expect(region).toEqual(box(1, 1, 5, 3));
    expect(looksLikeHeader(ws, region)).toBe(true);
    const body = { ...region, top: region.top + 1 };
    expect(sortRows(ws, body, 2, false)).toBe("sorted");
    expect(column(ws, 1, 2, 5)).toEqual(["Drawings", "Report", "Survey", "Blank qty"]);
    expect(column(ws, 3, 2, 4)).toEqual([250.5, 90, 40]);
    expect(sortRows(ws, body, 1, true)).toBe("sorted");
    const back = await reload(wb);
    expect(column(back.ws, 1, 1, 5)).toEqual(["Item", "Survey", "Report", "Drawings", "Blank qty"]);

    setCell(back.ws, 6, 2, makeFormula("SUM(B2:B4)"));
    expect(sortRows(back.ws, box(2, 1, 6, 3), 2, false)).toBe("formulas");
    expect(sortRows(back.ws, box(2, 1, 2, 3), 2, false)).toBe("nothing");
  });

  it("keeps gridlines and zoom on the sheet view", async () => {
    const { wb, ws } = sample();
    expect(gridlinesShown(ws)).toBe(true);
    expect(sheetZoom(ws)).toBe(1);
    setGridlines(ws, false);
    setZoom(ws, 1.25);
    const back = await reload(wb);
    expect(gridlinesShown(back.ws)).toBe(false);
    expect(sheetZoom(back.ws)).toBe(1.25);
  });

  it("trims huge selections to the used area", () => {
    const { ws } = sample();
    expect(formatTarget(ws, box(1, 1, 10, 10))).toEqual(box(1, 1, 10, 10));
    expect(formatTarget(ws, box(1, 1, 1_048_576, 3))).toEqual(box(1, 1, 4, 3));
  });

  it("saves through the bytes path the studio uses", async () => {
    const { wb } = sample();
    expect((await workbookToBytes(wb)).byteLength).toBeGreaterThan(0);
  });
});
