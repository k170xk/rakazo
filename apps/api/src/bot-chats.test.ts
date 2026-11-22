import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { IsolationError } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import {
  createBotChat,
  deleteBotChat,
  deriveChatTitleFromText,
  listBotChats,
  renameBotChat,
} from "./bot-chats.js";

const actor: Actor = {
  userId: "user-1",
  spaceId: "space-1",
  email: "keith@ocsc.ie",
  isDeploymentOwner: true,
};

function makeBotRecord(overrides?: Partial<{ threadId: string; title: string | null }>) {
  const created = new Date("2026-10-01T09:00:00.000Z");
  return {
    id: "bot-1",
    spaceId: actor.spaceId,
    userId: actor.userId,
    updatedAt: created,
    thread: {
      id: overrides?.threadId ?? "thread-primary",
      botId: "bot-1",
      chatBotId: null,
      title: overrides?.title ?? null,
      unread: false,
      nextMessageSeq: 4,
      createdAt: created,
      updatedAt: new Date("2026-10-05T10:00:00.000Z"),
    },
  };
}

describe("deriveChatTitleFromText", () => {
  it("extracts a clean first line without markdown markers", () => {
    expect(deriveChatTitleFromText("  # Review Q4 Structural Report\nDetails below")).toBe(
      "Review Q4 Structural Report",
    );
    expect(deriveChatTitleFromText("\n\n> Check compliance with Eurocode 2")).toBe(
      "Check compliance with Eurocode 2",
    );
  });

  it("truncates long messages on a word boundary with an ellipsis", () => {
    const long =
      "Please review the attached tender submission for structural compliance and highlight every missing appendix";
    const title = deriveChatTitleFromText(long);
    expect(title).not.toBeNull();
    expect(title!.length).toBeLessThanOrEqual(61);
    expect(title!.endsWith("…")).toBe(true);
    expect(title).toBe("Please review the attached tender submission for structural…");
  });

  it("returns null for empty or whitespace-only text", () => {
    expect(deriveChatTitleFromText(undefined)).toBeNull();
    expect(deriveChatTitleFromText("   \n  ")).toBeNull();
  });
});

describe("bot-chats CRUD and safety", () => {
  it("creates a blank extra chat linked via chatBotId without touching the primary thread", async () => {
    const createdAt = new Date("2026-11-20T12:00:00.000Z");
    const createThread = vi.fn(async () => ({
      id: "thread-extra-1",
      title: "Bridge Tender",
      unread: false,
      nextMessageSeq: 0,
      createdAt,
      updatedAt: createdAt,
    }));
    const prisma = {
      bot: { findFirst: vi.fn(async () => makeBotRecord()) },
      thread: { create: createThread },
    } as unknown as PrismaClient;

    const chat = await createBotChat(prisma, actor, "bot-1", "  Bridge Tender  ");
    expect(createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          spaceId: actor.spaceId,
          userId: actor.userId,
          chatBotId: "bot-1",
          title: "Bridge Tender",
        }),
      }),
    );
    expect(chat).toEqual({
      id: "thread-extra-1",
      botId: "bot-1",
      title: "Bridge Tender",
      isPrimary: false,
      preview: "",
      unread: false,
      status: "idle",
      runErrorId: null,
      messageCount: 0,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    });
  });

  it("rejects creating a chat on a bot the caller does not own", async () => {
    const prisma = {
      bot: { findFirst: vi.fn(async () => null) },
    } as unknown as PrismaClient;
    await expect(createBotChat(prisma, actor, "bot-other")).rejects.toBeInstanceOf(IsolationError);
  });

  it("lists all conversations newest-active first and derives a fallback title for untitled chats", async () => {
    const olderExtra = {
      id: "thread-extra-old",
      botId: null,
      chatBotId: "bot-1",
      title: "Older Topic",
      unread: false,
      nextMessageSeq: 2,
      createdAt: new Date("2026-10-02T09:00:00.000Z"),
      updatedAt: new Date("2026-10-03T09:00:00.000Z"),
    };
    const newerExtra = {
      id: "thread-extra-new",
      botId: null,
      chatBotId: "bot-1",
      title: "Newer Topic",
      unread: true,
      nextMessageSeq: 1,
      createdAt: new Date("2026-10-06T09:00:00.000Z"),
      updatedAt: new Date("2026-10-07T09:00:00.000Z"),
    };
    const messageFindMany = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "m-new",
          threadId: "thread-extra-new",
          seq: 1,
          role: "bot",
          botId: "bot-1",
          runId: null,
          blocks: [{ kind: "text", text: "Here is the summary." }],
          createdAt: new Date("2026-10-07T10:00:00.000Z"),
        },
        {
          id: "m-primary",
          threadId: "thread-primary",
          seq: 4,
          role: "bot",
          botId: "bot-1",
          runId: null,
          blocks: [{ kind: "text", text: "Primary thread reply." }],
          createdAt: new Date("2026-10-05T10:00:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          threadId: "thread-primary",
          blocks: [{ kind: "text", text: "Check beam design calcs" }],
        },
      ]);
    const prisma = {
      bot: { findFirst: vi.fn(async () => makeBotRecord()) },
      thread: { findMany: vi.fn(async () => [olderExtra, newerExtra]) },
      message: {
        findMany: messageFindMany,
      },
      run: {
        findMany: vi.fn(async () => []),
      },
    } as unknown as PrismaClient;

    const chats = await listBotChats(prisma, actor, "bot-1");
    expect(chats.map((c) => c.id)).toEqual([
      "thread-extra-new",
      "thread-primary",
      "thread-extra-old",
    ]);
    expect(chats[0]?.unread).toBe(true);
    expect(chats[0]?.preview).toBe("Here is the summary.");
    expect(chats[1]?.title).toBe("Check beam design calcs");
    expect(chats[1]?.preview).toBe("Primary thread reply.");
  });

  it("renames a thread belonging to the bot and resets blank title to null", async () => {
    const updatedRow = {
      id: "thread-extra-1",
      botId: null,
      chatBotId: "bot-1",
      title: null,
      unread: false,
      nextMessageSeq: 1,
      createdAt: new Date("2026-10-02T09:00:00.000Z"),
      updatedAt: new Date("2026-10-03T09:00:00.000Z"),
    };
    const update = vi.fn(async () => updatedRow);
    const prisma = {
      bot: { findFirst: vi.fn(async () => makeBotRecord()) },
      thread: {
        findFirst: vi.fn(async () => ({ id: "thread-extra-1" })),
        update,
      },
      message: { findMany: vi.fn(async () => []) },
      run: { findMany: vi.fn(async () => []) },
    } as unknown as PrismaClient;

    const result = await renameBotChat(prisma, actor, "bot-1", "thread-extra-1", "   ");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "thread-extra-1" },
        data: { title: null },
      }),
    );
    expect(result.title).toBe("");
  });

  it("deletes the default conversation by promoting the newest remaining chat without losing bot state", async () => {
    const threadDelete = vi.fn(async () => undefined);
    const threadUpdate = vi.fn(async () => ({ id: "thread-extra-2" }));
    const threadFindFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: "thread-primary", botId: "bot-1" })
      .mockResolvedValueOnce({ id: "thread-extra-2" });
    const tx = {
      thread: {
        findFirst: threadFindFirst,
        delete: threadDelete,
        update: threadUpdate,
        create: vi.fn(),
      },
      run: { findMany: vi.fn(async () => []), updateManyAndReturn: vi.fn(async () => []) },
      attempt: { updateMany: vi.fn(async () => ({ count: 0 })) },
      task: { updateMany: vi.fn(async () => ({ count: 0 })) },
      externalEffect: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      message: { findMany: vi.fn(async () => []) },
      secret: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      runSecret: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      steeringMessage: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      computerExecutionLease: { updateMany: vi.fn(async () => ({ count: 0 })) },
      chatFileIndex: { updateMany: vi.fn(async () => ({ count: 0 })) },
      chatFileIndexEntry: { updateMany: vi.fn(async () => ({ count: 0 })) },
      conversationDeletion: { createMany: vi.fn(async () => ({ count: 1 })) },
    };
    const prisma = {
      bot: { findFirst: vi.fn(async () => makeBotRecord()) },
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;
    const jobs = { cancel: vi.fn(async () => undefined) };

    const result = await deleteBotChat({ prisma, jobs } as never, actor, "bot-1", "thread-primary");
    expect(threadDelete).toHaveBeenCalledWith({ where: { id: "thread-primary" } });
    expect(threadUpdate).toHaveBeenCalledWith({
      where: { id: "thread-extra-2" },
      data: { botId: "bot-1", chatBotId: null },
    });
    expect(result).toEqual({ nextThreadId: "thread-extra-2" });
  });

  it("deletes the sole remaining conversation by replacing it with a fresh blank thread", async () => {
    const threadDelete = vi.fn(async () => undefined);
    const threadCreate = vi.fn(async () => ({ id: "thread-fresh" }));
    const threadFindFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: "thread-primary", botId: "bot-1" })
      .mockResolvedValueOnce(null);
    const tx = {
      thread: {
        findFirst: threadFindFirst,
        delete: threadDelete,
        update: vi.fn(),
        create: threadCreate,
      },
      run: { findMany: vi.fn(async () => []), updateManyAndReturn: vi.fn(async () => []) },
      attempt: { updateMany: vi.fn(async () => ({ count: 0 })) },
      task: { updateMany: vi.fn(async () => ({ count: 0 })) },
      externalEffect: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      message: { findMany: vi.fn(async () => []) },
      secret: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      runSecret: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      steeringMessage: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      computerExecutionLease: { updateMany: vi.fn(async () => ({ count: 0 })) },
      chatFileIndex: { updateMany: vi.fn(async () => ({ count: 0 })) },
      chatFileIndexEntry: { updateMany: vi.fn(async () => ({ count: 0 })) },
      conversationDeletion: { createMany: vi.fn(async () => ({ count: 1 })) },
    };
    const prisma = {
      bot: { findFirst: vi.fn(async () => makeBotRecord()) },
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;
    const jobs = { cancel: vi.fn(async () => undefined) };

    const result = await deleteBotChat({ prisma, jobs } as never, actor, "bot-1", "thread-primary");
    expect(threadDelete).toHaveBeenCalledWith({ where: { id: "thread-primary" } });
    expect(threadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          spaceId: actor.spaceId,
          userId: actor.userId,
          botId: "bot-1",
        }),
      }),
    );
    expect(result).toEqual({ nextThreadId: "thread-fresh" });
  });

  it("deletes an extra chat cleanly, cancelling runs, retiring file indexes, and recording deletion", async () => {
    const threadDelete = vi.fn(async () => undefined);
    const chatFileIndexUpdate = vi.fn(async () => ({ count: 1 }));
    const chatFileIndexEntryUpdate = vi.fn(async () => ({ count: 2 }));
    const deletionCreateMany = vi.fn(async () => ({ count: 1 }));
    const runUpdateManyAndReturn = vi.fn(async () => [{ id: "run-9" }]);
    const taskUpdateMany = vi.fn(async () => ({ count: 1 }));
    const leaseUpdateMany = vi.fn(async () => ({ count: 1 }));

    const tx = {
      thread: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ id: "thread-extra-1", botId: null })
          .mockResolvedValueOnce({ id: "thread-primary" }),
        delete: threadDelete,
      },
      run: {
        findMany: vi.fn(async () => [
          { id: "run-9", taskId: "task-9", userId: actor.userId, spaceId: actor.spaceId },
        ]),
        updateManyAndReturn: runUpdateManyAndReturn,
      },
      attempt: { updateMany: vi.fn(async () => ({ count: 1 })) },
      task: { updateMany: taskUpdateMany },
      externalEffect: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      message: { findMany: vi.fn(async () => []) },
      secret: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      runSecret: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      steeringMessage: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      computerExecutionLease: { updateMany: leaseUpdateMany },
      chatFileIndex: { updateMany: chatFileIndexUpdate },
      chatFileIndexEntry: { updateMany: chatFileIndexEntryUpdate },
      conversationDeletion: { createMany: deletionCreateMany },
    };
    const prisma = {
      bot: { findFirst: vi.fn(async () => makeBotRecord()) },
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;
    const cancelJob = vi.fn(async () => undefined);

    await deleteBotChat(
      { prisma, jobs: { cancel: cancelJob } } as never,
      actor,
      "bot-1",
      "thread-extra-1",
    );

    expect(chatFileIndexUpdate).toHaveBeenCalledOnce();
    expect(chatFileIndexEntryUpdate).toHaveBeenCalledOnce();
    expect(deletionCreateMany).toHaveBeenCalledWith({
      data: [{ spaceId: actor.spaceId, userId: actor.userId, threadId: "thread-extra-1" }],
      skipDuplicates: true,
    });
    expect(threadDelete).toHaveBeenCalledWith({ where: { id: "thread-extra-1" } });
    expect(cancelJob).toHaveBeenCalledWith("run:run-9");
  });
});
