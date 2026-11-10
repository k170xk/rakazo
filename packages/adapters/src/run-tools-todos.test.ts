import { toolRequiresApproval, toolResultTaintsRun } from "@rakazo/core";
import { describe, expect, it } from "vitest";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";
import { PRIVATE_TODOS, TODO_TOOL_NAMES, todoTools } from "./run-tools-todos.js";

function offered(personalTodos: boolean, messagingChannelRun = false) {
  return selectBuiltinToolsForRun({
    graphicalToolsAllowed: false,
    groupId: null,
    trigger: "user",
    semanticMemoryEnabled: false,
    messagingChannelRun,
    personalTodos,
  }).map((tool) => tool.name);
}

function context(overrides: { trigger?: string; groupId?: string | null; owner?: string } = {}) {
  const created: unknown[] = [];
  const prisma = {
    todoItem: {
      findFirst: async () => null,
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        const now = new Date();
        return { id: "t1", archivedAt: null, createdAt: now, updatedAt: now, ...data };
      },
    },
  };
  const ctx = {
    deps: { prisma },
    run: { spaceId: "s1", userId: "u1", trigger: overrides.trigger ?? "routine" },
    bot: { id: "b1", userId: overrides.owner ?? "u1" },
    thread: {
      userId: "u1",
      botId: "b1",
      groupId: overrides.groupId ?? null,
      externalConversationId: null,
    },
  } as never;
  const call = (args: Record<string, unknown>) =>
    ({ args, finish: async (result: unknown) => result }) as never;
  return { ctx, call, created };
}

describe("to-do tools", () => {
  it("are offered only in the person's own private chat and routines", () => {
    for (const name of TODO_TOOL_NAMES) {
      expect(offered(true)).toContain(name);
      expect(offered(false)).not.toContain(name);
    }
  });

  it("refuse to run outside the owner's private chat even if called", async () => {
    for (const overrides of [
      { groupId: "g1" },
      { owner: "someone-else" },
      { trigger: "webhook" },
    ]) {
      const { ctx, call } = context(overrides);
      for (const name of TODO_TOOL_NAMES) {
        expect(await todoTools[name]!(ctx, call({ title: "x", item_id: "t1" }))).toEqual({
          error: PRIVATE_TODOS,
        });
      }
    }
  });

  it("adds items as the assistant from a routine without asking for approval", async () => {
    const { ctx, call, created } = context();
    const result = await todoTools.todo_add!(
      ctx,
      call({
        title: "Reply to Anne about drawings",
        status: "waiting",
        source_kind: "email",
        source_label: "Email from Anne",
        source_link: "https://outlook.office.com/mail/x",
      }),
    );
    expect(result).toEqual({ ok: true, item_id: "t1", status: "waiting" });
    expect(created[0]).toMatchObject({ origin: "ai", botId: "b1", userId: "u1", spaceId: "s1" });
    for (const name of TODO_TOOL_NAMES) expect(toolRequiresApproval(name, false)).toBe(false);
  });

  it("treats listed items as untrusted, but not the write confirmations", () => {
    expect(toolResultTaintsRun("todo_list")).toBe(true);
    for (const name of ["todo_add", "todo_update", "todo_archive"]) {
      expect(toolResultTaintsRun(name)).toBe(false);
    }
  });

  it("reports bad values instead of failing the run", async () => {
    const { ctx, call } = context();
    expect(await todoTools.todo_update!(ctx, call({ item_id: "missing" }))).toEqual({
      error: "That to-do item was not found.",
    });
    expect(await todoTools.todo_add!(ctx, call({ title: "x", status: "later" }))).toMatchObject({
      error: expect.stringContaining("status"),
    });
  });
});
