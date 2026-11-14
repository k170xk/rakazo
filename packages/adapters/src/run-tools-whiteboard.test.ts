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

  it("moves and resizes one block without touching the others", async () => {
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
        ops: [{ op: "update", id: "db", patch: { x: 420, y: 160, w: 240, h: 140, color: "pink" } }],
      }),
    )) as {
      items: { id: string; x: number; y: number; w: number; h: number; color?: string }[];
    };
    const db = result.items.find((item) => item.id === "db");
    const api = result.items.find((item) => item.id === "api");
    expect(db).toMatchObject({ x: 420, y: 160, w: 240, h: 140, color: "pink" });
    expect(api).toMatchObject({ x: 40, y: 40, w: 160, h: 80 });
  });

  it("places a pen drawn in canvas coordinates onto the stroke", async () => {
    const create = vi.fn(async (_arg: unknown) => ({ id: "board-1", title: "Sketch" }));
    const tx = { page: { create } };
    await whiteboardTools.save_whiteboard!(
      context(tx),
      call({
        title: "Sketch",
        items: [
          {
            id: "stroke",
            kind: "pen",
            points: [
              [100, 80],
              [160, 40],
              [200, 90],
            ],
          },
        ],
      }),
    );
    const saved = create.mock.calls[0]?.[0] as {
      data: { versions: { create: { source: string } } };
    };
    const pen = JSON.parse(saved.data.versions.create.source).items[0] as {
      x: number;
      y: number;
      points: [number, number][];
    };
    expect(pen.x).toBe(100);
    expect(pen.y).toBe(40);
    expect(pen.points[0]).toEqual([0, 40]);
    expect(pen.points[2]).toEqual([100, 50]);
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

  it("preserves explicit coordinates and reports overlap and section containment diagnostics", async () => {
    const create = vi.fn(async () => ({ id: "board-2", title: "Manual Coordinates" }));
    const tx = { page: { create } };
    const result = (await whiteboardTools.save_whiteboard!(
      context(tx),
      call({
        title: "Manual Coordinates",
        items: [
          { id: "sec", kind: "section", x: 50, y: 50, w: 500, h: 320, text: "Phase 1" },
          { id: "n1", kind: "rect", x: 90, y: 130, w: 200, h: 90, text: "Step A" },
          { id: "n2", kind: "sticky", x: 220, y: 160, w: 190, h: 150, text: "Callout note" },
        ],
      }),
    )) as {
      items: Array<{ id: string; x: number; y: number }>;
      layoutSummary: { containedInSection: string[]; overlaps: string[]; note?: string };
    };
    expect(result.items.find((i) => i.id === "n1")).toMatchObject({ x: 90, y: 130 });
    expect(result.items.find((i) => i.id === "n2")).toMatchObject({ x: 220, y: 160 });
    expect(result.layoutSummary.containedInSection).toContain("n1 in sec");
    expect(result.layoutSummary.overlaps[0]).toContain("n1");
    expect(result.layoutSummary.note).toMatch(/intentional/i);
  });

  it("embeds Evolve infographics and project datasheet photos on kind image items", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "content-type": "image/png" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const tx = {
      page: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: vi.fn(async () => ({ title: "Architecture" })),
        update: vi.fn(),
      },
      pageVersion: { create: vi.fn() },
    };
    const ctx = context(tx, { currentVersion: 2 }) as {
      deps: {
        evolvePlugins?: { url: string };
        prisma: {
          appAsset?: { aggregate: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
        };
      };
    };
    ctx.deps.evolvePlugins = { url: "https://evolve.example.co" };
    let seq = 0;
    ctx.deps.prisma.appAsset = {
      aggregate: vi.fn(async () => ({ _sum: { size: 0 } })),
      create: vi.fn(async ({ data }: { data: { name: string; mime: string; size: number } }) => ({
        id: `asset-${++seq}`,
        name: data.name,
        mime: data.mime,
        size: data.size,
      })),
    };

    const result = (await whiteboardTools.save_whiteboard!(
      ctx as never,
      call({
        whiteboardId: "board-1",
        baseVersion: 2,
        ops: [
          {
            op: "add",
            item: {
              id: "info1",
              kind: "image",
              url: "https://evolve.example.co/storage/v1/object/public/slide-assets/infographics/99aa-11.png",
              text: "Flood Risk Stages",
            },
          },
          {
            op: "add",
            item: {
              id: "proj1",
              kind: "image",
              url: "https://evolve.example.co/storage/v1/object/public/project-images/2401/cover.jpg",
              text: "Athlone Footbridge",
            },
          },
        ],
      }),
    )) as { items: Array<{ id: string; asset?: string }> };

    expect(result.items.find((i) => i.id === "info1")?.asset).toBe("asset-1");
    expect(result.items.find((i) => i.id === "proj1")?.asset).toBe("asset-2");
    vi.unstubAllGlobals();
  });
});
