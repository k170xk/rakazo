import { describe, expect, it } from "vitest";
import {
  applyBoardOps,
  boardForModel,
  danglingArrow,
  readBoardItems,
  whiteboardSelectionNote,
} from "./whiteboard.js";

const block = (id: string, text = id) => ({
  id,
  kind: "rect" as const,
  x: 0,
  y: 0,
  w: 80,
  h: 40,
  text,
});

describe("whiteboard ops", () => {
  it("changes only the named item and leaves the rest", () => {
    const applied = applyBoardOps(
      [block("api", "API"), block("db", "Postgres")],
      [{ op: "update", id: "db", patch: { text: "Postgres 16" } }],
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.items.map((item) => item.text)).toEqual(["API", "Postgres 16"]);
  });

  it("refuses a missing id and a second copy, and drops arrows attached to a removed block", () => {
    const board = [
      block("api"),
      {
        id: "link",
        kind: "arrow" as const,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        from: { item: "api" },
        to: { item: "db" },
      },
      block("db"),
    ];
    expect(applyBoardOps(board, [{ op: "remove", id: "gone" }])).toEqual({
      ok: false,
      error: expect.stringContaining("gone"),
    });
    const removed = applyBoardOps(board, [{ op: "remove", id: "db" }]);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.items.map((item) => item.id)).toEqual(["api"]);
    expect(applyBoardOps(board, [{ op: "add", item: block("api") }]).ok).toBe(false);
  });

  it("refuses an arrow that points off the board", () => {
    expect(
      danglingArrow([
        {
          id: "link",
          kind: "arrow",
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          from: { item: "api" },
          to: { item: "missing" },
        },
      ]),
    ).toMatch(/not on the board/);
  });

  it("reads a saved board and summarizes a long pen stroke", () => {
    const saved = JSON.stringify({
      items: [block("a"), { kind: "rect" }, null],
    });
    expect(readBoardItems(saved).map((item) => item.id)).toEqual(["a"]);
    const stroke = boardForModel([
      {
        id: "ink",
        kind: "pen",
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        points: Array.from({ length: 40 }, (_, index) => [index, index] as [number, number]),
      },
    ]);
    expect(stroke[0]).toMatchObject({ id: "ink", strokePoints: 40 });
    expect(stroke[0]).not.toHaveProperty("points");
  });

  it("names a selection by id", () => {
    expect(whiteboardSelectionNote([{ id: "api", kind: "rect", text: "API" }])).toBe(
      "Selected on the whiteboard:\n- api (rect): API",
    );
    expect(whiteboardSelectionNote([])).toBe("");
  });
});
