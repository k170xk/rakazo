import { ORPCError } from "@orpc/server";
import type { TodoOwner } from "@rakazo/adapters";
import {
  archiveTodoItem,
  createTodoItem,
  deleteTodoItem,
  listTodoItems,
  moveTodoItem,
  restoreTodoItem,
  TodoNotFoundError,
  updateTodoItem,
} from "@rakazo/adapters";
import { IsolationError } from "@rakazo/db";
import type { RouterContext } from "./context.js";

/** Not-found stays an isolation error; bad values become a 400. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof TodoNotFoundError) throw new IsolationError();
    if (error instanceof Error && !(error instanceof ORPCError)) {
      throw new ORPCError("BAD_REQUEST", { message: error.message });
    }
    throw error;
  }
}

/** The person's own to-do list; every call reads and writes only their rows. */
export function todosRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const owner = (actor: TodoOwner): TodoOwner => ({ spaceId: actor.spaceId, userId: actor.userId });
  return {
    todos: {
      list: authed.todos.list.handler(({ context, input }) =>
        listTodoItems(deps.prisma, owner(context.actor), {
          includeArchived: input.includeArchived ?? false,
        }),
      ),
      create: authed.todos.create.handler(({ context, input }) =>
        guarded(() =>
          createTodoItem(deps.prisma, owner(context.actor), { ...input, origin: "user" }),
        ),
      ),
      update: authed.todos.update.handler(({ context, input }) => {
        const { itemId, ...patch } = input;
        return guarded(() => updateTodoItem(deps.prisma, owner(context.actor), itemId, patch));
      }),
      move: authed.todos.move.handler(({ context, input }) =>
        guarded(() => moveTodoItem(deps.prisma, owner(context.actor), input)),
      ),
      archive: authed.todos.archive.handler(({ context, input }) =>
        guarded(() => archiveTodoItem(deps.prisma, owner(context.actor), input.itemId)),
      ),
      restore: authed.todos.restore.handler(({ context, input }) =>
        guarded(() => restoreTodoItem(deps.prisma, owner(context.actor), input.itemId)),
      ),
      remove: authed.todos.remove.handler(async ({ context, input }) => {
        await guarded(() => deleteTodoItem(deps.prisma, owner(context.actor), input.itemId));
        return { ok: true as const };
      }),
    },
  };
}
