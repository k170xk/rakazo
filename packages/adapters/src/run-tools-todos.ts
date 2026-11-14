import type { TodoPriority, TodoStatus } from "@rakazo/contracts";
import { todoListId } from "./todo-items.js";
import { isOwnersPrivateChat } from "./connection-context.js";
import type { RunContext } from "./run-context.js";
import type { ToolHandlers } from "./run-tool-gate.js";
import type { TodoOwner } from "./todo-items.js";
import {
  archiveTodoItem,
  createTodoItem,
  isTodoPriority,
  isTodoStatus,
  listTodoItems,
  TodoNotFoundError,
  updateTodoItem,
} from "./todo-items.js";

export const TODO_TOOL_NAMES = ["todo_list", "todo_add", "todo_update", "todo_archive"] as const;
const TODO_LIST_LIMIT = 200;
const NOTES_SHOWN = 500;

export const PRIVATE_TODOS =
  "The to-do list is only available in the person's own chat with their own assistant, or in their routines.";

/** The person's list, reachable only from their own private chat or routine. */
function ownerOf(ctx: RunContext): TodoOwner | undefined {
  const { run, bot, thread } = ctx;
  if (
    !isOwnersPrivateChat({
      run,
      bot,
      thread,
      peerBotUserId: ctx.source?.peerBotUserId,
    })
  )
    return undefined;
  return { spaceId: run.spaceId, userId: run.userId };
}

function statusArg(value: unknown): TodoStatus | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isTodoStatus(value)) throw new Error("status must be todo, in_progress, waiting or done.");
  return value;
}

function priorityArg(value: unknown): TodoPriority | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isTodoPriority(value)) throw new Error("priority must be low, normal or high.");
  return value;
}

function optionalText(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

function sourceArg(args: Record<string, unknown>) {
  const label = optionalText(args.source_label);
  const link = optionalText(args.source_link);
  if (label === undefined && link === undefined && args.source_kind === undefined) {
    return undefined;
  }
  return { kind: args.source_kind, label: label ?? "", link: link ?? null };
}

async function guarded(work: () => Promise<unknown>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof TodoNotFoundError) return { error: error.message };
    if (error instanceof Error) return { error: error.message };
    throw error;
  }
}

/** The person's own to-do list: read, add, change and archive (never delete). */
export const todoTools: ToolHandlers = {
  async todo_list(ctx, call) {
    const owner = ownerOf(ctx);
    if (!owner) return { error: PRIVATE_TODOS };
    const items = await listTodoItems(ctx.deps.prisma, owner, {
      status: statusArg(call.args.status),
      includeDone: call.args.include_done === true,
      listId: todoListId(optionalText(call.args.list_id)),
    });
    return {
      items: items.slice(0, TODO_LIST_LIMIT).map((item) => ({
        item_id: item.id,
        title: item.title,
        status: item.status,
        priority: item.priority,
        ...(item.dueAt ? { due: item.dueAt } : {}),
        ...(item.notes
          ? {
              notes:
                item.notes.length > NOTES_SHOWN
                  ? `${item.notes.slice(0, NOTES_SHOWN)}…`
                  : item.notes,
            }
          : {}),
        ...(item.source ? { source: item.source } : {}),
        added_by: item.origin === "ai" ? "assistant" : "person",
      })),
      ...(items.length > TODO_LIST_LIMIT
        ? { note: `Showing ${TODO_LIST_LIMIT} of ${items.length}; filter by status.` }
        : {}),
    };
  },
  async todo_add(ctx, call) {
    const owner = ownerOf(ctx);
    if (!owner) return { error: PRIVATE_TODOS };
    const { args } = call;
    return call.finish(
      await guarded(async () => {
        const item = await createTodoItem(ctx.deps.prisma, owner, {
          title: String(args.title ?? ""),
          notes: optionalText(args.notes),
          status: statusArg(args.status),
          priority: priorityArg(args.priority),
          dueAt: optionalText(args.due) ?? null,
          source: sourceArg(args) ?? null,
          origin: "ai",
          botId: ctx.bot.id,
          listId: todoListId(optionalText(args.list_id)),
        });
        return { ok: true, item_id: item.id, status: item.status };
      }),
    );
  },
  async todo_update(ctx, call) {
    const owner = ownerOf(ctx);
    if (!owner) return { error: PRIVATE_TODOS };
    const { args } = call;
    return call.finish(
      await guarded(async () => {
        const item = await updateTodoItem(ctx.deps.prisma, owner, String(args.item_id ?? ""), {
          title: optionalText(args.title),
          notes: optionalText(args.notes),
          status: statusArg(args.status),
          priority: priorityArg(args.priority),
          dueAt: args.due === undefined ? undefined : (optionalText(args.due) ?? null),
          source: sourceArg(args),
        });
        return { ok: true, item_id: item.id, status: item.status };
      }),
    );
  },
  async todo_archive(ctx, call) {
    const owner = ownerOf(ctx);
    if (!owner) return { error: PRIVATE_TODOS };
    return call.finish(
      await guarded(async () => {
        const item = await archiveTodoItem(ctx.deps.prisma, owner, String(call.args.item_id ?? ""));
        return { ok: true, item_id: item.id, archived: true };
      }),
    );
  },
};
