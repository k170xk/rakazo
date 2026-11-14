import type { DocumentVersion } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { EDIT_INTENT_MS, isEditingKey, isPersonEdit } from "./edit-intent";
import { orderedOffices } from "./offices";
import { allReviewIds, reviewItems } from "./review";
import type { StudioAttachment } from "./studio-send";
import { studioAttachmentIds } from "./studio-send";
import type { DocxIssue } from "./validation";
import { newDocxErrors } from "./validation";
import { versionRows, withSavedVersion } from "./versions";

function version(
  n: number,
  source: DocumentVersion["source"],
  createdAt = `2026-11-${10 + n}T09:00:00.000Z`,
): DocumentVersion {
  return { artifactId: `a${n}`, version: n, size: 100 * n, createdAt, source };
}

describe("versionRows", () => {
  it("lists newest first with who made each version", () => {
    const rows = versionRows([version(1, null), version(3, "assistant"), version(2, "studio")], 2);
    expect(rows.map((row) => [row.version, row.author, row.latest, row.open])).toEqual([
      [3, "assistant", true, false],
      [2, "you", false, true],
      [1, "unknown", false, false],
    ]);
  });

  it("keeps one row per version number", () => {
    const rows = versionRows(
      [version(2, "studio"), { ...version(2, "assistant"), artifactId: "dup" }],
      null,
    );
    expect(rows).toHaveLength(1);
  });

  it("adds a version saved here once", () => {
    const saved = { artifactId: "a4", version: 4, size: 10, createdAt: "2026-11-14T10:00:00.000Z" };
    const once = withSavedVersion([version(3, "assistant")], saved);
    expect(once[0]).toEqual({ ...saved, source: "studio" });
    expect(withSavedVersion(once, saved)).toHaveLength(2);
  });
});

describe("newDocxErrors", () => {
  const broken: DocxIssue = {
    level: "error",
    code: "MISSING_PART",
    message: "rId9",
    partName: "/word/document.xml",
  };
  const warning: DocxIssue = { level: "warning", code: "ZERO_HEIGHT", message: "drawing" };

  it("blocks only errors the file did not open with", () => {
    expect(newDocxErrors([broken], [broken, warning])).toEqual([]);
    expect(newDocxErrors([], [broken, warning])).toEqual([broken]);
  });

  it("blocks errors when the opening check has not finished", () => {
    expect(newDocxErrors(null, [broken])).toEqual([broken]);
  });
});

describe("studioAttachmentIds", () => {
  const attachment: StudioAttachment = {
    artifactId: "a3",
    familyArtifactIds: ["a1", "a2", "a3"],
    botId: "bot1",
    groupId: null,
  };
  const fileBlock = (artifactId: string) => ({ blocks: [{ kind: "file", artifactId }] });

  it("attaches the newest version when the file is not in the conversation yet", () => {
    expect(studioAttachmentIds(attachment, { botId: "bot1" }, [fileBlock("other")])).toEqual([
      "a3",
    ]);
  });

  it("does not attach again when any version is already in the conversation", () => {
    expect(studioAttachmentIds(attachment, { botId: "bot1" }, [fileBlock("a1")])).toEqual([]);
  });

  it("never attaches another chat's file", () => {
    expect(studioAttachmentIds(attachment, { botId: "bot2" }, [])).toEqual([]);
    expect(studioAttachmentIds(attachment, { groupId: "g1" }, [])).toEqual([]);
    expect(studioAttachmentIds({ ...attachment, groupId: "g1" }, { botId: "bot1" }, [])).toEqual(
      [],
    );
    expect(studioAttachmentIds({ ...attachment, groupId: "g1" }, { groupId: "g1" }, [])).toEqual([
      "a3",
    ]);
    expect(studioAttachmentIds(null, { botId: "bot1" }, [])).toEqual([]);
  });
});

describe("reviewItems", () => {
  it("pairs a replacement and keeps single changes apart", () => {
    const items = reviewItems([
      { id: 1, type: "deletion", author: "OCSC Bot", date: "d1", text: "old" },
      { id: 2, type: "insertion", author: "OCSC Bot", date: "d1", text: "new" },
      { id: 3, type: "insertion", author: "Ann", date: "d2", text: "added" },
      { id: 4, type: "deletion", author: "OCSC Bot", date: "d3", text: "gone" },
    ]);
    expect(items.map((item) => [item.kind, item.ids, item.deleted, item.inserted])).toEqual([
      ["replace", [1, 2], "old", "new"],
      ["insert", [3], "", "added"],
      ["delete", [4], "gone", ""],
    ]);
    expect(allReviewIds(items)).toEqual([1, 2, 3, 4]);
  });
});

describe("edit intent", () => {
  it("counts keys that can change text", () => {
    expect(isEditingKey({ key: "a" })).toBe(true);
    expect(isEditingKey({ key: "Backspace" })).toBe(true);
    expect(isEditingKey({ key: "v", metaKey: true })).toBe(true);
    expect(isEditingKey({ key: "ArrowLeft" })).toBe(false);
    expect(isEditingKey({ key: "Shift" })).toBe(false);
    expect(isEditingKey({ key: "c", ctrlKey: true })).toBe(false);
  });

  it("treats a change as an edit only shortly after the person acted", () => {
    expect(isPersonEdit(null, 1000)).toBe(false);
    expect(isPersonEdit(1000, 1000 + EDIT_INTENT_MS)).toBe(true);
    expect(isPersonEdit(1000, 1001 + EDIT_INTENT_MS)).toBe(false);
  });
});

describe("orderedOffices", () => {
  it("puts the last office first", () => {
    expect(orderedOffices("Cork").slice(0, 2)).toEqual(["Cork", "Dublin"]);
    expect(orderedOffices("Paris")[0]).toBe("Dublin");
    expect(orderedOffices(null)).toHaveLength(6);
  });
});
