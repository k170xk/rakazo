import { describe, expect, it } from "vitest";
import { NEW_DOCUMENT_FLAG, documentRebuildRefusal, officeProgram } from "./ocsc-tool.js";

describe("officeProgram", () => {
  it("knows programmes by extension or type", () => {
    expect(officeProgram("House build.jantt", null)).toBe("plan");
    expect(officeProgram("plan", "application/vnd.jantt+json")).toBe("plan");
    expect(officeProgram("Report.docx", null)).toBe("word");
    expect(officeProgram("notes.txt", "text/plain")).toBeUndefined();
  });
});

describe("documentRebuildRefusal", () => {
  const programme = [{ name: "House build.jantt", path: "attachments/p1.jantt", program: "plan" as const }];

  it("stops a programme being made again over the one in the conversation", () => {
    const refusal = documentRebuildRefusal("plan", ["new", "--spec", "s.json", "--out", "p.jantt"], programme);
    expect(refusal).toContain("project programme");
    expect(refusal).toContain("ocsc plan edit --in <its path>");
    expect(refusal).toContain(".jantt");
  });

  it("allows a new programme when asked for one, or when there is none yet", () => {
    expect(
      documentRebuildRefusal("plan", ["new", "--out", "p.jantt", NEW_DOCUMENT_FLAG], programme),
    ).toBeUndefined();
    expect(documentRebuildRefusal("plan", ["new", "--out", "p.jantt"], [])).toBeUndefined();
    expect(documentRebuildRefusal("plan", ["edit", "--in", "attachments/p1.jantt"], programme)).toBeUndefined();
  });
});
