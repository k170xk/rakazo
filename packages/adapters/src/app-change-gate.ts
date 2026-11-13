import type { RunContext } from "./run-context.js";

export const APP_CHANGE_TOOLS = new Set(["save_app", "save_page", "app_data", "app_asset"]);

type AppChange = { pageId: string; code: boolean; wipes: string[] };

const given = (value: unknown) =>
  value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && !value.length);

const nonEmptyObject = (value: unknown) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length > 0;

/**
 * What a call would change in an existing app or page: what its readers see (code, title, brief,
 * icon or pictures), and which tables it would empty. New apps and pages start private, so only
 * calls naming one are returned.
 */
export function appChangeOf(name: string, args: Record<string, unknown>): AppChange | null {
  const id = name === "save_page" ? args.pageId : args.appId;
  if (!given(id)) return null;
  const pageId = String(id);
  if (name === "save_page") {
    return {
      pageId,
      code: given(args.source) || given(args.edits) || given(args.title),
      wipes: [],
    };
  }
  if (name === "app_asset") return { pageId, code: true, wipes: [] };
  if (name === "app_data") {
    const action = typeof args.action === "string" ? args.action : "query";
    const table = typeof args.table === "string" ? args.table : "";
    return { pageId, code: false, wipes: action === "replace" || action === "drop" ? [table] : [] };
  }
  if (name !== "save_app") return null;
  const wipes = Array.isArray(args.tables)
    ? args.tables.flatMap((item) => {
        const table = item as {
          schema?: { name?: unknown };
          rows?: unknown;
          mode?: unknown;
        } | null;
        const replaces = Array.isArray(table?.rows) && (table?.mode ?? "replace") === "replace";
        return replaces && typeof table?.schema?.name === "string" ? [table.schema.name] : [];
      })
    : [];
  return {
    pageId,
    code:
      nonEmptyObject(args.files) ||
      given(args.edits) ||
      given(args.deleteFiles) ||
      given(args.title) ||
      given(args.brief) ||
      given(args.icon),
    wipes,
  };
}

/**
 * Whether a person must approve this change once outside content entered the run. Colleagues and
 * link visitors see a shared or published app's new code at once, and emptying a table loses rows
 * colleagues typed, so neither is left to a reviewer judging the same tainted context. Refreshing a
 * shared app's own rows and editing private apps stay free, so routines keep working unattended.
 */
export async function appChangeNeedsPerson(
  ctx: RunContext,
  name: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  const change = appChangeOf(name, args);
  if (!change) return false;
  const { prisma } = ctx.deps;
  const { run } = ctx;
  const page = await prisma.page.findFirst({
    where: { id: change.pageId, spaceId: run.spaceId, userId: run.userId },
    select: { visibility: true, evolvePluginSlug: true },
  });
  if (!page) return false;
  if (change.code && (page.visibility !== "private" || page.evolvePluginSlug)) return true;
  if (change.wipes.length === 0) return false;
  const colleagueRow = await prisma.appRow.findFirst({
    where: {
      pageId: change.pageId,
      createdBy: { not: null, notIn: [run.userId] },
      table: { name: { in: change.wipes } },
    },
    select: { id: true },
  });
  return colleagueRow !== null;
}
