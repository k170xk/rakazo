import { describe, expect, it } from "vitest";
import { mergeAppFiles } from "./app-code-merge";

describe("mergeAppFiles", () => {
  const base = { "App.tsx": "app v1", "theme.css": "css v1", "Chart.tsx": "chart v1" };

  it("keeps the person's edits and the newer version's changes to other files", () => {
    const mine = { ...base, "theme.css": "css mine" };
    const newer = { ...base, "App.tsx": "app ai", "Table.tsx": "table ai" };
    expect(mergeAppFiles(base, mine, newer)).toEqual({
      files: {
        "App.tsx": "app ai",
        "theme.css": "css mine",
        "Chart.tsx": "chart v1",
        "Table.tsx": "table ai",
      },
      conflicts: [],
    });
  });

  it("keeps a file the person added and drops one the newer version removed", () => {
    const mine = { ...base, "Notes.tsx": "notes" };
    const { "Chart.tsx": _removed, ...newer } = base;
    expect(mergeAppFiles(base, mine, newer).files).toEqual({
      "App.tsx": "app v1",
      "theme.css": "css v1",
      "Notes.tsx": "notes",
    });
  });

  it("reports a file both sides changed differently, keeping the newer text", () => {
    const mine = { ...base, "App.tsx": "app mine" };
    const newer = { ...base, "App.tsx": "app ai" };
    expect(mergeAppFiles(base, mine, newer)).toEqual({
      files: { ...base, "App.tsx": "app ai" },
      conflicts: ["App.tsx"],
    });
  });

  it("treats the same change on both sides as agreement", () => {
    const same = { ...base, "App.tsx": "app same" };
    expect(mergeAppFiles(base, same, same)).toEqual({ files: same, conflicts: [] });
  });
});
