import { describe, expect, it } from "vitest";
import { diffFiles, diffLines, toHunks } from "./line-diff";

const kinds = (before: string, after: string) =>
  diffLines(before, after).lines.map((line) => `${line.kind[0]}${line.text}`);

describe("line diff", () => {
  it("marks added, removed and unchanged lines in order", () => {
    expect(kinds("a\nb\nc\n", "a\nx\nc\nd\n")).toEqual(["sa", "rb", "ax", "sc", "ad"]);
    expect(kinds("", "one\n")).toEqual(["aone"]);
    expect(kinds("one\n", "")).toEqual(["rone"]);
    expect(kinds("same\n", "same\n")).toEqual(["ssame"]);
  });

  it("numbers lines on both sides", () => {
    const { lines } = diffLines("a\nb\n", "b\nc\n");
    expect(lines).toEqual([
      { kind: "removed", text: "a", oldLine: 1 },
      { kind: "same", text: "b", oldLine: 2, newLine: 1 },
      { kind: "added", text: "c", newLine: 2 },
    ]);
  });

  it("keeps three lines of context and counts what it skips", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 10", "line ten");
    const hunks = toHunks(diffLines(before, after).lines);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.skippedBefore).toBe(7);
    expect(hunks[0]!.lines.map((line) => line.kind)).toEqual([
      "same",
      "same",
      "same",
      "removed",
      "added",
      "same",
      "same",
      "same",
    ]);
  });

  it("lists only the files that changed, App.tsx first, with counts", () => {
    const result = diffFiles(
      { "App.tsx": "a\nb\n", "Old.tsx": "x\n", "Same.tsx": "s\n" },
      { "App.tsx": "a\nc\n", "New.tsx": "y\n", "Same.tsx": "s\n" },
    );
    expect(result.map((file) => [file.name, file.status, file.added, file.removed])).toEqual([
      ["App.tsx", "changed", 1, 1],
      ["New.tsx", "added", 1, 0],
      ["Old.tsx", "removed", 0, 1],
    ]);
  });

  it("shows a wholly rewritten huge file without searching forever", () => {
    const a = Array.from({ length: 800 }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: 800 }, (_, i) => `b${i}`).join("\n");
    const { lines, rewritten } = diffLines(a, b);
    expect(rewritten).toBe(true);
    expect(lines).toHaveLength(1600);
  });
});
