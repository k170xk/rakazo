import { randomUUID } from "node:crypto";
import type { AgentHomeStore } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { createDb, runAsSystem } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { expiringFilesByPerson, expiringFilesNotice } from "./file-cleanup.js";
import { chatAttachmentBytes, chatAttachmentBytesByPerson } from "./file-retention.js";

vi.mock("./company-policy.js", async (original) => {
  const actual = await original<typeof import("./company-policy.js")>();
  return {
    ...actual,
    companyTools: () => ({ ...actual.companyTools(), chatFileRetentionDays: 60 }),
  };
});

const describePostgres =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

const DAY = 86_400_000;

describePostgres("storage counted against a person (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let db: ReturnType<typeof createDb>;
  const id = randomUUID();
  const other = randomUUID();
  const botId = randomUUID();
  // Far in the past, so files other suites made are never inside the warning window here.
  const now = Date.parse("2001-01-01T00:00:00Z");

  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = db.prisma;
    await runAsSystem("test fixture", async () => {
      for (const userId of [id, other]) {
        await prisma.user.create({
          data: {
            id: userId,
            name: "Usage test",
            email: `${userId}@example.test`,
            emailVerified: true,
          },
        });
      }
      await prisma.organization.create({
        data: { id, name: "Usage test", slug: id, createdAt: new Date() },
      });
      await prisma.space.create({
        data: { id, organizationId: id, name: "Usage test", isDefault: true },
      });
      await prisma.bot.create({
        data: { id: botId, spaceId: id, userId: id, name: "Usage agent", color: "ink" },
      });
    });
  });

  afterAll(async () => {
    if (!db) return;
    await runAsSystem("test cleanup", async () => {
      await prisma.artifact.deleteMany({ where: { spaceId: id } });
      await prisma.bot.deleteMany({ where: { id: botId } });
      await prisma.space.deleteMany({ where: { id } });
      await prisma.organization.deleteMany({ where: { id } });
      await prisma.user.deleteMany({ where: { id: { in: [id, other] } } });
    });
    await prisma.$disconnect();
    await db.pool.end();
  });

  function artifact(input: {
    userId?: string;
    name: string;
    runId: string | null;
    size: number;
    createdAt: Date;
    rootArtifactId?: string;
    storageKey?: string;
    source?: string;
  }) {
    return runAsSystem("test fixture", () =>
      prisma.artifact.create({
        data: {
          spaceId: id,
          userId: input.userId ?? id,
          botId,
          name: input.name,
          mimeType: "application/pdf",
          size: input.size,
          hash: input.name,
          storageKey: input.storageKey ?? `${id}/${input.name}`,
          runId: input.runId,
          createdAt: input.createdAt,
          rootArtifactId: input.rootArtifactId ?? null,
          version: input.rootArtifactId ? 2 : 1,
          source: input.source ?? null,
        },
      }),
    );
  }

  it("counts files agents attached once each, never uploads or files a person started", async () => {
    const soon = new Date(now - 55 * DAY);
    const made = await artifact({ name: "made", runId: "run", size: 1000, createdAt: soon });
    await artifact({
      name: "made-copy",
      runId: "run",
      size: 1000,
      createdAt: soon,
      storageKey: made.storageKey,
    });
    await artifact({ name: "upload", runId: null, size: 50_000, createdAt: soon });
    const started = await artifact({ name: "started", runId: null, size: 7000, createdAt: soon });
    await artifact({
      name: "started-v2",
      runId: "run",
      size: 7000,
      createdAt: soon,
      rootArtifactId: started.id,
    });
    await artifact({
      userId: other,
      name: "theirs",
      runId: "run",
      size: 300,
      createdAt: new Date(now - 10 * DAY),
    });

    // "made" and "made-copy" share one stored file but are two chat files.
    expect(await chatAttachmentBytes(prisma, id)).toBe(1000);
    expect(await chatAttachmentBytes(prisma, other)).toBe(300);
    const everyone = new Map(
      (await chatAttachmentBytesByPerson(prisma)).map((row) => [row.userId, Number(row.bytes)]),
    );
    expect(everyone.get(id)).toBe(1000);
    expect(everyone.get(other)).toBe(300);
  });

  it("warns each person once about chat files cleanup deletes within a week", async () => {
    const home = { describe: () => ({ id: "test" }) } as unknown as AgentHomeStore;
    const expiring = await expiringFilesByPerson({ prisma, home, dataDir: undefined, now });
    const mine = expiring.find((person) => person.userId === id);
    expect(mine).toMatchObject({ files: 2, bytes: 2000, botId });
    expect(mine!.firstDeletesAt.getTime()).toBe(now + 5 * DAY);
    // Theirs was made 10 days ago, so cleanup deletes it in 50 days: no warning yet.
    expect(expiring.find((person) => person.userId === other)).toBeUndefined();
    expect(expiringFilesNotice(mine!).body).toMatch(
      /^2 files \(2 KB\) will be deleted from .+ Open Manage storage/,
    );
  });

  it("counts and expires versions a person saved from a studio with the agent's file", async () => {
    const soon = new Date(now - 55 * DAY);
    const report = await artifact({ name: "report", runId: "run", size: 400, createdAt: soon });
    await artifact({
      name: "report-studio",
      runId: null,
      source: "studio",
      size: 600,
      createdAt: soon,
      rootArtifactId: report.id,
    });
    const upload = await artifact({ name: "own", runId: null, size: 9000, createdAt: soon });
    await artifact({
      name: "own-studio",
      runId: null,
      source: "studio",
      size: 9000,
      createdAt: soon,
      rootArtifactId: upload.id,
    });

    expect(await chatAttachmentBytes(prisma, id)).toBe(2000);
    const home = { describe: () => ({ id: "test" }) } as unknown as AgentHomeStore;
    const expiring = await expiringFilesByPerson({ prisma, home, dataDir: undefined, now });
    expect(expiring.find((person) => person.userId === id)).toMatchObject({
      files: 3,
      bytes: 3000,
    });
  });
});
