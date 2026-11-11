import type { Actor } from "@rakazo/contracts";
import { unzipSync } from "fflate";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@rakazo/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@rakazo/db")>();
  return {
    ...actual,
    runAsSystem: async <T>(_reason: string, fn: () => T | PromiseLike<T>) => fn(),
    runAsTenant: async <T>(_tenant: unknown, fn: () => T | PromiseLike<T>) => fn(),
  };
});

vi.mock("@rakazo/adapters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@rakazo/adapters")>();
  return {
    ...actual,
    personUsage: async () => ({
      computerBytes: 0,
      chatBytes: 0,
      usedBytes: 0,
      limitBytes: 2048 * 1024 * 1024,
    }),
  };
});

const { deleteArtifactFamily } = vi.hoisted(() => ({
  deleteArtifactFamily: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("./artifacts.js", () => ({ deleteArtifactFamily }));

import { deleteMyStorage, mountStorageDownloadRoute, STORAGE_DOWNLOAD_PATH } from "./my-storage.js";

const me: Actor = {
  userId: "me",
  spaceId: "space-me",
  email: "me@example.test",
  isDeploymentOwner: false,
};

/** Bots and chat files for two people; every query answers only for the person it names. */
function fakeDeps() {
  const bots = [
    { id: "bot-mine", name: "Mine", userId: "me", archivedAt: null, computer: null },
    { id: "bot-theirs", name: "Theirs", userId: "them", archivedAt: null, computer: null },
  ];
  const families = [
    { family: "fam-mine", spaceId: "space-me", name: "deck.pptx", botId: "bot-mine", userId: "me" },
    {
      family: "fam-theirs",
      spaceId: "space-them",
      name: "plan.pdf",
      botId: "bot-theirs",
      userId: "them",
    },
  ];
  const prisma = {
    bot: {
      findMany: vi.fn(async ({ where }: { where: { userId: string } }) =>
        bots.filter((bot) => bot.userId === where.userId),
      ),
    },
    $queryRaw: vi.fn(async (sql: { values: unknown[] }) => {
      const userId = sql.values[0];
      return families
        .filter((row) => row.userId === userId)
        .map((row) => ({ ...row, size: 10n, createdAt: new Date("2026-11-01T00:00:00Z") }));
    }),
    artifact: {
      findFirst: vi.fn(async () => ({ id: "fam-mine", storageKey: "key-mine", botId: "bot-mine" })),
    },
  };
  const artifacts = { get: vi.fn(async () => new TextEncoder().encode("slides")) };
  return {
    prisma,
    artifacts,
    home: { describe: () => ({ id: "test" }) },
    dataDir: undefined,
    sandbox: { describe: () => ({ capabilities: {} }) },
  } as unknown as Parameters<typeof deleteMyStorage>[0];
}

beforeEach(() => deleteArtifactFamily.mockClear());

describe("deleting from Manage storage", () => {
  it("refuses the whole request when any item belongs to someone else", async () => {
    const deps = fakeDeps();
    await expect(
      deleteMyStorage(deps, me, [
        { kind: "chat", artifactId: "fam-mine" },
        { kind: "chat", artifactId: "fam-theirs" },
      ]),
    ).rejects.toThrow(/no longer there/);
    await expect(
      deleteMyStorage(deps, me, [{ kind: "computer", botId: "bot-theirs", path: "report.docx" }]),
    ).rejects.toThrow(/no longer there/);
    expect(deleteArtifactFamily).not.toHaveBeenCalled();
  });

  it("deletes the caller's own chat file in the space it belongs to", async () => {
    await deleteMyStorage(fakeDeps(), me, [{ kind: "chat", artifactId: "fam-mine" }]);
    expect(deleteArtifactFamily).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "me", spaceId: "space-me" }),
      { familyId: "fam-mine" },
    );
  });
});

describe("GET /api/storage/download", () => {
  function mount(grant: { userId: string; items: unknown[] } | null) {
    const app = new Hono();
    const deps = fakeDeps();
    mountStorageDownloadRoute(app, {
      ...(deps as object),
      auth: { consumeStorageDownloadToken: vi.fn(async () => grant) },
    } as unknown as Parameters<typeof mountStorageDownloadRoute>[1]);
    return app;
  }

  it("refuses an expired or reused link", async () => {
    const response = await mount(null).request(`${STORAGE_DOWNLOAD_PATH}?token=used`);
    expect(response.status).toBe(410);
  });

  it("zips only what the link's holder still owns", async () => {
    const response = await mount({
      userId: "me",
      items: [
        { kind: "chat", artifactId: "fam-mine" },
        { kind: "chat", artifactId: "fam-theirs" },
        { kind: "computer", botId: "bot-theirs", path: "report.docx" },
      ],
    }).request(`${STORAGE_DOWNLOAD_PATH}?token=ok`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(files)).toEqual(["Chat files/Mine/deck.pptx"]);
    expect(new TextDecoder().decode(files["Chat files/Mine/deck.pptx"])).toBe("slides");
  });
});
