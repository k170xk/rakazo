import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import { newerConversationVersion } from "./document-versions.js";
import { editedAttachmentId, staleBaseRefusal, staleDocumentBase } from "./ocsc-tool.js";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const owner = { spaceId: "space-1", userId: "user-1" };

type Row = {
  id: string;
  rootArtifactId: string | null;
  version: number;
  name: string;
  mimeType: string;
  source: string | null;
  spaceId: string;
  userId: string;
  createdAt: Date;
};

function row(id: string, version: number, source: string | null, extra: Partial<Row> = {}): Row {
  return {
    id,
    rootArtifactId: version === 1 ? null : "v1",
    version,
    name: "Report",
    mimeType: DOCX,
    source,
    ...owner,
    createdAt: new Date(version * 1000),
    ...extra,
  };
}

type Where = {
  id?: string | { in: string[] };
  spaceId?: string;
  userId?: string;
  OR?: Array<{ id?: string; rootArtifactId?: string }>;
};

function matches(candidate: Row, where: Where) {
  if (typeof where.id === "string" && candidate.id !== where.id) return false;
  if (typeof where.id === "object" && !where.id.in.includes(candidate.id)) return false;
  if (where.spaceId && candidate.spaceId !== where.spaceId) return false;
  if (where.userId && candidate.userId !== where.userId) return false;
  if (
    where.OR &&
    !where.OR.some(
      (or) =>
        (or.id !== undefined && candidate.id === or.id) ||
        (or.rootArtifactId !== undefined && candidate.rootArtifactId === or.rootArtifactId),
    )
  )
    return false;
  return true;
}

function fakePrisma(rows: Row[]) {
  return {
    artifact: {
      findFirst: async ({ where }: { where: Where }) =>
        rows.filter((r) => matches(r, where)).sort((a, b) => b.version - a.version)[0] ?? null,
      count: async ({ where }: { where: Where }) => rows.filter((r) => matches(r, where)).length,
    },
  } as unknown as Pick<PrismaClient, "artifact">;
}

const editArgs = (path: string) => [
  "edit",
  "--in",
  path,
  "--spec",
  "work/edits.json",
  "--out",
  "outputs/Report-v2.docx",
];

describe("editedAttachmentId", () => {
  it("reads the attachment an edit starts from", () => {
    expect(editedAttachmentId("word", editArgs("attachments/v1.docx"))).toBe("v1");
    expect(editedAttachmentId("word", ["accept", "--in", "./attachments/v1.docx"])).toBe("v1");
    expect(editedAttachmentId("pptx", ["edit", "--in", "attachments/d1.pptx"])).toBe("d1");
    expect(editedAttachmentId("xlsx", ["edit", "--in", "attachments/b1.xlsx"])).toBe("b1");
  });

  it("ignores reads, new files and the agent's own files", () => {
    expect(editedAttachmentId("word", ["read", "--in", "attachments/v1.docx"])).toBeUndefined();
    expect(editedAttachmentId("word", ["new", "--spec", "s.json"])).toBeUndefined();
    expect(editedAttachmentId("word", editArgs("outputs/Report.docx"))).toBeUndefined();
    expect(editedAttachmentId("pdf", ["convert", "--in", "attachments/v1.docx"])).toBeUndefined();
  });
});

describe("staleBaseRefusal", () => {
  it("names the person's studio edit and the newest file to fetch", () => {
    const refusal = staleBaseRefusal({ id: "v1", version: 1 }, row("v3", 3, "studio"));
    expect(refusal).toContain("attachments/v1.docx is version 1");
    expect(refusal).toContain('The person edited "Report" in the studio');
    expect(refusal).toContain("fetch_file with attachments/v3.docx");
    expect(refusal).toContain("--in attachments/v3.docx");
    expect(refusal).toContain('same name, "Report"');
  });

  it("says only that a newer version exists when the assistant made it", () => {
    const refusal = staleBaseRefusal({ id: "v1", version: 1 }, row("v2", 2, "assistant"));
    expect(refusal).toContain('"Report" has a newer version, 2');
    expect(refusal).not.toContain("studio");
  });

  it("lets an edit of the newest version run", () => {
    expect(staleBaseRefusal({ id: "v3", version: 3 }, row("v3", 3, "studio"))).toBeUndefined();
  });
});

describe("staleDocumentBase", () => {
  const family = [row("v1", 1, "assistant"), row("v2", 2, "studio")];

  it("refuses an edit of an older version of the file", async () => {
    const refusal = await staleDocumentBase(
      fakePrisma(family),
      owner,
      "word",
      editArgs("attachments/v1.docx"),
    );
    expect(refusal).toContain("fetch_file with attachments/v2.docx");
  });

  it("lets the newest version, another person's file and non-edits through", async () => {
    const prisma = fakePrisma(family);
    expect(
      await staleDocumentBase(prisma, owner, "word", editArgs("attachments/v2.docx")),
    ).toBeUndefined();
    expect(
      await staleDocumentBase(
        prisma,
        { ...owner, userId: "someone-else" },
        "word",
        editArgs("attachments/v1.docx"),
      ),
    ).toBeUndefined();
    expect(
      await staleDocumentBase(prisma, owner, "word", ["read", "--in", "attachments/v1.docx"]),
    ).toBeUndefined();
  });

  it("lets the edit run when the lookup fails", async () => {
    const broken = {
      artifact: {
        findFirst: async () => {
          throw new Error("database down");
        },
      },
    } as unknown as Pick<PrismaClient, "artifact">;
    expect(
      await staleDocumentBase(broken, owner, "word", editArgs("attachments/v1.docx")),
    ).toBeUndefined();
  });
});

describe("newerConversationVersion", () => {
  const family = [row("v1", 1, "assistant"), row("v2", 2, "studio")];

  it("allows the newest version of a file attached in the conversation", async () => {
    const found = await newerConversationVersion(fakePrisma(family), owner, "v2", ["v1"]);
    expect(found?.id).toBe("v2");
  });

  it("refuses older versions and files from outside the conversation", async () => {
    const prisma = fakePrisma([
      ...family,
      row("other", 1, "assistant", { name: "Elsewhere", rootArtifactId: null }),
    ]);
    expect(await newerConversationVersion(prisma, owner, "v1", ["v1"])).toBeUndefined();
    expect(await newerConversationVersion(prisma, owner, "other", ["v1"])).toBeUndefined();
    expect(await newerConversationVersion(prisma, owner, "v2", [])).toBeUndefined();
  });
});
