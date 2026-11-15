import { describe, expect, it } from "vitest";
import type { PdfAppContext } from "./context";
import {
  isPhoneScreen,
  noteKey,
  pdfDetail,
  pdfSelection,
  pdfWhere,
  selectionCapture,
  unionRect,
} from "./context";

const sheet: PdfAppContext = {
  document: { pageCount: 3, modified: false, revision: "r1" },
  page: { number: 2, width: 3370.39, height: 2383.94 },
  view: {
    mode: "single",
    zoomPercent: 30,
    visible: { x: 0, y: 0, width: 3370.39, height: 2383.94 },
  },
  ribbonTab: { id: "comment", label: "Annotation" },
  tool: "measureDistance",
  measureScale: { unit: "mm", ratio: "1:150", pointsPerUnit: 0.0189 },
};

describe("pdfWhere", () => {
  it("names the page, sheet size, tab, tool and zoom", () => {
    expect(pdfWhere(sheet)).toBe(
      "page 2 of 3 (3370 x 2384 pt), the Annotation tab, the measure distance tool, 30% zoom",
    );
  });

  it("leaves out the select tool and needs a page", () => {
    expect(pdfWhere({ ...sheet, tool: "select", ribbonTab: null })).toBe(
      "page 2 of 3 (3370 x 2384 pt), 30% zoom",
    );
    expect(pdfWhere(null)).toBeNull();
    expect(pdfWhere({ document: { pageCount: 3 } })).toBeNull();
  });
});

describe("pdfDetail", () => {
  it("says what is on screen, where they clicked and the drawing scale", () => {
    const detail = pdfDetail({ ...sheet, lastClick: { page: 2, x: 600.4, y: 750, secondsAgo: 4 } });
    expect(detail).toContain("Visible on screen: x 0, y 0, 3370 x 2384 pt (the whole page).");
    expect(detail).toContain('They last clicked page 2 at x 600, y 750 4 s ago; "here"');
    expect(detail).toContain("Drawing scale: 1:150, measured in mm.");
  });

  it("does not call a zoomed-in area the whole page", () => {
    const detail = pdfDetail({
      ...sheet,
      view: { zoomPercent: 200, visible: { x: 1000, y: 500, width: 600, height: 400 } },
      measureScale: null,
    });
    expect(detail).toBe("Visible on screen: x 1000, y 500, 600 x 400 pt.");
  });
});

describe("pdfSelection", () => {
  it("lists each selected markup with its lasting id and says how many were left out", () => {
    const selection = pdfSelection({
      ...sheet,
      selectedCount: 3,
      selected: [
        { id: "m1", type: "cloud", page: 2, bounds: { x: 1, y: 2, width: 3, height: 4 } },
        {
          id: "m2",
          type: "arrow",
          page: 2,
          points: Array.from({ length: 400 }, (_, i) => ({ x: i, y: i })),
        },
      ],
    });
    expect(selection?.kind).toBe("markups");
    if (selection?.kind !== "markups") return;
    expect(selection.count).toBe(3);
    const [first, second, more] = selection.content.split("\n");
    expect(JSON.parse(first!)).toMatchObject({ id: "m1", type: "cloud" });
    expect(second!.length).toBe(600);
    expect(more).toBe("(1 more selected, not listed)");
  });

  it("falls back to the selected text with its position", () => {
    expect(
      pdfSelection({
        ...sheet,
        selectedText: {
          page: 2,
          text: " GENERAL NOTES ",
          rects: [
            { x: 10, y: 20, width: 30, height: 10 },
            { x: 50, y: 20, width: 20, height: 12 },
          ],
        },
      }),
    ).toEqual({ kind: "text", content: 'On page 2 at x 10, y 20, 60 x 12 pt: "GENERAL NOTES"' });
    expect(pdfSelection(sheet)).toBeNull();
  });
});

describe("selectionCapture", () => {
  it("pictures the selected markups with room around them, inside the page", () => {
    const region = selectionCapture({
      ...sheet,
      selected: [
        { id: "a", page: 2, bounds: { x: 20, y: 30, width: 100, height: 50 } },
        { id: "b", page: 2, bounds: { x: 200, y: 100, width: 50, height: 50 } },
        { id: "c", page: 3, bounds: { x: 3000, y: 2000, width: 50, height: 50 } },
      ],
    });
    expect(region).toEqual({ page: 2, x: 0, y: 0, width: 290, height: 190, dpi: 200 });
  });

  it("keeps a large area's picture under the pixel limit", () => {
    const region = selectionCapture({
      ...sheet,
      selected: [{ id: "a", page: 2, bounds: { x: 100, y: 100, width: 3000, height: 2000 } }],
    });
    expect(region!.dpi).toBe(Math.floor((1600 * 72) / region!.width));
    expect((region!.width * region!.dpi) / 72).toBeLessThanOrEqual(1600);
  });

  it("is null without a selection", () => {
    expect(selectionCapture(sheet)).toBeNull();
    expect(unionRect([])).toBeNull();
  });
});

describe("noteKey", () => {
  it("ignores the edit fingerprint and saved state but not the view", () => {
    const edited = { ...sheet, document: { ...sheet.document, revision: "r2", modified: true } };
    expect(noteKey(edited)).toBe(noteKey(sheet));
    expect(noteKey({ ...sheet, ribbonTab: { id: "home", label: "Home" } })).not.toBe(
      noteKey(sheet),
    );
    expect(noteKey({ ...sheet, editing: true })).toBe(noteKey(sheet));
  });
});

describe("isPhoneScreen", () => {
  const win = (width: number, height: number, coarse: boolean) => ({
    screen: { width, height },
    matchMedia: (query: string) =>
      ({ matches: coarse && query === "(pointer: coarse)" }) as MediaQueryList,
  });

  it("is a touch screen with a short side under 600px, in either orientation", () => {
    expect(isPhoneScreen(win(390, 844, true))).toBe(true);
    expect(isPhoneScreen(win(844, 390, true))).toBe(true);
  });

  it("leaves tablets, desktops and missing windows on the desktop layout", () => {
    expect(isPhoneScreen(win(820, 1180, true))).toBe(false);
    expect(isPhoneScreen(win(390, 844, false))).toBe(false);
    expect(isPhoneScreen(undefined)).toBe(false);
  });
});
