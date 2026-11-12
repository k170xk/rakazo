import { beforeEach, describe, expect, it, vi } from "vitest";

const publishMessage = vi.fn();
vi.mock("./run-messages.js", async (importActual) => ({
  ...(await importActual<typeof import("./run-messages.js")>()),
  publishMessage: (...args: unknown[]) => publishMessage(...args),
}));

const { pageTools } = await import("./run-tools-pages.js");
const { redactBlocks } = await import("./run-messages.js");

const source = (heading: string) =>
  `const App = () => (\n  <Page title="${heading}">\n    <Text>Hi</Text>\n  </Page>\n);\nexport default App;\n`;

function context(
  tx: Record<string, unknown>,
  existing?: { currentVersion: number },
  secrets: string[] = [],
) {
  const prisma = {
    page: {
      findFirst: vi.fn(async () =>
        existing
          ? {
              id: "page-1",
              title: "Plan",
              currentVersion: existing.currentVersion,
              versions: [{ source: source("Plan") }],
              state: [{ key: "done", value: { W407: true } }],
            }
          : null,
      ),
    },
    $transaction: vi.fn(async (work: (client: unknown) => unknown) => work(tx)),
  };
  return {
    deps: { prisma },
    run: { id: "run-1", spaceId: "space-1", userId: "user-1", threadId: "t-1", botId: "bot-1" },
    bot: { id: "bot-1" },
    thread: { groupId: null },
    secrets,
    state: { tainted: false },
  } as never;
}

const call = (args: Record<string, unknown>) =>
  ({ args, finish: (result: unknown) => result }) as never;

describe("save_page", () => {
  beforeEach(() => publishMessage.mockReset());

  it("makes no new page where save_app is offered, so new apps are built in the App Studio", async () => {
    const tx = { page: { create: vi.fn() } };
    const ctx = Object.assign(context(tx), { tools: { offered: [{ name: "save_app" }] } });
    const finish = vi.fn((result: unknown) => result);
    const result = (await pageTools.save_page!(
      ctx as never,
      {
        args: { title: "Plan", source: source("Plan") },
        finish,
      } as never,
    )) as { error?: string };
    expect(result.error).toMatch(/save_app/);
    expect(tx.page.create).not.toHaveBeenCalled();
  });

  it("keeps a saved page when its chat card cannot be posted, and says how to link it", async () => {
    publishMessage.mockRejectedValueOnce(new Error("run was cancelled"));
    const tx = { page: { create: vi.fn(async () => ({ id: "page-1", title: "Plan" })) } };
    const result = (await pageTools.save_page!(
      context(tx),
      call({ title: "Plan", source: source("Plan") }),
    )) as Record<string, unknown>;
    expect(tx.page.create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ pageId: "page-1", version: 1, title: "Plan" });
    expect(result.error).toMatch(/saved, but its card could not be posted/);
    expect(result.error).toContain("[Plan](page:page-1)");
  });

  it("taints the run when it reads a page's stored source, but not when it saves one", async () => {
    const read = context({}, { currentVersion: 2 });
    const result = (await pageTools.save_page!(read, call({ pageId: "page-1" }))) as Record<
      string,
      unknown
    >;
    expect(result.source).toBe(source("Plan"));
    expect((read as { state: { tainted: boolean } }).state.tainted).toBe(true);

    const tx = { page: { create: vi.fn(async () => ({ id: "page-2", title: "New" })) } };
    const save = context(tx);
    await pageTools.save_page!(save, call({ title: "New", source: source("New") }));
    expect(tx.page.create).toHaveBeenCalledTimes(1);
    expect((save as { state: { tainted: boolean } }).state.tainted).toBe(false);
  });

  it("treats an empty edits list as not sent, as it does a blank title or source", async () => {
    const tx = { page: { create: vi.fn(async () => ({ id: "page-1", title: "Plan" })) } };
    const created = (await pageTools.save_page!(
      context(tx),
      call({ title: "Plan", source: source("Plan"), edits: [] }),
    )) as Record<string, unknown>;
    expect(created).toMatchObject({ pageId: "page-1", version: 1 });
    expect(tx.page.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        versions: { create: expect.objectContaining({ code: expect.stringContaining("Plan") }) },
      }),
    });
    // Reading a page back with an empty list returns its source rather than an error.
    const read = (await pageTools.save_page!(
      context({}, { currentVersion: 3 }),
      call({ pageId: "page-1", edits: [], source: "" }),
    )) as Record<string, unknown>;
    expect(read).toEqual({
      pageId: "page-1",
      version: 3,
      title: "Plan",
      source: source("Plan"),
      state: { done: { W407: true } },
    });
  });

  it("never stores a run secret in a page's source, title or chat card", async () => {
    const secret = "FAKE_PAGE_SECRET_7246";
    const tx = {
      page: {
        create: vi.fn(async ({ data }: { data: { title: string } }) => ({
          id: "page-1",
          title: data.title,
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      pageVersion: { create: vi.fn() },
    };
    const refused = [
      call({ title: "Plan", source: source(secret) }),
      call({ pageId: "page-1", source: source(secret) }),
      call({ pageId: "page-1", edits: [{ find: 'title="Plan"', replace: `title="${secret}"` }] }),
    ];
    for (const [index, args] of refused.entries()) {
      const existing = index === 0 ? undefined : { currentVersion: 1 };
      const result = (await pageTools.save_page!(context(tx, existing, [secret]), args)) as Record<
        string,
        unknown
      >;
      expect(result).toMatchObject({ unchanged: true, error: expect.stringMatching(/secret/) });
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    expect(tx.page.create).not.toHaveBeenCalled();
    expect(tx.pageVersion.create).not.toHaveBeenCalled();
    expect(publishMessage).not.toHaveBeenCalled();

    const titled = (await pageTools.save_page!(
      context(tx, undefined, [secret]),
      call({ title: `Keys ${secret}`, source: source("Plan") }),
    )) as Record<string, unknown>;
    expect(titled.title).toBe("Keys [redacted]");
    expect(JSON.stringify(tx.page.create.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(publishMessage.mock.calls)).not.toContain(secret);
    // A page card in a run's reply is redacted like its text.
    expect(
      redactBlocks(
        [{ kind: "page", pageId: "page-1", version: 1, title: `A ${secret}` }],
        [secret],
      ),
    ).toEqual([{ kind: "page", pageId: "page-1", version: 1, title: "A [redacted]" }]);
  });

  it("redacts a kept title that holds a secret this run learned after it was saved", async () => {
    const secret = "FAKE_PAGE_SECRET_9132";
    const tx = {
      page: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: vi.fn(async () => ({ title: `Keys ${secret}` })),
        update: vi.fn(),
      },
      pageVersion: { create: vi.fn() },
    };
    const result = (await pageTools.save_page!(
      context(tx, { currentVersion: 1 }, [secret]),
      call({ pageId: "page-1", source: source("Plan") }),
    )) as Record<string, unknown>;
    expect(result.title).toBe("Keys [redacted]");
    expect(tx.page.update).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: { title: "Keys [redacted]" },
    });
    expect(JSON.stringify(tx.pageVersion.create.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(publishMessage.mock.calls)).not.toContain(secret);
  });

  it("refreshes a page's data for a routine without touching its code or posting a card", async () => {
    const tx = {
      page: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: vi.fn(async () => ({ title: "Plan" })),
        update: vi.fn(),
      },
      pageVersion: { create: vi.fn() },
    };
    const ctx = context(tx, { currentVersion: 3 }) as unknown as { run: { trigger?: string } };
    ctx.run.trigger = "routine";
    const result = (await pageTools.save_page!(
      ctx as never,
      call({ pageId: "page-1", data: { jobs: [{ id: "W407" }] } }),
    )) as Record<string, unknown>;
    expect(result).toMatchObject({ pageId: "page-1", version: 4 });
    expect(result.warnings).toEqual([
      'data "jobs" was saved, but the page never calls useSource("jobs"), so it shows nothing.',
    ]);
    const saved = (
      tx.pageVersion.create.mock.calls[0] as unknown as [{ data: { source: string } }]
    )[0].data.source;
    expect(saved.startsWith('/* page-sources\n{"jobs":{"snapshot":[{"id":"W407"}],"asOf":"')).toBe(
      true,
    );
    expect(saved.endsWith(source("Plan"))).toBe(true);
    expect(publishMessage).not.toHaveBeenCalled();
  });

  it("refuses data that is not keyed by source ids", async () => {
    const result = (await pageTools.save_page!(
      context({}, { currentVersion: 3 }),
      call({ pageId: "page-1", data: { "bad id": 1 } }),
    )) as Record<string, unknown>;
    expect(result).toMatchObject({ unchanged: true });
  });
});
