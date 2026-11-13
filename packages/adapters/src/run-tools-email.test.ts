import { toolResultTaintsRun } from "@rakazo/core";
import { describe, expect, it } from "vitest";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";
import { emailTools, OUTLOOK_DRAFT_TOOL } from "./run-tools-email.js";

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
  it("is offered only when the owner may send Outlook email in their own live chat", () => {
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
  function context(options: { offered: boolean; outlook: boolean; owner?: string }) {
    const published: unknown[] = [];
    const ctx = {
      deps: {
        prisma: {
          user: { findUnique: async () => null },
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
      publish: published,
    } as never;
    const call = {
      args: { to: ["a@example.com"], subject: "Hi", body: "Hello" },
      finish: (result: unknown) => result,
    } as never;
    return { ctx, call, published };
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

  it("refuses while the person's Send Outlook email switch is off", async () => {
    const { ctx, call } = context({ offered: true, outlook: true });
    await expect(emailTools.outlook_draft_email!(ctx, call)).resolves.toEqual({
      error: "Drafting Outlook email is not available here.",
    });
  });
});
