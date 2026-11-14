import { DEFAULT_COMPANY_FEATURES } from "@rakazo/contracts";
import { toolResultTaintsRun } from "@rakazo/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setCompanyPolicy } from "./company-policy.js";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";

const publishMessage = vi.fn();
vi.mock("./run-messages.js", async (importActual) => ({
  ...(await importActual<typeof import("./run-messages.js")>()),
  publishMessage: (...args: unknown[]) => publishMessage(...args),
}));

const { emailTools, OUTLOOK_DRAFT_TOOL } = await import("./run-tools-email.js");

function offered(
  outlookDrafts: boolean,
  overrides: { trigger?: string; groupId?: string | null; messagingChannelRun?: boolean } = {},
) {
  return selectBuiltinToolsForRun({
    graphicalToolsAllowed: false,
    groupId: overrides.groupId ?? null,
    trigger: overrides.trigger ?? "user",
    semanticMemoryEnabled: false,
    messagingChannelRun: overrides.messagingChannelRun ?? false,
    outlookDrafts,
  }).map((tool) => tool.name);
}

describe("outlook_draft_email selection", () => {
  it("is offered only when the owner may draft Outlook email in their own live chat", () => {
    expect(offered(true)).toContain(OUTLOOK_DRAFT_TOOL);
    expect(offered(false)).not.toContain(OUTLOOK_DRAFT_TOOL);
    expect(offered(true, { groupId: "g1" })).not.toContain(OUTLOOK_DRAFT_TOOL);
    expect(offered(true, { messagingChannelRun: true })).not.toContain(OUTLOOK_DRAFT_TOOL);
    expect(offered(true, { trigger: "routine" })).not.toContain(OUTLOOK_DRAFT_TOOL);
  });

  it("does not taint the run, since it only writes the person's own draft", () => {
    expect(toolResultTaintsRun(OUTLOOK_DRAFT_TOOL)).toBe(false);
  });
});

describe("outlook_draft_email handler", () => {
  afterEach(() => {
    publishMessage.mockReset();
    setCompanyPolicy({ features: null });
  });

  function context(options: { offered: boolean; outlook: boolean; owner?: string }) {
    const ctx = {
      deps: {
        prisma: {
          user: { findUnique: async () => null },
          deploymentSettings: { findUnique: async () => null },
          emailDraft: {
            create: async () => {
              throw new Error("must not create a draft");
            },
          },
        },
      },
      run: { id: "r1", spaceId: "s1", userId: "u1", trigger: "user" },
      bot: { id: "b1", userId: options.owner ?? "u1" },
      thread: { id: "t1", userId: "u1", botId: "b1", groupId: null, externalConversationId: null },
      tools: { offered: options.offered ? [{ name: OUTLOOK_DRAFT_TOOL }] : [] },
      context: {
        connectedConnections: options.outlook
          ? [{ connectorId: "microsoft", externalId: "outlook" }]
          : [],
      },
    } as never;
    const call = {
      args: { to: ["a@example.com"], subject: "Hi", body: "Hello" },
      finish: (result: unknown) => result,
    } as never;
    return { ctx, call };
  }

  it("refuses when the tool was not offered to this run", async () => {
    const { ctx, call } = context({ offered: false, outlook: true });
    await expect(emailTools.outlook_draft_email!(ctx, call)).resolves.toEqual({
      error: "Drafting Outlook email is not available here.",
    });
  });

  it("refuses without a connected Outlook or outside the owner's private chat", async () => {
    for (const options of [
      { offered: true, outlook: false },
      { offered: true, outlook: true, owner: "someone-else" },
    ]) {
      const { ctx, call } = context(options);
      await expect(emailTools.outlook_draft_email!(ctx, call)).resolves.toEqual({
        error: "Drafting Outlook email is not available here.",
      });
    }
  });

  it("refuses while the person's Outlook email drafts switch is off", async () => {
    const { ctx, call } = context({ offered: true, outlook: true });
    await expect(emailTools.outlook_draft_email!(ctx, call)).resolves.toEqual({
      error: "Drafting Outlook email is not available here.",
    });
  });

  it("creates a draft card even without recipients and revises an open draft when draft_id is given", async () => {
    setCompanyPolicy({
      features: { ...DEFAULT_COMPANY_FEATURES, outlookSend: true },
    });
    const rows = new Map<
      string,
      {
        id: string;
        spaceId: string;
        userId: string;
        threadId: string;
        mode: string;
        replyToMessageId: string | null;
        content: Record<string, unknown>;
        status: string;
        version: number;
      }
    >();
    const ctx = {
      deps: {
        prisma: {
          user: { findUnique: async () => ({ email: "keith@ocsc.ie" }) },
          deploymentSettings: {
            findUnique: async () => ({
              companyFeatures: { ...DEFAULT_COMPANY_FEATURES, outlookSend: true },
              companyTools: {},
            }),
          },
          emailDraft: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
              const created = {
                id: "d1",
                spaceId: String(data.spaceId),
                userId: String(data.userId),
                threadId: String(data.threadId),
                mode: String(data.mode),
                replyToMessageId: (data.replyToMessageId as string | null) ?? null,
                content: data.content as Record<string, unknown>,
                status: "draft",
                version: 1,
              };
              rows.set("d1", created);
              return { id: "d1", version: 1 };
            },
            findFirst: async ({ where }: { where: { id: string; status: string } }) => {
              const row = rows.get(where.id);
              return row && row.status === where.status ? row : null;
            },
            updateMany: async ({
              where,
              data,
            }: {
              where: { id: string; version: number };
              data: { content: Record<string, unknown>; version: number };
            }) => {
              const row = rows.get(where.id);
              if (!row || row.version !== where.version) return { count: 0 };
              row.content = data.content;
              row.version = data.version;
              return { count: 1 };
            },
          },
        },
      },
      run: { id: "r1", spaceId: "s1", userId: "u1", trigger: "user", threadId: "t1", botId: "b1" },
      bot: { id: "b1", userId: "u1" },
      thread: { id: "t1", userId: "u1", botId: "b1", groupId: null, externalConversationId: null },
      tools: { offered: [{ name: OUTLOOK_DRAFT_TOOL }] },
      context: {
        connectedConnections: [{ connectorId: "microsoft", externalId: "outlook" }],
      },
    } as never;

    const first = await emailTools.outlook_draft_email!(ctx, {
      args: { subject: "Update", body: "First paragraph\n\nKind regards," },
      finish: (res: unknown) => res,
    } as never);
    expect(first).toMatchObject({ ok: true, draft_id: "d1", version: 1 });
    expect(rows.get("d1")?.content).toMatchObject({
      to: [],
      subject: "Update",
      bodyHtml: "<p>First paragraph</p><p>Kind regards,</p>",
    });

    const second = await emailTools.outlook_draft_email!(ctx, {
      args: {
        draft_id: "d1",
        to: ["Anne Byrne <anne@ocsc.ie>"],
        body: "Revised paragraph\n\nKind regards,",
      },
      finish: (res: unknown) => res,
    } as never);
    expect(second).toMatchObject({ ok: true, draft_id: "d1", version: 2 });
    expect(rows.get("d1")?.content).toMatchObject({
      to: ["anne@ocsc.ie"],
      subject: "Update",
      bodyHtml: "<p>Revised paragraph</p><p>Kind regards,</p>",
    });
    expect(publishMessage.mock.calls.at(-1)?.[3]).toEqual([
      { kind: "email_draft", draftId: "d1", version: 2 },
    ]);
  });
});
