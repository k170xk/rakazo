import {
  addSlideAt,
  addSlideTextBox,
  createPresentation,
  emu,
  getSlideLayouts,
  getSlides,
  savePresentation,
  setSlideNotes,
} from "@office-kit/pptx";
import { makeFormula } from "@office-kit/xlsx/cell";
import { workbookToBytes } from "@office-kit/xlsx/io";
import { addWorksheet, createWorkbook } from "@office-kit/xlsx/workbook";
import { setCell } from "@office-kit/xlsx/worksheet";
import { describe, expect, it } from "vitest";
import { CELL_CHANGES_MAX, diffWorkbook, readWorkbookSnapshot } from "../sheet/diff";
import type { SlideSnapshot } from "../slides/diff";
import { diffDeck, readDeckSnapshot } from "../slides/diff";
import { diffWord } from "../word/diff";
import { createSnapshotCache } from "./format";
import { diffSequence, wordSegments } from "./sequence";

describe("diffSequence", () => {
  it("pairs a removal followed by an addition as a change", () => {
    const kinds = diffSequence(["a", "b", "c"], ["a", "B", "c", "d"], (x) => x).map((c) => c.kind);
    expect(kinds).toEqual(["same", "changed", "same", "added"]);
  });

  it("handles empty sides and items containing line breaks", () => {
    expect(diffSequence([], ["x\ny"], (x) => x)).toEqual([
      { kind: "added", after: "x\ny", afterIndex: 0 },
    ]);
    expect(diffSequence(["x"], [], (x) => x)).toEqual([
      { kind: "removed", before: "x", beforeIndex: 0 },
    ]);
  });
});

describe("wordSegments", () => {
  it("highlights only the changed words", () => {
    expect(wordSegments("The quick fox", "The slow fox")).toEqual([
      { kind: "same", text: "The " },
      { kind: "removed", text: "quick" },
      { kind: "added", text: "slow" },
      { kind: "same", text: " fox" },
    ]);
  });
});

describe("diffWord", () => {
  it("counts edited, added and removed paragraphs", () => {
    const diff = diffWord(
      { paragraphs: ["Title", "Scope of works", "Old clause", "Fees"] },
      { paragraphs: ["Title", "Scope of the works", "Fees", "New clause"] },
    );
    expect(diff).toMatchObject({ changed: 1, added: 1, removed: 1 });
    const changed = diff.changes.find((c) => c.kind === "changed");
    expect(changed && "segments" in changed ? changed.segments : []).toContainEqual({
      kind: "added",
      text: "the ",
    });
  });

  it("treats everything as added for the first version", () => {
    expect(diffWord(null, { paragraphs: ["a", "b"] })).toMatchObject({
      added: 2,
      changed: 0,
      removed: 0,
    });
  });
});

describe("diffDeck", () => {
  const slide = (title: string, notes = "", hidden = false): SlideSnapshot => ({
    title,
    texts: [],
    notes,
    hidden,
  });

  it("finds moved, added, removed and edited slides", () => {
    const before = { slides: [slide("Intro"), slide("Scope"), slide("Fees"), slide("Old")] };
    const after = {
      slides: [slide("Scope"), slide("Intro"), slide("Fees", "Say VAT"), slide("Contacts")],
    };
    const diff = diffDeck(before, after);
    expect(diff.moved).toBe(1);
    expect(diff.notesChanged).toBe(1);
    const kinds = diff.changes.map((c) => c.kind).sort();
    expect(kinds).toEqual(["changed", "changed", "moved"].sort());
    const fees = diff.changes.find((c) => c.kind === "changed" && c.after.title === "Fees");
    expect(fees && fees.kind === "changed" ? fees.text : "x").toBeNull();
  });

  it("reads titles, text and notes from a saved deck", async () => {
    const pres = createPresentation();
    const layout = getSlideLayouts(pres)[0]!;
    for (const [at, text] of ["One", "Two"].entries()) {
      const added = addSlideAt(pres, at, { layout });
      addSlideTextBox(added, {
        x: emu(914400),
        y: emu(914400),
        w: emu(3657600),
        h: emu(914400),
        text,
      });
    }
    setSlideNotes(getSlides(pres)[1]!, "Speaker note");
    const snapshot = await readDeckSnapshot(await savePresentation(pres));
    expect(snapshot.slides).toHaveLength(2);
    expect(snapshot.slides[1]).toMatchObject({ notes: "Speaker note" });
    expect([snapshot.slides[1]!.title, ...snapshot.slides[1]!.texts]).toContain("Two");
  });
});

describe("diffWorkbook", () => {
  it("lists changed values and formulas by sheet, and new sheets", async () => {
    const wb = createWorkbook();
    const costs = addWorksheet(wb, "Costs");
    setCell(costs, 1, 1, "Item");
    setCell(costs, 2, 2, 10);
    setCell(costs, 3, 2, makeFormula("B2*2"));
    const before = await readWorkbookSnapshot(await workbookToBytes(wb));
    setCell(costs, 2, 2, 12);
    setCell(costs, 1, 1, "Line item");
    setCell(addWorksheet(wb, "Notes"), 1, 1, "Hello");
    const after = await readWorkbookSnapshot(await workbookToBytes(wb));
    const diff = diffWorkbook(before, after);
    const costsGroup = diff.groups.find((g) => g.sheet === "Costs")!;
    expect(costsGroup.cells.map((c) => c.ref)).toEqual(["A1", "B2"]);
    expect(costsGroup.cells[1]).toMatchObject({ before: { value: "10" }, after: { value: "12" } });
    expect(diff.groups.find((g) => g.sheet === "Notes")).toMatchObject({
      status: "added",
      total: 1,
    });
  });

  it("caps the listed cells per sheet", () => {
    const cells = new Map(
      Array.from({ length: CELL_CHANGES_MAX + 5 }, (_, i) => [
        `${i + 1}:1`,
        { value: String(i), formula: null },
      ]),
    );
    const diff = diffWorkbook(
      { sheets: [{ name: "S", cells: new Map() }] },
      { sheets: [{ name: "S", cells }] },
    );
    expect(diff.groups[0]).toMatchObject({ total: CELL_CHANGES_MAX + 5 });
    expect(diff.groups[0]!.cells).toHaveLength(CELL_CHANGES_MAX);
  });
});

describe("createSnapshotCache", () => {
  it("reads a version once and forgets failed reads", async () => {
    const cache = createSnapshotCache<number>();
    let calls = 0;
    const load = async () => ++calls;
    expect(await cache("a", load)).toBe(1);
    expect(await cache("a", load)).toBe(1);
    await expect(cache("b", () => Promise.reject(new Error("x")))).rejects.toThrow();
    await Promise.resolve();
    expect(await cache("b", load)).toBe(2);
  });
});
