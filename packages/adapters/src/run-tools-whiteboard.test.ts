import { beforeEach, describe, expect, it, vi } from "vitest";

const publishMessage = vi.fn();
vi.mock("./run-messages.js", async (importActual) => ({
  ...(await importActual<typeof import("./run-messages.js")>()),
  publishMessage: (...args: unknown[]) => publishMessage(...args),
}));

const { whiteboardTools } = await import("./run-tools-whiteboard.js");

const board = (text: string) =>
  JSON.stringify({
    items: [
      { id: "api", kind: "rect", x: 40, y: 40, w: 160, h: 80, text, color: "green" },
      { id: "db", kind: "cylinder", x: 280, y: 40, w: 140, h: 90, text: "Postgres", color: "blue" },
    ],
  });

function context(
  tx: Record<string, unknown>,
  existing?: { currentVersion: number; kind?: string },
) {
  const prisma = {
    page: {
      findFirst: vi.fn(async () =>
        existing
          ? {
              id: "board-1",
              kind: existing.kind ?? "whiteboard",
              title: "Architecture",
              currentVersion: existing.currentVersion,
              versions: [{ source: board("API") }],
            }
          : null,
      ),
      findUniqueOrThrow: vi.fn(),
    },
    $transaction: vi.fn(async (work: (client: unknown) => unknown) => work(tx)),
  };
  return {
    deps: { prisma },
    run: { id: "run-1", spaceId: "space-1", userId: "user-1", threadId: "t-1", botId: "bot-1" },
    bot: { id: "bot-1" },
    thread: { groupId: null },
    secrets: [],
    state: { tainted: false },
    runId: "run-1",
  } as never;
}

const call = (args: Record<string, unknown>) =>
  ({ args, finish: (result: unknown) => result }) as never;

describe("save_whiteboard", () => {
  beforeEach(() => publishMessage.mockReset());

  it("creates a board and posts its card", async () => {
    const tx = { page: { create: vi.fn(async () => ({ id: "board-1", title: "Architecture" })) } };
    const result = (await whiteboardTools.save_whiteboard!(
      context(tx),
      call({
        title: "Architecture",
        items: [
          { id: "api", kind: "rect", text: "API" },
          { id: "db", kind: "cylinder", text: "Postgres" },
          { id: "link", kind: "arrow", from: { item: "api" }, to: { item: "db" } },
        ],
      }),
    )) as { whiteboardId: string; version: number; items: { id: string }[] };
    expect(tx.page.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "whiteboard", title: "Architecture" }),
    });
    expect(result).toMatchObject({ whiteboardId: "board-1", version: 1 });
    expect(result.items.map((item) => item.id)).toEqual(["api", "db", "link"]);
    expect(publishMessage).toHaveBeenCalledTimes(1);
  });

  it("updates one block and leaves the rest", async () => {
    const tx = {
      page: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: vi.fn(async () => ({ title: "Architecture" })),
        update: vi.fn(),
      },
      pageVersion: { create: vi.fn() },
    };
    const result = (await whiteboardTools.save_whiteboard!(
      context(tx, { currentVersion: 2 }),
      call({
        whiteboardId: "board-1",
        baseVersion: 2,
        ops: [{ op: "update", id: "db", patch: { text: "Postgres 16" } }],
      }),
    )) as { version: number; items: { id: string; text?: string }[] };
    expect(result.version).toBe(3);
    expect(result.items.find((item) => item.id === "api")?.text).toBe("API");
    expect(result.items.find((item) => item.id === "db")?.text).toBe("Postgres 16");
    expect(publishMessage).not.toHaveBeenCalled();
  });

  it("refuses a stale version and returns the board to read again", async () => {
    const read = context({}, { currentVersion: 4 });
    const result = (await whiteboardTools.save_whiteboard!(
      read,
      call({
        whiteboardId: "board-1",
        baseVersion: 3,
        ops: [{ op: "update", id: "api", patch: { text: "Gateway" } }],
      }),
    )) as { error: string; version: number; unchanged: boolean };
    expect(result.unchanged).toBe(true);
    expect(result.version).toBe(4);
    expect(result.error).toMatch(/changed/);
    expect((read as { state: { tainted: boolean } }).state.tainted).toBe(true);
  });
});
