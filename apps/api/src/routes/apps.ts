import { ORPCError } from "@orpc/server";
import { drawAppIconLater } from "@rakazo/adapters";
import { AppHistoryError, isAppDataError } from "@rakazo/db";
import { AppAskError } from "../app-ask.js";
import {
  AppPublishError,
  AppVersionConflictError,
  createTemplateApp,
  deleteAppAsset,
  getAppAsset,
  getAppAssets,
  getAppData,
  getAppFiles,
  getAppRevision,
  getEvolvePublication,
  importWorkbookApp,
  listAppVersions,
  listOwnerAppChanges,
  ownerAsk,
  ownerDefineTable,
  ownerDropTable,
  ownerExportTable,
  ownerInsertRow,
  ownerRemoveRow,
  ownerUpdateRow,
  previewApp,
  publishAppToEvolve,
  redrawAppIcon,
  reimportWorkbookApp,
  restoreAppVersion,
  saveAppFiles,
  setAppDataAccess,
  undoOwnerAppChange,
  uploadAppAsset,
  WorkbookImportError,
} from "../apps.js";
import { actorEmail } from "./bots.js";
import type { RouterContext } from "./context.js";

/** A refused write (a bad value, a missing row or table) is the caller's to fix, not a crash. */
async function refusals<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (
      isAppDataError(error) ||
      error instanceof AppHistoryError ||
      error instanceof WorkbookImportError ||
      error instanceof AppAskError ||
      error instanceof AppPublishError
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: error instanceof Error ? error.message : "Refused",
      });
    }
    if (error instanceof AppVersionConflictError)
      throw new ORPCError("CONFLICT", { message: error.message });
    throw error;
  }
}

export function appsRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const db = deps.prisma;
  // A new app gets its OCSC icon drawn in the background; the person does not wait for it.
  const drawIcon =
    (actor: { userId: string }) => (app: { pageId: string; title: string; subject?: string }) =>
      void drawAppIconLater(
        { prisma: db, connection: deps.evolvePlugins ?? null },
        { pageId: app.pageId, userId: actor.userId, title: app.title, subject: app.subject },
      );
  return {
    apps: {
      evolvePublication: authed.apps.evolvePublication.handler(({ context, input }) =>
        getEvolvePublication(db, context.actor, deps.evolvePlugins ?? null, input.pageId),
      ),
      publishToEvolve: authed.apps.publishToEvolve.handler(async ({ context, input }) =>
        refusals(async () =>
          publishAppToEvolve(
            db,
            context.actor,
            deps.evolvePlugins ?? null,
            await actorEmail(deps, context.actor),
            input,
          ),
        ),
      ),
      reimportWorkbook: authed.apps.reimportWorkbook.handler(({ context, input }) =>
        refusals(() => reimportWorkbookApp(db, context.actor, input)),
      ),
      ask: authed.apps.ask.handler(({ context, input }) =>
        refusals(() => ownerAsk(db, context.actor, input)),
      ),
      data: authed.apps.data.handler(({ context, input }) =>
        getAppData(db, context.actor, input.pageId),
      ),
      revision: authed.apps.revision.handler(({ context, input }) =>
        getAppRevision(db, context.actor, input.pageId),
      ),
      redrawIcon: authed.apps.redrawIcon.handler(async ({ context, input }) => {
        const icon = await redrawAppIcon(db, context.actor, deps.evolvePlugins ?? null, input);
        if (!icon)
          throw new ORPCError("SERVICE_UNAVAILABLE", {
            message: deps.evolvePlugins
              ? "The icon could not be drawn. Try again in a moment."
              : "Icons are drawn through Evolve, which is not linked to this server.",
          });
        return { icon };
      }),
      insertRow: authed.apps.insertRow.handler(({ context, input }) =>
        refusals(() => ownerInsertRow(db, context.actor, input)),
      ),
      updateRow: authed.apps.updateRow.handler(({ context, input }) =>
        refusals(() => ownerUpdateRow(db, context.actor, input)),
      ),
      removeRow: authed.apps.removeRow.handler(({ context, input }) =>
        refusals(() => ownerRemoveRow(db, context.actor, input)),
      ),
      defineTable: authed.apps.defineTable.handler(({ context, input }) =>
        refusals(() => ownerDefineTable(db, context.actor, input)),
      ),
      dropTable: authed.apps.dropTable.handler(({ context, input }) =>
        refusals(() => ownerDropTable(db, context.actor, input)),
      ),
      files: authed.apps.files.handler(({ context, input }) =>
        getAppFiles(db, context.actor, input),
      ),
      saveFiles: authed.apps.saveFiles.handler(({ context, input }) =>
        refusals(() => saveAppFiles(db, context.actor, input)),
      ),
      preview: authed.apps.preview.handler(({ context, input }) =>
        previewApp(db, context.actor, input),
      ),
      versions: authed.apps.versions.handler(({ context, input }) =>
        listAppVersions(db, context.actor, input.pageId),
      ),
      restore: authed.apps.restore.handler(({ context, input }) =>
        refusals(() => restoreAppVersion(db, context.actor, input)),
      ),
      changes: authed.apps.changes.handler(({ context, input }) =>
        listOwnerAppChanges(db, context.actor, input.pageId),
      ),
      undoChange: authed.apps.undoChange.handler(({ context, input }) =>
        refusals(() => undoOwnerAppChange(db, context.actor, input)),
      ),
      setDataAccess: authed.apps.setDataAccess.handler(({ context, input }) =>
        setAppDataAccess(db, context.actor, input),
      ),
      assets: authed.apps.assets.handler(({ context, input }) =>
        getAppAssets(db, context.actor, input.pageId),
      ),
      asset: authed.apps.asset.handler(({ context, input }) =>
        getAppAsset(db, context.actor, input),
      ),
      addAsset: authed.apps.addAsset.handler(({ context, input }) =>
        refusals(() => uploadAppAsset(db, context.actor, input)),
      ),
      removeAsset: authed.apps.removeAsset.handler(({ context, input }) =>
        deleteAppAsset(db, context.actor, input),
      ),
      export: authed.apps.export.handler(({ context, input }) =>
        ownerExportTable(db, context.actor, input),
      ),
      importWorkbook: authed.apps.importWorkbook.handler(({ context, input }) =>
        refusals(() => importWorkbookApp(db, context.actor, input, drawIcon(context.actor))),
      ),
      createFromTemplate: authed.apps.createFromTemplate.handler(({ context, input }) =>
        refusals(() => createTemplateApp(db, context.actor, input, drawIcon(context.actor))),
      ),
    },
  };
}
