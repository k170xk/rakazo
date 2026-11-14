import { describe, expect, it } from "vitest";
import {
  cellRef,
  columnLetters,
  columnNumber,
  parseCellRef,
  parseQualifiedRef,
  parseRangeRef,
  qualifiedRef,
  quoteSheetName,
  rangeOf,
  rangeRef,
} from "./address";
import {
  expandToMerges,
  extendSelection,
  moveSelection,
  selectCell,
  selectionRange,
  stepFrom,
} from "./selection";

describe("column letters", () => {
  it("round-trips the edges of the alphabet runs", () => {
    for (const [n, letters] of [
      [1, "A"],
      [26, "Z"],
      [27, "AA"],
      [52, "AZ"],
      [53, "BA"],
      [702, "ZZ"],
      [703, "AAA"],
      [16_384, "XFD"],
    ] as const) {
      expect(columnLetters(n)).toBe(letters);
      expect(columnNumber(letters)).toBe(n);
    }
  });

  it("refuses columns outside the sheet", () => {
    expect(() => columnLetters(0)).toThrow();
    expect(() => columnLetters(16_385)).toThrow();
    expect(columnNumber("XFE")).toBe(0);
    expect(columnNumber("A1")).toBe(0);
  });
});

describe("cell and range references", () => {
  it("parses plain, absolute and lower-case refs", () => {
    expect(parseCellRef("B2")).toEqual({ row: 2, col: 2 });
    expect(parseCellRef("$c$10")).toEqual({ row: 10, col: 3 });
    expect(parseCellRef(" AA100 ")).toEqual({ row: 100, col: 27 });
    expect(parseCellRef("A0")).toBeNull();
    expect(parseCellRef("A1048577")).toBeNull();
    expect(parseCellRef("1A")).toBeNull();
    expect(cellRef({ row: 9, col: 4 })).toBe("D9");
  });

  it("normalises ranges dragged in any direction", () => {
    expect(parseRangeRef("D9:B2")).toEqual({ top: 2, left: 2, bottom: 9, right: 4 });
    expect(rangeRef(rangeOf({ row: 9, col: 4 }, { row: 2, col: 2 }))).toBe("B2:D9");
    expect(rangeRef(rangeOf({ row: 3, col: 3 }, { row: 3, col: 3 }))).toBe("C3");
    expect(parseRangeRef("A1:B2:C3")).toBeNull();
    expect(parseRangeRef("A1:")).toBeNull();
  });

  it("quotes sheet names only when a spreadsheet app would", () => {
    expect(quoteSheetName("Sheet1")).toBe("Sheet1");
    expect(quoteSheetName("Q1 costs")).toBe("'Q1 costs'");
    expect(quoteSheetName("A1")).toBe("'A1'");
    expect(quoteSheetName("R1C1")).toBe("'R1C1'");
    expect(quoteSheetName("2026")).toBe("'2026'");
    expect(quoteSheetName("Bob's")).toBe("'Bob''s'");
  });

  it("round-trips sheet-qualified selections", () => {
    const range = { top: 2, left: 2, bottom: 9, right: 4 };
    expect(qualifiedRef("Sheet1", range)).toBe("Sheet1!B2:D9");
    expect(qualifiedRef("Bob's data", range)).toBe("'Bob''s data'!B2:D9");
    expect(parseQualifiedRef("'Bob''s data'!B2:D9")).toEqual({ sheet: "Bob's data", range });
    expect(parseQualifiedRef("Sheet1!C3")).toEqual({
      sheet: "Sheet1",
      range: { top: 3, left: 3, bottom: 3, right: 3 },
    });
    expect(parseQualifiedRef("B2:D9")).toBeNull();
  });
});

describe("range selection", () => {
  const merge = { top: 2, left: 2, bottom: 3, right: 4 };

  it("moves and extends with the keyboard", () => {
    const start = selectCell({ row: 1, col: 1 });
    const moved = moveSelection(start, 1, 1, false);
    expect(moved).toEqual(selectCell({ row: 2, col: 2 }));
    const grown = moveSelection(moveSelection(moved, 0, 1, true), 2, 0, true);
    expect(selectionRange(grown)).toEqual({ top: 2, left: 2, bottom: 4, right: 3 });
    expect(moveSelection(start, -1, -1, false)).toEqual(start);
  });

  it("extends from the anchor when dragged back past it", () => {
    const picked = extendSelection(selectCell({ row: 5, col: 5 }), { row: 2, col: 3 });
    expect(selectionRange(picked)).toEqual({ top: 2, left: 3, bottom: 5, right: 5 });
  });

  it("treats a merged block as one cell", () => {
    expect(stepFrom({ row: 1, col: 3 }, 1, 0, [merge])).toEqual({ row: 2, col: 3 });
    expect(moveSelection(selectCell({ row: 1, col: 3 }), 1, 0, false, [merge])).toEqual(
      selectCell({ row: 2, col: 2 }),
    );
    expect(stepFrom({ row: 2, col: 2 }, 0, 1, [merge])).toEqual({ row: 2, col: 5 });
    expect(stepFrom({ row: 2, col: 2 }, 1, 0, [merge])).toEqual({ row: 4, col: 2 });
    const moved = moveSelection(selectCell({ row: 2, col: 1 }), 0, 1, false, [merge]);
    expect(moved).toEqual(selectCell({ row: 2, col: 2 }));
  });

  it("grows a range to cover every merge it touches", () => {
    const other = { top: 4, left: 4, bottom: 6, right: 5 };
    expect(expandToMerges({ top: 1, left: 1, bottom: 2, right: 2 }, [merge, other])).toEqual({
      top: 1,
      left: 1,
      bottom: 3,
      right: 4,
    });
    expect(expandToMerges({ top: 3, left: 4, bottom: 4, right: 4 }, [merge, other])).toEqual({
      top: 2,
      left: 2,
      bottom: 6,
      right: 5,
    });
  });
});
