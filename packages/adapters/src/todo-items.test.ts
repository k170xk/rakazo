import { describe, expect, it } from "vitest";
import {
  archiveTodoItem,
  cleanSource,
  createTodoItem,
  deleteTodoItem,
  listTodoItems,
  moveTodoItem,
  restoreTodoItem,
  TodoNotFoundError,
  updateTodoItem,
} from "./todo-items.js";

type Row = Record<string, unknown> & { id: string; position: number; createdAt: Date };

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, wanted]) => {
    if (wanted && typeof wanted === "object" && "not" in wanted) {
      return row[key] !== (wanted as { not: unknown }).not;
    }
    return (row[key] ?? null) === wanted;
  });
}

function fakePrisma() {
  const rows: Row[] = [];
  let next = 0;
  const sorted = (where: Record<string, unknown>) =>
    rows.filter((row) => matches(row, where)).sort((a, b) => a.position - b.position);
  const todoItem = {
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      sorted(where).map((row) => ({ ...row })),
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      const row = sorted(where)[0];
      return row ? { ...row } : null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      next += 1;
      const now = new Date(Date.UTC(2026, 10, 10, 9, 0, next));
      const row: Row = {
        id: `t${next}`,
        position: 0,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      rows.push(row);
      return { ...row };
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = rows.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error("missing");
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
    },
    delete: async ({ where }: { where: { id: string } }) => {
      rows.splice(
        rows.findIndex((row) => row.id === where.id),
        1,
      );
    },
  };
  return { prisma: { todoItem } as never, rows };
}

const ME = { spaceId: "s1", userId: "u1" };
const SOMEONE_ELSE = { spaceId: "s1", userId: "u2" };

describe("to-do items", () => {
  it("keeps each person's list private", async () => {
    const { prisma } = fakePrisma();
    const mine = await createTodoItem(prisma, ME, { title: "Send drawings", origin: "user" });
    expect(await listTodoItems(prisma, SOMEONE_ELSE)).toEqual([]);
    await expect(updateTodoItem(prisma, SOMEONE_ELSE, mine.id, { title: "x" })).rejects.toThrow(
      TodoNotFoundError,
    );
    await expect(archiveTodoItem(prisma, SOMEONE_ELSE, mine.id)).rejects.toThrow(TodoNotFoundError);
    await expect(deleteTodoItem(prisma, SOMEONE_ELSE, mine.id)).rejects.toThrow(TodoNotFoundError);
    expect((await listTodoItems(prisma, ME)).map((item) => item.title)).toEqual(["Send drawings"]);
  });

  it("puts new items at the top of their column and records who added them", async () => {
    const { prisma } = fakePrisma();
    await createTodoItem(prisma, ME, { title: "First", origin: "user" });
    const second = await createTodoItem(prisma, ME, {
      title: "  Reply to Anne  ",
      origin: "ai",
      botId: "b1",
      source: { kind: "email", label: "Email from Anne", link: "https://outlook.office.com/x" },
    });
    expect(second).toMatchObject({
      title: "Reply to Anne",
      origin: "ai",
      botId: "b1",
      source: { kind: "email", label: "Email from Anne", link: "https://outlook.office.com/x" },
    });
    expect((await listTodoItems(prisma, ME)).map((item) => item.title)).toEqual([
      "Reply to Anne",
      "First",
    ]);
  });

  it("rejects empty or oversized titles and bad dates", async () => {
    const { prisma } = fakePrisma();
    await expect(createTodoItem(prisma, ME, { title: "  ", origin: "user" })).rejects.toThrow();
    await expect(
      createTodoItem(prisma, ME, { title: "a".repeat(301), origin: "user" }),
    ).rejects.toThrow();
    await expect(
      createTodoItem(prisma, ME, { title: "x", dueAt: "soon", origin: "user" }),
    ).rejects.toThrow();
  });

  it("keeps only https source links", () => {
    expect(cleanSource({ kind: "email", label: "Mail", link: "javascript:alert(1)" })).toEqual({
      kind: "email",
      label: "Mail",
      link: null,
    });
    expect(cleanSource({ kind: "weird", label: "", link: "http://example.com" })).toBeNull();
  });

  it("marks done items complete and hides them when asked", async () => {
    const { prisma } = fakePrisma();
    const item = await createTodoItem(prisma, ME, { title: "Chase invoice", origin: "user" });
    const done = await updateTodoItem(prisma, ME, item.id, { status: "done" });
    expect(done.completedAt).not.toBeNull();
    expect(await listTodoItems(prisma, ME, { includeDone: false })).toEqual([]);
    const reopened = await updateTodoItem(prisma, ME, item.id, { status: "todo" });
    expect(reopened.completedAt).toBeNull();
  });

  it("drops a card between its neighbours and renumbers a crowded column", async () => {
    const { prisma, rows } = fakePrisma();
    const c = await createTodoItem(prisma, ME, { title: "C", origin: "user" });
    const b = await createTodoItem(prisma, ME, { title: "B", origin: "user" });
    const a = await createTodoItem(prisma, ME, { title: "A", origin: "user" });
    const moving = await createTodoItem(prisma, ME, {
      title: "M",
      status: "waiting",
      origin: "user",
    });
    await moveTodoItem(prisma, ME, { itemId: moving.id, status: "todo", beforeId: b.id });
    expect((await listTodoItems(prisma, ME)).map((item) => item.title)).toEqual([
      "A",
      "M",
      "B",
      "C",
    ]);
    for (const row of rows)
      if (row.id === b.id) row.position = (rows[3]!.position as number) + 1e-9;
    await moveTodoItem(prisma, ME, { itemId: a.id, status: "todo", beforeId: b.id });
    await moveTodoItem(prisma, ME, { itemId: c.id, status: "todo", beforeId: null });
    const titles = (await listTodoItems(prisma, ME)).map((item) => item.title);
    expect(titles.at(-1)).toBe("C");
    expect(new Set(titles).size).toBe(4);
  });

  it("archives and restores instead of losing items", async () => {
    const { prisma } = fakePrisma();
    const item = await createTodoItem(prisma, ME, { title: "Old", origin: "ai" });
    await archiveTodoItem(prisma, ME, item.id);
    expect(await listTodoItems(prisma, ME)).toEqual([]);
    expect(await listTodoItems(prisma, ME, { includeArchived: true })).toHaveLength(1);
    await restoreTodoItem(prisma, ME, item.id);
    expect((await listTodoItems(prisma, ME)).map((row) => row.title)).toEqual(["Old"]);
  });
});
