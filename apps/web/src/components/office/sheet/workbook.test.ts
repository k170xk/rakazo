import { makeFormula, makeSharedFormula } from "@office-kit/xlsx/cell";
import { workbookToBytes } from "@office-kit/xlsx/io";
import { setCellAsDate, setCellNumberFormat } from "@office-kit/xlsx/styles";
import { addWorksheet, createWorkbook, getCellAtAddress } from "@office-kit/xlsx/workbook";
import {
  addExcelTable,
  getCell,
  mergeCells,
  setCell,
  setColumnWidth,
  setFreezePanes,
} from "@office-kit/xlsx/worksheet";
import { describe, expect, it } from "vitest";
import {
  applyInput,
  changedCells,
  clearRange,
  columnPx,
  freezeCounts,
  lockAt,
  lockedRanges,
  mergedRanges,
  openWorkbook,
  parsePastedText,
  pxToWidth,
  rangeText,
  rawInput,
  SaveCheckError,
  saveVerified,
  setColumnPx,
  setFreeze,
  widthToPx,
  worksheetOf,
} from "./workbook";

async function sample() {
  const wb = createWorkbook();
  const ws = addWorksheet(wb, "Costs");
  addWorksheet(wb, "Q1 notes");
  setCell(ws, 1, 1, "Item");
  setCell(ws, 1, 2, "Qty");
  setCell(ws, 1, 3, "Price");
  setCell(ws, 1, 4, "Total");
  setCell(ws, 2, 1, "Survey");
  setCell(ws, 2, 2, 12);
  setCell(ws, 2, 3, 450);
  setCell(ws, 2, 4, makeFormula("B2*C2", { cachedValue: 5400 }));
  const money = setCell(ws, 3, 3, 10);
  setCellNumberFormat(wb, money, '"£"#,##0.00');
  setColumnWidth(ws, 1, 20);
  setFreezePanes(ws, { rows: 1, cols: 0 });
  // Round-trip once so the test edits a workbook the way the studio sees one: loaded from bytes.
  return openWorkbook(await workbookToBytes(wb));
}

describe("cell input", () => {
  it("shows formulas, typed-looking text and numbers as they are entered", async () => {
    const wb = await sample();
    const ws = worksheetOf(wb, "Costs")!;
    expect(rawInput(wb, getCell(ws, 2, 4))).toBe("=B2*C2");
    expect(rawInput(wb, getCell(ws, 3, 3))).toBe("10");
    setCell(ws, 5, 1, "=not a formula");
    setCell(ws, 5, 2, "007");
    expect(rawInput(wb, getCell(ws, 5, 1))).toBe("'=not a formula");
    // Typed as is, 007 would become the number 7.
    expect(rawInput(wb, getCell(ws, 5, 2))).toBe("'007");
    setCell(ws, 5, 3, "42");
    expect(rawInput(wb, getCell(ws, 5, 3))).toBe("'42");
    expect(rawInput(wb, undefined)).toBe("");
  });

  it("stores what a spreadsheet would and reports unchanged input", async () => {
    const wb = await sample();
    const ws = worksheetOf(wb, "Costs")!;
    expect(applyInput(wb, ws, { row: 2, col: 2 }, "12")).toBe(false);
    expect(applyInput(wb, ws, { row: 2, col: 2 }, "1,250.5")).toBe(true);
    expect(getCell(ws, 2, 2)!.value).toBe(1250.5);
    expect(applyInput(wb, ws, { row: 6, col: 1 }, "true")).toBe(true);
    expect(getCell(ws, 6, 1)!.value).toBe(true);
    expect(applyInput(wb, ws, { row: 6, col: 2 }, "'0123")).toBe(true);
    expect(getCell(ws, 6, 2)!.value).toBe("0123");
    expect(applyInput(wb, ws, { row: 6, col: 3 }, "=SUM(B2:B3)")).toBe(true);
    expect(getCell(ws, 6, 3)!.value).toMatchObject({ kind: "formula", formula: "SUM(B2:B3)" });
    expect(applyInput(wb, ws, { row: 9, col: 9 }, "")).toBe(false);
    expect(() => applyInput(wb, ws, { row: 6, col: 4 }, "==A1")).toThrow();
  });

  it("keeps the last known result when a formula is edited", async () => {
    const wb = await sample();
    const ws = worksheetOf(wb, "Costs")!;
    expect(applyInput(wb, ws, { row: 2, col: 4 }, "=B2*C2*2")).toBe(true);
    expect(getCell(ws, 2, 4)!.value).toMatchObject({ formula: "B2*C2*2", cachedValue: 5400 });
    const saved = await openWorkbook(
      await saveVerified(wb, [{ sheet: "Costs", pos: { row: 2, col: 4 }, raw: "=B2*C2*2" }]),
    );
    expect(saved.calcProperties?.fullCalcOnLoad).toBe(true);
  });

  it("keeps a date a date in a date-formatted cell", async () => {
    const wb = createWorkbook();
    const ws = addWorksheet(wb, "S");
    setCellAsDate(wb, setCell(ws, 1, 1, new Date(Date.UTC(2026, 0, 5))));
    const loaded = await openWorkbook(await workbookToBytes(wb));
    const sheet = worksheetOf(loaded, "S")!;
    expect(rawInput(loaded, getCell(sheet, 1, 1))).toBe("2026-01-05");
    expect(applyInput(loaded, sheet, { row: 1, col: 1 }, "2026-02-28")).toBe(true);
    const saved = await openWorkbook(await saveVerified(loaded, []));
    expect(rawInput(saved, getCell(worksheetOf(saved, "S")!, 1, 1))).toBe("2026-02-28");
  });

  it("clears values but keeps formatting", async () => {
    const wb = await sample();
    const ws = worksheetOf(wb, "Costs")!;
    const styled = getCell(ws, 3, 3)!.styleId;
    expect(clearRange(ws, { top: 2, left: 2, bottom: 3, right: 3 })).toBe(3);
    expect(getCell(ws, 3, 3)!.value).toBeNull();
    expect(getCell(ws, 3, 3)!.styleId).toBe(styled);
  });
});

describe("saving", () => {
  it("round-trips edits, widths, freeze panes and the recalculate flag", async () => {
    const wb = await sample();
    const ws = worksheetOf(wb, "Costs")!;
    applyInput(wb, ws, { row: 2, col: 3 }, "475");
    applyInput(wb, ws, { row: 7, col: 1 }, "=C2*2");
    setColumnPx(ws, 2, 120);
    setFreeze(ws, 2, 1);
    const expectations = [
      { sheet: "Costs", pos: { row: 2, col: 3 }, raw: "475" },
      { sheet: "Costs", pos: { row: 7, col: 1 }, raw: "=C2*2" },
    ];
    const reloaded = await openWorkbook(await saveVerified(wb, expectations));
    const sheet = worksheetOf(reloaded, "Costs")!;
    expect(getCellAtAddress(reloaded, "Costs!C2")!.value).toBe(475);
    // The dependent formula keeps the result it had until a spreadsheet app recalculates it.
    expect(getCell(sheet, 2, 4)!.value).toMatchObject({ formula: "B2*C2", cachedValue: 5400 });
    expect(columnPx(sheet, 2)).toBe(120);
    expect(columnPx(sheet, 1)).toBe(widthToPx(20));
    expect(freezeCounts(sheet)).toEqual({ rows: 2, cols: 1 });
    expect(reloaded.calcProperties?.fullCalcOnLoad).toBe(true);
    expect(reloaded.sheets.map((ref) => ref.sheet.title)).toEqual(["Costs", "Q1 notes"]);
  });

  it("refuses bytes that do not show an edit again", async () => {
    const wb = await sample();
    await expect(
      saveVerified(wb, [{ sheet: "Costs", pos: { row: 2, col: 3 }, raw: "999" }]),
    ).rejects.toBeInstanceOf(SaveCheckError);
  });

  it("converts widths between file units and pixels", () => {
    expect(widthToPx(9.140625)).toBe(64);
    expect(widthToPx(pxToWidth(64))).toBe(64);
    expect(widthToPx(pxToWidth(137))).toBe(137);
  });

  it("finds what a newer version changed", async () => {
    const before = await sample();
    const after = await sample();
    const ws = worksheetOf(after, "Costs")!;
    applyInput(after, ws, { row: 2, col: 2 }, "13");
    applyInput(after, ws, { row: 12, col: 5 }, "new");
    clearRange(ws, { top: 1, left: 1, bottom: 1, right: 1 });
    expect([...changedCells(before, after, "Costs")].sort()).toEqual(["A1", "B2", "E12"]);
  });
});

describe("cells an edit would break", () => {
  it("locks shared formula text, array results and table headers", async () => {
    const wb = createWorkbook();
    const ws = addWorksheet(wb, "S");
    for (let row = 1; row <= 4; row += 1) {
      setCell(ws, row, 1, row);
      setCell(ws, row, 2, row * 2);
    }
    setCell(ws, 1, 3, makeSharedFormula(0, "A1+B1", "C1:C4"));
    setCell(ws, 2, 3, makeSharedFormula(0));
    setCell(ws, 1, 1, "A");
    setCell(ws, 1, 2, "B");
    addExcelTable(wb, ws, { name: "Numbers", ref: "A1:B4", columns: ["A", "B"] });
    const locked = lockedRanges(ws);
    expect(lockAt(locked, { row: 1, col: 3 })).toBe("shared");
    expect(lockAt(locked, { row: 2, col: 3 })).toBeNull();
    expect(lockAt(locked, { row: 1, col: 1 })).toBe("table");
    expect(lockAt(locked, { row: 2, col: 1 })).toBeNull();
  });

  it("reads merges as ranges", async () => {
    const wb = createWorkbook();
    const ws = addWorksheet(wb, "S");
    mergeCells(ws, "B2:D3");
    expect(mergedRanges(ws)).toEqual([{ top: 2, left: 2, bottom: 3, right: 4 }]);
  });
});

describe("clipboard", () => {
  it("copies shown text and parses pasted rows", async () => {
    const wb = await sample();
    const ws = worksheetOf(wb, "Costs")!;
    expect(rangeText(wb, ws, { top: 1, left: 1, bottom: 2, right: 2 })).toBe(
      "Item\tQty\nSurvey\t12",
    );
    expect(parsePastedText("a\tb\r\nc\td\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});
