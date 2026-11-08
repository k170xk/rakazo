import { randomUUID } from "node:crypto";
import type { ArtifactStore } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { createDb, runAsSystem } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sweepChatAttachments } from "./file-cleanup.js";

const describePostgres =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

describePostgres("chat attachment cleanup (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let db: ReturnType<typeof createDb>;
  const id = randomUUID();
  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = db.prisma;
    await runAsSystem("test fixture", async () => {
      await prisma.user.create({
        data: { id, name: "Cleanup test", email: `${id}@example.test`, emailVerified: true },
      });
      await prisma.organization.create({
        data: { id, name: "Cleanup test", slug: id, createdAt: new Date() },
      });
      await prisma.space.create({
        data: { id, organizationId: id, name: "Cleanup test", isDefault: true },
      });
    });
  });
  afterAll(async () => {
    if (!db) return;
    await runAsSystem("test cleanup", async () => {
      await prisma.artifact.deleteMany({ where: { spaceId: id } });
      await prisma.space.deleteMany({ where: { id } });
      await prisma.organization.deleteMany({ where: { id } });
      await prisma.user.deleteMany({ where: { id } });
    });
    await prisma.$disconnect();
    await db.pool.end();
  });

  // Far in the past, so files other suites made today are never old enough to be swept here.
  const now = Date.parse("2001-01-01T00:00:00Z");
  const old = new Date("2000-01-01T00:00:00Z");
  const recent = new Date("2000-12-20T00:00:00Z");

  function artifact(input: {
    name: string;
    runId: string | null;
    createdAt: Date;
    rootArtifactId?: string;
    storageKey?: string;
  }) {
    return runAsSystem("test fixture", () =>
      prisma.artifact.create({
        data: {
          spaceId: id,
          userId: id,
          name: input.name,
          mimeType: "application/pdf",
          size: 1000,
          hash: input.name,
          storageKey: input.storageKey ?? `${id}/${input.name}`,
          runId: input.runId,
          createdAt: input.createdAt,
          rootArtifactId: input.rootArtifactId ?? null,
          version: input.rootArtifactId ? 2 : 1,
        },
      }),
    );
  }

  it("deletes old files bots made and keeps uploads and files with a recent version", async () => {
    const madeOld = await artifact({ name: "made-old", runId: "run", createdAt: old });
    const upload = await artifact({ name: "upload", runId: null, createdAt: old });
    const editedRoot = await artifact({ name: "edited", runId: "run", createdAt: old });
    const editedNew = await artifact({
      name: "edited-v2",
      runId: "run",
      createdAt: recent,
      rootArtifactId: editedRoot.id,
    });
    const staleRoot = await artifact({ name: "stale", runId: "run", createdAt: old });
    const staleV2 = await artifact({
      name: "stale-v2",
      runId: "run",
      createdAt: old,
      rootArtifactId: staleRoot.id,
    });
    const sharesUpload = await artifact({
      name: "shares-upload",
      runId: "run",
      createdAt: old,
      storageKey: upload.storageKey,
    });

    const removedKeys: string[] = [];
    const artifacts = {
      remove: async (key: string) => {
        removedKeys.push(key);
      },
    } as unknown as ArtifactStore;

    const result = await sweepChatAttachments({ prisma, artifacts, retentionDays: 30, now });

    const left = await runAsSystem("test assertion", () =>
      prisma.artifact.findMany({ where: { spaceId: id }, select: { id: true } }),
    );
    expect(left.map((row) => row.id).sort()).toEqual(
      [upload.id, editedRoot.id, editedNew.id].sort(),
    );
    expect(result.deletedItems).toBeGreaterThanOrEqual(4);
    expect(removedKeys).toEqual(
      expect.arrayContaining([madeOld.storageKey, staleRoot.storageKey, staleV2.storageKey]),
    );
    expect(removedKeys).not.toContain(upload.storageKey);
    expect(removedKeys).not.toContain(editedRoot.storageKey);
    expect(sharesUpload.storageKey).toBe(upload.storageKey);
  });
});
