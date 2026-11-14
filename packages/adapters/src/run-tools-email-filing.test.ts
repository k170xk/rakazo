import { DEFAULT_COMPANY_FEATURES } from "@rakazo/contracts";
import { toolResultTaintsRun } from "@rakazo/core";
import { afterEach, describe, expect, it } from "vitest";
import { setCompanyPolicy } from "./company-policy.js";
import {
  emailFilingTools,
  FILING_CANDIDATES_TOOL,
  PROPOSE_FILING_TOOL,
  REMEMBER_FILING_TOOL,
} from "./run-tools-email-filing.js";

function context(options: {
  offered: boolean;
  outlook: boolean;
  owner?: string;
  enabled?: boolean;
  reader?: boolean;
}) {
  const ctx = {
    deps: {
      prisma: {
        user: { findUnique: async () => null },
        deploymentSettings: { findUnique: async () => null },
        emailFilingProfile: {
          findFirst: async () =>
            options.enabled === false
              ? { id: "p1", version: 1, content: { settings: { enabled: false } } }
              : null,
        },
        emailFilingBatch: {
          create: async () => {
            throw new Error("must not create a batch");
          },
        },
      },
      connectors: {
        managed: () => ({
          outlookReader: async () => {
            if (options.reader === false) return null;
            throw new Error("must not read mail");
          },
        }),
      },
    },
    run: { id: "r1", spaceId: "s1", userId: "u1", trigger: "routine" },
    bot: { id: "b1", userId: options.owner ?? "u1" },
    thread: { id: "t1", userId: "u1", botId: "b1", groupId: null, externalConversationId: null },
    tools: {
      offered: options.offered
        ? [{ name: FILING_CANDIDATES_TOOL }, { name: PROPOSE_FILING_TOOL }]
        : [],
    },
    state: {},
    context: {
      connectedConnections: options.outlook
        ? [{ connectorId: "microsoft", externalId: "outlook" }]
        : [],
    },
  } as never;
  const call = (name: string) =>
    ({
      name,
      args: { items: [{ message_id: "m1", confidence: 99, reason: "x" }] },
      finish: (result: unknown) => result,
    }) as never;
  return { ctx, call };
}

const unavailable = { error: "Filing Outlook email is not available here." };

describe("Outlook filing tools", () => {
  afterEach(() => setCompanyPolicy({ features: null }));
  const allow = () =>
    setCompanyPolicy({ features: { ...DEFAULT_COMPANY_FEATURES, outlookFiling: true } });

  it("do not taint the run for the card or the memory they write", () => {
    expect(toolResultTaintsRun(PROPOSE_FILING_TOOL)).toBe(false);
    expect(toolResultTaintsRun(REMEMBER_FILING_TOOL)).toBe(false);
  });

  it.each([FILING_CANDIDATES_TOOL, PROPOSE_FILING_TOOL, REMEMBER_FILING_TOOL])(
    "%s refuses unless offered, connected, in the owner's chat and switched on",
    async (name) => {
      const handler = emailFilingTools[name]!;
      for (const options of [
        { offered: false, outlook: true },
        { offered: true, outlook: false },
        { offered: true, outlook: true, owner: "someone-else" },
        { offered: true, outlook: true },
      ]) {
        const { ctx, call } = context(options);
        await expect(handler(ctx, call(name))).resolves.toEqual(unavailable);
      }
    },
  );

  it("respects the person's own off switch and a missing Outlook token", async () => {
    allow();
    const off = context({ offered: true, outlook: true, enabled: false });
    await expect(
      emailFilingTools[FILING_CANDIDATES_TOOL]!(off.ctx, off.call(FILING_CANDIDATES_TOOL)),
    ).resolves.toEqual({ error: "The person turned email filing off in Settings → Email." });
    const noReader = context({ offered: true, outlook: true, reader: false });
    await expect(
      emailFilingTools[PROPOSE_FILING_TOOL]!(noReader.ctx, noReader.call(PROPOSE_FILING_TOOL)),
    ).resolves.toEqual({ error: "Outlook is not connected. Ask the person to reconnect it." });
  });

  it("offers read mail only and refuses an unread message", async () => {
    allow();
    const calls: string[] = [];
    const graph = {
      json: async (path: string) => {
        calls.push(path);
        if (path.startsWith("/me/mailFolders?")) return { value: [] };
        if (path.includes("/me/mailFolders/") && path.includes("?$select=id")) {
          const name = path.split("/")[3]?.split("?")[0];
          return { id: name === "inbox" ? "inbox-id" : `${name}-id` };
        }
        if (path.includes("/mailFolders/inbox/messages")) {
          return {
            value: [
              {
                id: "read-1",
                subject: "Already read",
                isRead: true,
                parentFolderId: "inbox-id",
                from: { emailAddress: { address: "ada@example.com", name: "Ada" } },
              },
              {
                id: "unread-1",
                subject: "Still new",
                isRead: false,
                parentFolderId: "inbox-id",
                from: { emailAddress: { address: "bea@example.com" } },
              },
            ],
          };
        }
        if (path.startsWith("/me/messages/")) {
          const id = decodeURIComponent(path.split("/")[3]?.split("?")[0] ?? "");
          return {
            id,
            subject: id,
            isRead: id !== "unread-1",
            parentFolderId: "inbox-id",
            from: { emailAddress: { address: "ada@example.com" } },
          };
        }
        return { value: [] };
      },
    };
    const ctx = {
      deps: {
        prisma: {
          user: { findUnique: async () => null },
          deploymentSettings: { findUnique: async () => null },
          emailFilingProfile: { findFirst: async () => null },
          emailFilingBatch: {
            findMany: async () => [],
            create: async () => {
              throw new Error("must not file unread mail");
            },
          },
        },
        connectors: { managed: () => ({ outlookReader: async () => graph }) },
      },
      run: { id: "r1", spaceId: "s1", userId: "u1", trigger: "routine" },
      bot: { id: "b1", userId: "u1" },
      thread: { id: "t1", userId: "u1", botId: "b1", groupId: null, externalConversationId: null },
      tools: { offered: [{ name: FILING_CANDIDATES_TOOL }, { name: PROPOSE_FILING_TOOL }] },
      state: {},
      context: { connectedConnections: [{ connectorId: "microsoft", externalId: "outlook" }] },
    } as never;

    const listed = await emailFilingTools[FILING_CANDIDATES_TOOL]!(ctx, {
      name: FILING_CANDIDATES_TOOL,
      args: {},
      finish: (result: unknown) => result,
    } as never);
    expect(calls.some((path) => path.includes("isRead%20eq%20true"))).toBe(true);
    expect(listed).toMatchObject({
      candidates: [{ message_id: "read-1", subject: "Already read" }],
    });

    const proposed = await emailFilingTools[PROPOSE_FILING_TOOL]!(ctx, {
      name: PROPOSE_FILING_TOOL,
      args: { items: [{ message_id: "unread-1", confidence: 90, reason: "Looks like HR" }] },
      finish: (result: unknown) => result,
    } as never);
    expect(proposed).toMatchObject({
      error: "None of these emails can be filed.",
      dropped: [{ message_id: "unread-1", why: "still unread" }],
    });
  });

  it("remembers an instruction for the next filing", async () => {
    allow();
    let content: { memories?: unknown[]; rules?: unknown[] } | null = null;
    const ctx = {
      deps: {
        prisma: {
          user: { findUnique: async () => null },
          deploymentSettings: { findUnique: async () => null },
          emailFilingProfile: {
            findFirst: async () => (content ? { id: "p1", version: 1, content } : null),
            create: async ({ data }: { data: { content: typeof content } }) => {
              content = data.content;
              return { id: "p1" };
            },
            updateMany: async ({ data }: { data: { content: typeof content } }) => {
              content = data.content;
              return { count: 1 };
            },
          },
          emailFilingBatch: { findMany: async () => [] },
        },
        connectors: {
          managed: () => ({ outlookReader: async () => ({ json: async () => ({}) }) }),
        },
      },
      run: { id: "r1", spaceId: "s1", userId: "u1", trigger: "routine" },
      bot: { id: "b1", userId: "u1" },
      thread: { id: "t1", userId: "u1", botId: "b1", groupId: null, externalConversationId: null },
      tools: { offered: [{ name: REMEMBER_FILING_TOOL }] },
      state: {},
      context: { connectedConnections: [{ connectorId: "microsoft", externalId: "outlook" }] },
    } as never;
    const saved = await emailFilingTools[REMEMBER_FILING_TOOL]!(ctx, {
      name: REMEMBER_FILING_TOOL,
      args: { text: "Graduate applications from careers@ go in Inbox › HR" },
      finish: (result: unknown) => result,
    } as never);
    expect(saved).toMatchObject({
      ok: true,
      memories: [{ instruction: "Graduate applications from careers@ go in Inbox › HR" }],
    });
    expect(content?.memories).toHaveLength(1);
  });
});
