import { describe, expect, it } from "vitest";
import { buildTree } from "./collections.js";
import { prefixLines, wrapSelection } from "./editor.js";
import { boardBounds, readBoard } from "./whiteboard.js";

describe("editor helpers", () => {
  it("wraps a selection and unwraps it again", () => {
    const bold = wrapSelection({ text: "make this bold", start: 5, end: 9 }, "**");
    expect(bold).toEqual({ text: "make **this** bold", start: 7, end: 11 });
    expect(wrapSelection(bold, "**")).toEqual({ text: "make this bold", start: 5, end: 9 });
    expect(wrapSelection({ text: "", start: 0, end: 0 }, "_").text).toBe("_text_");
  });

  it("prefixes every selected line and toggles it off", () => {
    const text = "one\ntwo\nthree";
    const listed = prefixLines({ text, start: 0, end: text.length }, "- ");
    expect(listed.text).toBe("- one\n- two\n- three");
    expect(prefixLines(listed, "- ").text).toBe(text);
    const numbered = prefixLines({ text, start: 4, end: 13 }, (index) => `${index + 1}. `);
    expect(numbered.text).toBe("one\n1. two\n2. three");
    expect(prefixLines(numbered, (index) => `${index + 1}. `).text).toBe(text);
  });
});

describe("buildTree", () => {
  it("nests rows under their parents and keeps loops and orphans as roots", () => {
    const rows = [
      { _id: "ceo", name: "Ann" },
      { _id: "cto", name: "Ben", boss: "ceo" },
      { _id: "dev", name: "Cal", boss: "cto" },
      { _id: "x", name: "Orphan", boss: "gone" },
      { _id: "p", name: "P", boss: "q" },
      { _id: "q", name: "Q", boss: "p" },
      { _id: "r", name: "R", boss: "p" },
    ];
    const roots = buildTree(rows, "boss");
    const ceo = roots.find((node) => node.id === "ceo");
    expect(ceo?.children[0]?.id).toBe("cto");
    expect(ceo?.children[0]?.children[0]?.id).toBe("dev");
    expect(roots.map((node) => node.id)).toEqual(expect.arrayContaining(["ceo", "x", "p", "q"]));
    const all = (nodes: typeof roots): number =>
      nodes.reduce((sum, node) => sum + 1 + all(node.children), 0);
    expect(all(roots)).toBe(rows.length);
  });
});

describe("whiteboard values", () => {
  it("reads saved JSON and ignores anything malformed", () => {
    const saved = JSON.stringify({
      items: [{ id: "a", kind: "sticky", x: 0, y: 0, w: 10, h: 10 }, { kind: "rect" }, null],
    });
    expect(readBoard(saved).items).toHaveLength(1);
    expect(readBoard("not json").items).toEqual([]);
    expect(readBoard(null).items).toEqual([]);
  });

  it("finds the box around everything but arrows", () => {
    expect(
      boardBounds([
        { id: "a", kind: "sticky", x: 10, y: 20, w: 100, h: 50 },
        { id: "b", kind: "rect", x: -30, y: 40, w: 20, h: 100 },
        {
          id: "c",
          kind: "arrow",
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          from: { x: -999, y: 0 },
          to: { item: "a" },
        },
      ]),
    ).toEqual({ x: -30, y: 20, w: 140, h: 120 });
    expect(boardBounds([])).toBeNull();
  });
});
