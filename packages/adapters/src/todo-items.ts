import type { TodoItem, TodoPriority, TodoSource, TodoStatus } from "@rakazo/contracts";
import { TODO_NOTES_MAX, TODO_PRIORITIES, TODO_STATUSES, TODO_TITLE_MAX } from "@rakazo/contracts";
import type { Prisma, PrismaClient } from "@rakazo/db";

export type TodoOwner = { spaceId: string; userId: string };
type TodoPrisma = Pick<PrismaClient, "todoItem">;

const LABEL_MAX = 300;
const LINK_MAX = 2_000;
/** Below this gap between neighbours a column is renumbered before inserting. */
const MIN_GAP = 1e-6;

interface StoredContent {
  title: string;
  notes: string;
  source: TodoSource | null;
}

type TodoRow = {
  id: string;
  botId: string | null;
  content: Prisma.JsonValue;
  status: string;
  position: number;
  priority: string;
  dueAt: Date | null;
  origin: string;
  completedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function isTodoStatus(value: unknown): value is TodoStatus {
  return typeof value === "string" && (TODO_STATUSES as readonly string[]).includes(value);
}

export function isTodoPriority(value: unknown): value is TodoPriority {
  return typeof value === "string" && (TODO_PRIORITIES as readonly string[]).includes(value);
}

function contentOf(value: Prisma.JsonValue): StoredContent {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const source = (record as { source?: unknown }).source;
  return {
    title: typeof record.title === "string" ? record.title : "",
    notes: typeof record.notes === "string" ? record.notes : "",
    source:
      source && typeof source === "object" && !Array.isArray(source)
        ? cleanSource(source as Record<string, unknown>)
        : null,
  };
}

/** A source as stored and shown: known kind, short label, and only an https link. */
export function cleanSource(input: Record<string, unknown> | null | undefined): TodoSource | null {
  if (!input) return null;
  const label = typeof input.label === "string" ? input.label.trim().slice(0, LABEL_MAX) : "";
  const kind =
    input.kind === "email" || input.kind === "chat" || input.kind === "other"
      ? input.kind
      : "other";
  let link: string | null = null;
  if (typeof input.link === "string" && input.link.length <= LINK_MAX) {
    try {
      const url = new URL(input.link.trim());
      if (url.protocol === "https:") link = url.toString();
    } catch {}
  }
  if (!label && !link) return null;
  return { kind, label, link };
}

export function mapTodoItem(row: TodoRow): TodoItem {
  const content = contentOf(row.content);
  return {
    id: row.id,
    title: content.title,
    notes: content.notes,
    status: isTodoStatus(row.status) ? row.status : "todo",
    priority: isTodoPriority(row.priority) ? row.priority : "normal",
    position: row.position,
    dueAt: row.dueAt?.toISOString() ?? null,
    origin: row.origin === "ai" ? "ai" : "user",
    source: content.source,
    botId: row.botId,
    completedAt: row.completedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function ownerWhere(owner: TodoOwner) {
  return { spaceId: owner.spaceId, userId: owner.userId };
}

export async function listTodoItems(
  prisma: TodoPrisma,
  owner: TodoOwner,
  options: { includeArchived?: boolean; status?: TodoStatus; includeDone?: boolean } = {},
): Promise<TodoItem[]> {
  const rows = await prisma.todoItem.findMany({
    where: {
      ...ownerWhere(owner),
      ...(options.includeArchived ? {} : { archivedAt: null }),
      ...(options.status
        ? { status: options.status }
        : options.includeDone === false
          ? { status: { not: "done" } }
          : {}),
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(mapTodoItem);
}

async function findOwned(prisma: TodoPrisma, owner: TodoOwner, itemId: string) {
  const row = await prisma.todoItem.findFirst({ where: { id: itemId, ...ownerWhere(owner) } });
  if (!row) throw new TodoNotFoundError();
  return row;
}

export class TodoNotFoundError extends Error {
  constructor() {
    super("That to-do item was not found.");
  }
}

async function topPosition(prisma: TodoPrisma, owner: TodoOwner, status: TodoStatus) {
  const first = await prisma.todoItem.findFirst({
    where: { ...ownerWhere(owner), status, archivedAt: null },
    orderBy: { position: "asc" },
    select: { position: true },
  });
  return first ? first.position - 1 : 0;
}

function text(value: string, max: number, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`${label} must be at most ${max} characters.`);
  return trimmed;
}

function dueDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new Error("due must be a date such as 2026-11-14.");
  return new Date(time);
}

export interface TodoDraft {
  title: string;
  notes?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
  dueAt?: string | null;
  source?: Record<string, unknown> | null;
  origin: "user" | "ai";
  botId?: string | null;
}

export async function createTodoItem(
  prisma: TodoPrisma,
  owner: TodoOwner,
  draft: TodoDraft,
): Promise<TodoItem> {
  const title = text(draft.title, TODO_TITLE_MAX, "title");
  if (!title) throw new Error("title is required.");
  const status = draft.status ?? "todo";
  const content: StoredContent = {
    title,
    notes: text(draft.notes ?? "", TODO_NOTES_MAX, "notes"),
    source: cleanSource(draft.source),
  };
  const row = await prisma.todoItem.create({
    data: {
      ...ownerWhere(owner),
      botId: draft.botId ?? null,
      content: content as unknown as Prisma.InputJsonValue,
      status,
      priority: draft.priority ?? "normal",
      position: await topPosition(prisma, owner, status),
      dueAt: dueDate(draft.dueAt) ?? null,
      origin: draft.origin,
      sourceKind: content.source?.kind ?? null,
      completedAt: status === "done" ? new Date() : null,
    },
  });
  return mapTodoItem(row);
}

export interface TodoPatch {
  title?: string;
  notes?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
  dueAt?: string | null;
  source?: Record<string, unknown> | null;
}

export async function updateTodoItem(
  prisma: TodoPrisma,
  owner: TodoOwner,
  itemId: string,
  patch: TodoPatch,
): Promise<TodoItem> {
  const existing = await findOwned(prisma, owner, itemId);
  const content = contentOf(existing.content);
  if (patch.title !== undefined) {
    const title = text(patch.title, TODO_TITLE_MAX, "title");
    if (!title) throw new Error("title cannot be empty.");
    content.title = title;
  }
  if (patch.notes !== undefined) content.notes = text(patch.notes, TODO_NOTES_MAX, "notes");
  if (patch.source !== undefined) content.source = cleanSource(patch.source);
  const moved = patch.status !== undefined && patch.status !== existing.status;
  const row = await prisma.todoItem.update({
    where: { id: existing.id },
    data: {
      content: content as unknown as Prisma.InputJsonValue,
      sourceKind: content.source?.kind ?? null,
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.dueAt !== undefined ? { dueAt: dueDate(patch.dueAt) } : {}),
      ...(moved && patch.status
        ? {
            status: patch.status,
            position: await topPosition(prisma, owner, patch.status),
            completedAt: patch.status === "done" ? new Date() : null,
          }
        : {}),
    },
  });
  return mapTodoItem(row);
}

/** Drops an item into a column above `beforeId`, or at the bottom when that is null. */
export async function moveTodoItem(
  prisma: TodoPrisma,
  owner: TodoOwner,
  input: { itemId: string; status: TodoStatus; beforeId: string | null },
): Promise<TodoItem> {
  const existing = await findOwned(prisma, owner, input.itemId);
  const column = (
    await prisma.todoItem.findMany({
      where: { ...ownerWhere(owner), status: input.status, archivedAt: null },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, position: true },
    })
  ).filter((row) => row.id !== existing.id);
  let index = input.beforeId ? column.findIndex((row) => row.id === input.beforeId) : -1;
  if (index < 0) index = column.length;
  const gapTooSmall =
    index > 0 &&
    index < column.length &&
    column[index]!.position - column[index - 1]!.position < MIN_GAP;
  if (gapTooSmall) {
    await Promise.all(
      column.map((row, order) =>
        prisma.todoItem.update({ where: { id: row.id }, data: { position: order } }),
      ),
    );
    column.forEach((row, order) => {
      row.position = order;
    });
  }
  const above = column[index - 1]?.position;
  const below = column[index]?.position;
  const position =
    above === undefined
      ? below === undefined
        ? 0
        : below - 1
      : below === undefined
        ? above + 1
        : (above + below) / 2;
  const statusChanged = existing.status !== input.status;
  const row = await prisma.todoItem.update({
    where: { id: existing.id },
    data: {
      status: input.status,
      position,
      ...(statusChanged ? { completedAt: input.status === "done" ? new Date() : null } : {}),
    },
  });
  return mapTodoItem(row);
}

export async function archiveTodoItem(prisma: TodoPrisma, owner: TodoOwner, itemId: string) {
  const existing = await findOwned(prisma, owner, itemId);
  const row = await prisma.todoItem.update({
    where: { id: existing.id },
    data: { archivedAt: existing.archivedAt ?? new Date() },
  });
  return mapTodoItem(row);
}

export async function restoreTodoItem(prisma: TodoPrisma, owner: TodoOwner, itemId: string) {
  const existing = await findOwned(prisma, owner, itemId);
  const row = await prisma.todoItem.update({
    where: { id: existing.id },
    data: {
      archivedAt: null,
      position: await topPosition(
        prisma,
        owner,
        isTodoStatus(existing.status) ? existing.status : "todo",
      ),
    },
  });
  return mapTodoItem(row);
}

/** Permanent removal, for the person only; an assistant archives instead. */
export async function deleteTodoItem(prisma: TodoPrisma, owner: TodoOwner, itemId: string) {
  const existing = await findOwned(prisma, owner, itemId);
  await prisma.todoItem.delete({ where: { id: existing.id } });
}
