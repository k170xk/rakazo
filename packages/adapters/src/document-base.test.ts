import { describe, expect, it, vi } from "vitest";
import { documentBaseVersion, noteDocumentRead, staleSaveRefusal } from "./document-base.js";
import type { RunContext } from "./run-context.js";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type Version = { id: string; version: number; rootArtifactId: string | null };

function context(versions: Version[], documents: RunContext["state"]["documents"]) {
  const newestFirst = [...versions].sort((a, b) => b.version - a.version);
  const prisma = {
    artifact: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string; OR?: unknown } }) => {
        const row = where.id ? versions.find((version) => version.id === where.id) : newestFirst[0];
        return row
          ? { ...row, name: "Schedule", mimeType: XLSX, source: "assistant", createdAt: new Date() }
          : null;
      }),
    },
    $transaction: vi.fn(),
  };
  return {
    deps: { prisma },
    run: { spaceId: "s", userId: "u" },
    context: { spaceId: "s", userId: "u" },
    computer: {},
    state: { documents },
  } as unknown as RunContext;
}

const target = { botId: "b", groupId: undefined, name: "Schedule", rootId: "v1" };
const family: Version[] = [
  { id: "v1", version: 1, rootArtifactId: null },
  { id: "v2", version: 2, rootArtifactId: "v1" },
  { id: "v3", version: 3, rootArtifactId: "v1" },
];

describe("saving over a newer version", () => {
  it("refuses a save built on an older version than the newest", async () => {
    const documents = { made: [], attached: false } as RunContext["state"]["documents"];
    noteDocumentRead(documents, "v1", 2);
    const refusal = await staleSaveRefusal(context(family, documents), "outputs/s.xlsx", target);
    expect(refusal).toContain("version 3");
    expect(refusal).toContain("read version 2");
    expect(refusal).toContain("fetch_file with attachments/v3.xlsx");
  });

  it("allows a save built on the newest version", async () => {
    const documents = { made: [], attached: false } as RunContext["state"]["documents"];
    noteDocumentRead(documents, "v1", 3);
    expect(
      await staleSaveRefusal(context(family, documents), "outputs/s.xlsx", target),
    ).toBeUndefined();
  });

  it("leaves ocsc edits to the rebase, and files whose starting version is unknown", async () => {
    const lineage = new Map([
      [
        "outputs/s.xlsx",
        {
          rootId: "v1",
          baseId: "v1",
          baseVersion: 1,
          name: "Schedule",
          mimeType: XLSX,
          steps: [{ program: "xlsx", args: ["edit"], output: "outputs/s.xlsx" }],
        },
      ],
    ]);
    const edited = { made: [], attached: false, lineage } as never;
    expect(await staleSaveRefusal(context(family, edited), "outputs/s.xlsx", target)).toBe(
      undefined,
    );
    const fresh = { made: [], attached: false } as RunContext["state"]["documents"];
    expect(await staleSaveRefusal(context(family, fresh), "outputs/s.xlsx", target)).toBe(
      undefined,
    );
  });

  it("takes the newest known starting point from reads, the studio and edits", () => {
    const documents = { made: [], attached: false } as RunContext["state"]["documents"];
    noteDocumentRead(documents, "v1", 1);
    noteDocumentRead(documents, "v1", 0);
    expect(documentBaseVersion(documents, undefined, "v1")).toBe(1);
    expect(documentBaseVersion(documents, { rootId: "v1", versions: [{ version: 4 }] }, "v1")).toBe(
      4,
    );
    expect(documentBaseVersion(documents, undefined, "other")).toBeUndefined();
  });
});
