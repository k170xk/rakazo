import { ORPCError } from "@orpc/server";
import {
  BoardChangedError,
  BoardSaveError,
  createWhiteboard,
  getPage,
  getPageState,
  listPages,
  listPublishedApps,
  PageFrozenError,
  PageListCursorError,
  PageShareConflictError,
  PageStateRefusedError,
  pinPage,
  removePage,
  renamePage,
  savePageState,
  saveWhiteboard,
  setPageVisibility,
} from "../pages.js";
import type { RouterContext } from "./context.js";

export function pagesRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const pageDeps = () => ({
    prisma: deps.prisma,
    secrets: deps.secrets,
    webOrigin: deps.env.webOrigin,
  });
  return {
    pages: {
      list: authed.pages.list.handler(async ({ context, input }) => {
        try {
          return await listPages(deps.prisma, context.actor, input);
        } catch (error) {
          if (error instanceof PageListCursorError) {
            throw new ORPCError("BAD_REQUEST", { message: error.message });
          }
          throw error;
        }
      }),
      published: authed.pages.published.handler(({ context }) =>
        listPublishedApps(pageDeps(), context.actor),
      ),
      get: authed.pages.get.handler(({ context, input }) =>
        getPage(pageDeps(), context.actor, input),
      ),
      rename: authed.pages.rename.handler(({ context, input }) =>
        renamePage(deps.prisma, context.actor, input.pageId, input.title),
      ),
      setVisibility: authed.pages.setVisibility.handler(async ({ context, input }) => {
        try {
          return await setPageVisibility(
            pageDeps(),
            context.actor,
            input,
            context.signal ?? new AbortController().signal,
          );
        } catch (error) {
          if (error instanceof PageShareConflictError) {
            throw new ORPCError("CONFLICT", { message: error.message });
          }
          if (error instanceof PageFrozenError) {
            throw new ORPCError("FORBIDDEN", { message: error.message });
          }
          throw error;
        }
      }),
      pin: authed.pages.pin.handler(({ context, input }) =>
        pinPage(deps.prisma, context.actor, input.pageId, input.pinned),
      ),
      remove: authed.pages.remove.handler(({ context, input }) =>
        removePage(pageDeps(), context.actor, input.pageId),
      ),
      state: authed.pages.state.handler(({ context, input }) =>
        getPageState(deps.prisma, context.actor, input.pageId),
      ),
      saveState: authed.pages.saveState.handler(async ({ context, input }) => {
        try {
          return await savePageState(deps.prisma, context.actor, input);
        } catch (error) {
          if (error instanceof PageStateRefusedError) {
            throw new ORPCError("BAD_REQUEST", { message: error.message });
          }
          throw error;
        }
      }),
      createBoard: authed.pages.createBoard.handler(({ context, input }) =>
        createWhiteboard(deps.prisma, context.actor, input.title),
      ),
      saveBoard: authed.pages.saveBoard.handler(async ({ context, input }) => {
        try {
          return await saveWhiteboard(deps.prisma, context.actor, input);
        } catch (error) {
          if (error instanceof BoardChangedError) {
            throw new ORPCError("CONFLICT", { message: error.message });
          }
          if (error instanceof BoardSaveError) {
            throw new ORPCError("BAD_REQUEST", { message: error.message });
          }
          if (error instanceof PageFrozenError) {
            throw new ORPCError("FORBIDDEN", { message: error.message });
          }
          throw error;
        }
      }),
    },
  };
}
