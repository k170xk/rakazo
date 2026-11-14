import type { StoredFilingItem } from "@rakazo/adapters";
import { setCompanyPolicy } from "@rakazo/adapters";
import { DEFAULT_COMPANY_FEATURES, DEFAULT_COMPANY_TOOLS } from "@rakazo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RouterContext } from "./context.js";
import { emailFilingRoutes } from "./email-filing.js";

/** Procedures become their plain handlers, so a route can be called without the oRPC stack. */
function handlers(): unknown {
  return new Proxy(
    {},
    {
      get: (_target, key) =>
        key === "handler" ? (fn: unknown) => fn : (handlers() as Record<string, unknown>),
    },
  );
}

type Handler = (call: { context: { actor: unknown }; input: unknown }) => Promise<unknown>;
type Routes = Record<string, Handler> & { settings: Record<string, Handler> };

const actor = { spaceId: "space-1", userId: "staff" };

function item(id: string, overrides: Partial<StoredFilingItem>): StoredFilingItem {
  return {
    id,
    messageId: `m-${id}`,
    conversationId: null,
    sourceFolderId: "inbox-id",
    source: "inbox",
    subject: `Subject ${id}`,
    from: "Ann <ann@client.com>",
    fromAddress: "ann@client.com",
    receivedAt: null,
    hasAttachments: false,
    preview: "",
    webLink: null,
    target: null,
    confidence: 95,
    reason: "",
    evidence: [],
    chosen: false,
    remember: "none",
    status: "proposed",
    error: null,
    filedFolderId: null,
    filedPath: null,
    movedMessageId: null,
    filedAt: null,
    ...overrides,
  };
}

function setup(unread: readonly string[] = []) {
  const batch = {
    id: "b1",
    spaceId: actor.spaceId,
    userId: actor.userId,
    threadId: "t1",
    version: 1,
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    content: {
      threshold: 90,
      allowFolderCreation: true,
      items: [
        item("i1", {
          target: { kind: "folder", folderId: "p1", path: "Inbox › Projects › 1234 - Riverside" },
        }),
        item("i2", {
          target: {
            kind: "project",
            jobNumber: "5678",
            jobKey: "5678",
            title: "Harbour Bridge",
            folderName: "5678 - Harbour Bridge",
            parentPath: "Inbox › Projects",
          },
        }),
        item("i3", { target: { kind: "folder", folderId: "p1", path: "x" } }),
        item("i4", { target: { kind: "folder", folderId: "sent-id", path: "Sent Items" } }),
        item("i5", { target: { kind: "folder", folderId: "p1", path: "x" } }),
      ],
    } as unknown,
  };
  const remembered: Array<{ jobKey: string; folderId: string }> = [];
  const prisma = {
    user: { findUnique: async () => ({ email: "staff@ocsc.co.uk", emailVerified: true }) },
    emailFilingBatch: {
      findFirst: async () => ({ ...batch }),
      updateMany: async ({
        where,
        data,
      }: {
        where: { version: number };
        data: { content: unknown };
      }) => {
        if (where.version !== batch.version) return { count: 0 };
        batch.content = data.content;
        batch.version++;
        return { count: 1 };
      },
    },
    emailFilingProfile: { findFirst: async () => null },
    emailFilingFolder: {
      findFirst: async () => null,
      upsert: async ({ create }: { create: { jobKey: string; folderId: string } }) => {
        remembered.push({ jobKey: create.jobKey, folderId: create.folderId });
        return create;
      },
    },
  };

  const children: Record<
    string,
    Array<{ id: string; displayName: string; childFolderCount?: number }>
  > = {
    "inbox-id": [{ id: "proj", displayName: "Projects", childFolderCount: 1 }],
    proj: [{ id: "p1", displayName: "1234 - Riverside" }],
  };
  const location: Record<string, string> = {
    "m-i1": "inbox-id",
    "m-i2": "inbox-id",
    "m-i3": "somewhere-else",
    "m-i4": "inbox-id",
    "m-i5": "inbox-id",
  };
  const moves: Array<[string, string]> = [];
  const reader = {
    json: async (path: string) => {
      if (path.startsWith("/me/mailFolders?")) {
        return {
          value: [
            { id: "inbox-id", displayName: "Inbox", childFolderCount: 1 },
            { id: "sent-id", displayName: "Sent Items" },
            { id: "del-id", displayName: "Deleted Items" },
          ],
        };
      }
      const child = /^\/me\/mailFolders\/([^/]+)\/childFolders/.exec(path);
      if (child) return { value: children[decodeURIComponent(child[1] ?? "")] ?? [] };
      const known = /^\/me\/mailFolders\/(\w+)\?\$select=id$/.exec(path);
      const ids: Record<string, string> = {
        inbox: "inbox-id",
        sentitems: "sent-id",
        deleteditems: "del-id",
      };
      if (known && ids[known[1] ?? ""]) return { id: ids[known[1] ?? ""] };
      throw new Error(`unexpected read ${path}`);
    },
  };
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace("https://graph.microsoft.com/v1.0", "");
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    const message = /^\/me\/messages\/([^/?]+)(\/move)?/.exec(path);
    if (message) {
      const id = decodeURIComponent(message[1] ?? "");
      if (!location[id]) return json({ error: { message: "gone" } }, 404);
      if (message[2]) {
        const destination = (JSON.parse(String(init.body)) as { destinationId: string })
          .destinationId;
        moves.push([id, destination]);
        return json({
          id: `${id}-moved`,
          parentFolderId: destination,
          webLink: "https://outlook/x",
        });
      }
      return json({ id, parentFolderId: location[id], isRead: !unread.includes(id) });
    }
    const child = /^\/me\/mailFolders\/([^/]+)\/childFolders/.exec(path);
    if (child) {
      const parent = decodeURIComponent(child[1] ?? "");
      if (init.method === "POST") {
        const { displayName } = JSON.parse(String(init.body)) as { displayName: string };
        const created = { id: `new-${displayName}`, displayName };
        children[parent] = [...(children[parent] ?? []), created];
        return json(created, 201);
      }
      return json({ value: children[parent] ?? [] });
    }
    throw new Error(`unexpected Graph call ${init.method} ${path}`);
  });
  vi.stubGlobal("fetch", fetch);

  const ctx = {
    deps: {
      env: { adminEmails: [] },
      prisma,
      microsoft: {
        outlookAccount: async () => "staff@ocsc.co.uk",
        outlookReader: async () => reader,
        outlookFilingToken: async () => ({ token: "t" }),
      },
    },
    authed: handlers(),
  } as unknown as RouterContext;
  return {
    routes: emailFilingRoutes(ctx).emailFiling as unknown as Routes,
    batch,
    moves,
    remembered,
    children,
  };
}

afterEach(() => {
  setCompanyPolicy({ features: null, tools: null });
  vi.unstubAllGlobals();
});

describe("Outlook filing routes refuse without the filing switch", () => {
  const calls: Array<[string, (r: Routes) => Promise<unknown>]> = [
    ["file", (r) => r.file!({ context: { actor }, input: { id: "b1", itemIds: ["i1"] } })],
    ["undo", (r) => r.undo!({ context: { actor }, input: { id: "b1", itemIds: ["i1"] } })],
    ["skip", (r) => r.skip!({ context: { actor }, input: { id: "b1", itemIds: ["i1"] } })],
    ["folders", (r) => r.folders!({ context: { actor }, input: {} })],
    [
      "retarget",
      (r) =>
        r.retarget!({
          context: { actor },
          input: {
            id: "b1",
            itemId: "i1",
            target: { kind: "folder", folderId: "p1" },
            remember: "none",
          },
        }),
    ],
    ["settings.set", (r) => r.settings.set!({ context: { actor }, input: { enabled: false } })],
  ];

  it.each(calls)("%s refuses while the switch is off", async (_name, call) => {
    const { routes, moves } = setup();
    await expect(call(routes)).rejects.toThrow("Outlook email filing is not turned on for you.");
    expect(moves).toEqual([]);
  });

  it.each(calls)("%s refuses a person outside the audience", async (_name, call) => {
    setCompanyPolicy({
      features: { ...DEFAULT_COMPANY_FEATURES, outlookFiling: true },
      tools: {
        ...DEFAULT_COMPANY_TOOLS,
        featureAudiences: { outlookFiling: { userIds: ["someone-else"], groupIds: [] } },
      },
    });
    const { routes } = setup();
    await expect(call(routes)).rejects.toThrow(
      "Your administrator has not turned this on for you.",
    );
  });

  it("shows why File is unavailable on the card", async () => {
    const { routes } = setup();
    const card = (await routes.get!({ context: { actor }, input: { id: "b1" } })) as {
      cannotFile: string | null;
    };
    expect(card.cannotFile).toBe("Outlook email filing is not turned on for you.");
  });
});

describe("filing on the person's press of File", () => {
  it("moves only chosen emails still where the card found them, creating one project folder", async () => {
    setCompanyPolicy({ features: { ...DEFAULT_COMPANY_FEATURES, outlookFiling: true } });
    const { routes, moves, remembered, children } = setup();
    const card = (await routes.file!({
      context: { actor },
      input: { id: "b1", itemIds: ["i1", "i2", "i3", "i4"] },
    })) as {
      items: Array<{ id: string; status: string; filedPath: string | null; canUndo: boolean }>;
    };

    expect(moves).toEqual([
      ["m-i1", "p1"],
      ["m-i2", "new-5678 - Harbour Bridge"],
    ]);
    expect(children.proj?.map((folder) => folder.displayName)).toEqual([
      "1234 - Riverside",
      "5678 - Harbour Bridge",
    ]);
    expect(remembered).toEqual([{ jobKey: "5678", folderId: "new-5678 - Harbour Bridge" }]);
    expect(card.items.map((entry) => [entry.id, entry.status])).toEqual([
      ["i1", "filed"],
      ["i2", "filed"],
      ["i3", "gone"],
      ["i4", "failed"],
      ["i5", "proposed"],
    ]);
    expect(card.items[1]?.filedPath).toBe("Inbox › Projects › 5678 - Harbour Bridge");
    expect(card.items[0]?.canUndo).toBe(true);
  });

  it("refuses a second press for emails already being filed", async () => {
    setCompanyPolicy({ features: { ...DEFAULT_COMPANY_FEATURES, outlookFiling: true } });
    const { routes } = setup();
    await routes.file!({ context: { actor }, input: { id: "b1", itemIds: ["i1"] } });
    await expect(
      routes.file!({ context: { actor }, input: { id: "b1", itemIds: ["i1"] } }),
    ).rejects.toThrow("None of these emails can be filed now.");
  });

  it("puts a filed email back where it came from on Undo", async () => {
    setCompanyPolicy({ features: { ...DEFAULT_COMPANY_FEATURES, outlookFiling: true } });
    const { routes, moves } = setup();
    await routes.file!({ context: { actor }, input: { id: "b1", itemIds: ["i1"] } });
    type GraphFetch = (url: string, init: RequestInit) => Promise<Response>;
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn<GraphFetch>>;
    const original = fetchMock.getMockImplementation() as GraphFetch;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith("/me/messages/m-i1-moved?$select=id,parentFolderId,webLink,isRead")) {
        return new Response(JSON.stringify({ id: "m-i1-moved", parentFolderId: "p1" }));
      }
      if (url.includes("/me/messages/m-i1-moved/move")) {
        moves.push(["m-i1-moved", "inbox-id"]);
        return new Response(JSON.stringify({ id: "m-i1-back", parentFolderId: "inbox-id" }));
      }
      return original(url, init);
    });
    const card = (await routes.undo!({
      context: { actor },
      input: { id: "b1", itemIds: ["i1"] },
    })) as { items: Array<{ id: string; status: string }> };
    expect(moves.at(-1)).toEqual(["m-i1-moved", "inbox-id"]);
    expect(card.items[0]?.status).toBe("proposed");
  });

  it("leaves an unread email where it is", async () => {
    setCompanyPolicy({ features: { ...DEFAULT_COMPANY_FEATURES, outlookFiling: true } });
    const { routes, moves } = setup(["m-i1"]);
    const card = (await routes.file!({
      context: { actor },
      input: { id: "b1", itemIds: ["i1"] },
    })) as { items: Array<{ id: string; status: string; error: string | null }> };
    expect(moves).toEqual([]);
    expect(card.items[0]).toMatchObject({
      id: "i1",
      status: "proposed",
      error: "This email is still unread, so it was left where it is.",
    });
  });
});
