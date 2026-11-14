import { addWorksheet, createWorkbook } from "@office-kit/xlsx/workbook";
import { getCell, setCell } from "@office-kit/xlsx/worksheet";
import { describe, expect, it } from "vitest";
import { addSheet, cellLook, setFontStyle } from "./commands";
import { createWorkbookUndo } from "./undo";
import {
  applyInput,
  openWorkbook,
  rawInput,
  saveVerified,
  sheetTabs,
  worksheetOf,
} from "./workbook";

describe("workbook undo", () => {
  it("undoes and redoes values, formatting and sheets in place", async () => {
    const wb = createWorkbook();
    addWorksheet(wb, "Costs");
    const sheet = () => worksheetOf(wb, "Costs") ?? never();
    setCell(sheet(), 1, 1, "Item");
    const undo = createWorkbookUndo(wb);

    expect(undo.track(() => applyInput(wb, sheet(), { row: 1, col: 1 }, "Item"))).toBe(false);
    expect(undo.history.canUndo()).toBe(false);
    undo.track(() => applyInput(wb, sheet(), { row: 1, col: 1 }, "Fee"));
    const before = undo.snapshot();
    setFontStyle(wb, sheet(), { top: 1, left: 1, bottom: 1, right: 1 }, "bold", true);
    undo.record(before);
    undo.track(
      () => addSheet(wb, "Costs"),
      () => true,
    );

    expect(sheetTabs(wb)).toHaveLength(2);
    expect(undo.undo()).toBe(true);
    expect(sheetTabs(wb)).toHaveLength(1);
    expect(undo.undo()).toBe(true);
    expect(cellLook(wb, sheet(), { row: 1, col: 1 }).bold).toBe(false);
    expect(undo.undo()).toBe(true);
    expect(rawInput(wb, getCell(sheet(), 1, 1))).toBe("Item");
    expect(undo.undo()).toBe(false);

    expect(undo.redo()).toBe(true);
    expect(undo.redo()).toBe(true);
    expect(rawInput(wb, getCell(sheet(), 1, 1))).toBe("Fee");
    expect(cellLook(wb, sheet(), { row: 1, col: 1 }).bold).toBe(true);

    const back = await openWorkbook(await saveVerified(wb, []));
    const ws = worksheetOf(back, "Costs") ?? never();
    expect(rawInput(back, getCell(ws, 1, 1))).toBe("Fee");
    expect(cellLook(back, ws, { row: 1, col: 1 }).bold).toBe(true);
    expect(sheetTabs(back)).toHaveLength(1);
  });
});

function never(): never {
  throw new Error("missing sheet");
}
