import type { MessageBlock } from "@rakazo/contracts";
import { PAGE_TITLE_MAX_LENGTH, PageTitleSchema } from "@rakazo/contracts";
import { containsEncodedSecret, containsSecret, redactSecrets } from "@rakazo/core";
import { withSourceData } from "@rakazo/page-kit/compile";
import { checkPageSource, PAGE_KIT_GUIDE } from "@rakazo/page-kit/validate";
import type { RunContext } from "./run-context.js";
import { isUniqueViolation, publishMessage } from "./run-messages.js";
import type { ToolCall, ToolHandlers } from "./run-tool-gate.js";
import { argumentGiven } from "./update-bot-patch.js";

const MAX_EDITS = 50;
const SOURCE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** New snapshots by source id, as a routine sends them to refresh a page's figures. */
function parseData(value: unknown): Record<string, unknown> | string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return 'data must be an object of source ids, e.g. {"jobs": [...]}.';
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return "data names no source.";
  const bad = entries.find(([id]) => !SOURCE_ID.test(id));
  if (bad) return `data: "${bad[0]}" is not a source id (letters, digits, _ and -).`;
  return Object.fromEntries(entries);
}

type PageEdit = { find: string; replace: string };

/** All edits or none: each `find` must occur exactly once in the result of the edits before it. */
function applyPageEdits(
  source: string,
  edits: readonly PageEdit[],
): { ok: true; source: string } | { ok: false; error: string } {
  let next = source;
  for (const [index, edit] of edits.entries()) {
    const label = `Edit ${index + 1}`;
    if (!edit.find) return { ok: false, error: `${label}: find is empty.` };
    const at = next.indexOf(edit.find);
    if (at === -1) return { ok: false, error: `${label}: find text was not found in the page.` };
    if (next.indexOf(edit.find, at + 1) !== -1) {
      return {
        ok: false,
        error: `${label}: find text occurs more than once; include more surrounding text.`,
      };
    }
    next = next.slice(0, at) + edit.replace + next.slice(at + edit.find.length);
  }
  return { ok: true, source: next };
}

function parseEdits(value: unknown): PageEdit[] | string {
  if (!Array.isArray(value) || value.length === 0) return "edits must be a non-empty list.";
  if (value.length > MAX_EDITS) return `Send at most ${MAX_EDITS} edits at once.`;
  const edits: PageEdit[] = [];
  for (const [index, item] of value.entries()) {
    const edit = item as Partial<PageEdit> | null;
    if (typeof edit?.find !== "string" || typeof edit.replace !== "string") {
      return `Edit ${index + 1}: needs find and replace strings.`;
    }
    edits.push({ find: edit.find, replace: edit.replace });
  }
  return edits;
}

async function savePage(ctx: RunContext, call: ToolCall) {
  const { deps, run, bot, thread } = ctx;
  const { args } = call;
  if (args.help === true) return { guide: PAGE_KIT_GUIDE };
  const pageId = argumentGiven(args.pageId) ? String(args.pageId) : undefined;
  if (!pageId && ctx.tools?.offered.some((tool) => tool.name === "save_app")) {
    return {
      error:
        'New apps, dashboards and reports are built in the App Studio: use save_app (call it with {"help": true} first). save_page only updates an existing page by its pageId.',
    };
  }
  const hasSource = argumentGiven(args.source);
  // Serializers send unused optional fields blank, an empty list included.
  const hasEdits = Array.isArray(args.edits) ? args.edits.length > 0 : argumentGiven(args.edits);
  if (hasSource && hasEdits) return { error: "Send either source or edits, not both." };
  const hasData =
    args.data !== null &&
    typeof args.data === "object" &&
    !Array.isArray(args.data) &&
    Object.keys(args.data).length > 0;
  let title: string | undefined;
  if (argumentGiven(args.title)) {
    const parsed = PageTitleSchema.safeParse(args.title);
    if (!parsed.success) return { error: "title must be 1 to 200 characters." };
    title = redactSecrets(parsed.data, ctx.secrets).slice(0, PAGE_TITLE_MAX_LENGTH);
  }

  // A bot reaches its own pages and its group's pages, from any of its chats or routines; another
  // bot's page answers as if it did not exist, since its source may hold that chat's text.
  const reachable = thread.groupId
    ? [{ botId: bot.id }, { groupId: thread.groupId }]
    : [{ botId: bot.id }];
  const page = pageId
    ? await deps.prisma.page.findFirst({
        where: { id: pageId, spaceId: run.spaceId, userId: run.userId, OR: reachable },
        select: {
          id: true,
          kind: true,
          title: true,
          currentVersion: true,
          versions: { orderBy: { version: "desc" }, take: 1, select: { source: true } },
          state: { select: { key: true, value: true }, orderBy: { key: "asc" } },
        },
      })
    : null;
  if (pageId && !page) return { error: "No page with that pageId belongs to this agent or chat." };
  if (page?.kind === "app") {
    return { error: "That id is an app, not a page; change it with save_app." };
  }
  const current = page?.versions[0]?.source ?? "";

  if (page && !hasSource && !hasEdits && !hasData && !title) {
    // The stored source and what readers saved may hold outside text, so reading them taints
    // this run like any other outside content; saves only confirm this run's own write.
    ctx.state.tainted = true;
    return {
      pageId: page.id,
      version: page.currentVersion,
      title: page.title,
      source: current,
      state: Object.fromEntries(page.state.map((row) => [row.key, row.value])),
    };
  }
  if (!page && hasEdits) return { error: "edits need the pageId of the page to change." };
  if (!page && !hasSource) return { error: "A new page needs source." };
  if (!page && !title) return { error: "A new page needs a title." };

  let source = hasSource ? String(args.source) : current;
  if (hasEdits) {
    const edits = parseEdits(args.edits);
    if (typeof edits === "string") return { error: edits, unchanged: true };
    const applied = applyPageEdits(current, edits);
    if (!applied.ok) return { error: applied.error, unchanged: true };
    source = applied.source;
  }
  let unusedSources: string[] = [];
  if (hasData) {
    const data = parseData(args.data);
    if (typeof data === "string") return { error: data, unchanged: true };
    const refreshed = withSourceData(source, data, new Date().toISOString());
    if (!refreshed.ok) return { error: refreshed.error, unchanged: true };
    source = refreshed.source;
    unusedSources = refreshed.unused;
  }
  const check = checkPageSource(source);
  if (!check.ok) {
    return { error: "The page has problems; nothing was saved.", problems: check.errors };
  }
  // A page can be shared by link, so it never stores a value this run keeps secret.
  if (
    containsSecret([source, check.code], ctx.secrets) ||
    containsEncodedSecret([source], ctx.secrets)
  ) {
    return {
      error: "The page contains a secret value; nothing was saved. Remove it and save again.",
      unchanged: true,
    };
  }

  let saved: { pageId: string; version: number; title: string };
  try {
    saved = await deps.prisma.$transaction(async (tx) => {
      if (!page) {
        const created = await tx.page.create({
          data: {
            spaceId: run.spaceId,
            userId: run.userId,
            botId: bot.id,
            groupId: thread.groupId,
            title: title!,
            versions: {
              create: { version: 1, title: title!, source, code: check.code, runId: ctx.runId },
            },
          },
        });
        return { pageId: created.id, version: 1, title: created.title };
      }
      const version = page.currentVersion + 1;
      // Conditional on the version this change was built from, so two saves never interleave.
      // With no new title the page keeps its current one, even a rename made after the read.
      const moved = await tx.page.updateMany({
        where: { id: page.id, currentVersion: page.currentVersion },
        data: { currentVersion: version, title, updatedAt: new Date() },
      });
      if (moved.count === 0) throw new PageChangedError();
      let nextTitle =
        title ??
        (await tx.page.findUniqueOrThrow({ where: { id: page.id }, select: { title: true } }))
          .title;
      // A title saved before this run learned a secret is redacted before it is shown again.
      const kept = redactSecrets(nextTitle, ctx.secrets).slice(0, PAGE_TITLE_MAX_LENGTH);
      if (kept !== nextTitle) {
        nextTitle = kept;
        await tx.page.update({ where: { id: page.id }, data: { title: kept } });
      }
      await tx.pageVersion.create({
        data: {
          pageId: page.id,
          version,
          title: nextTitle,
          source,
          code: check.code,
          runId: ctx.runId,
        },
      });
      return { pageId: page.id, version, title: nextTitle };
    });
  } catch (error) {
    if (error instanceof PageChangedError || isUniqueViolation(error)) {
      return { error: "The page changed while saving; read it again and retry.", unchanged: true };
    }
    throw error;
  }
  const block: MessageBlock = { kind: "page", ...saved };
  const linkText = saved.title.replace(/[\\[\]]/g, "\\$&");
  try {
    // A routine speaks only through its final reply, which may be silence, so refreshing a
    // page it already showed posts no card; its first save still does.
    if (!page || run.trigger !== "routine") await publishMessage(deps, run, "bot", [block]);
  } catch (error) {
    // The page is saved; only its card in the chat is missing, so the bot can still link it.
    return {
      ...saved,
      error: `The page was saved, but its card could not be posted in the chat (${
        error instanceof Error ? error.message : "unknown error"
      }). Link it in your reply as [${linkText}](page:${saved.pageId}).`,
    };
  }
  const result = {
    ...saved,
    mention: `Mention it in your reply as [${linkText}](page:${saved.pageId})`,
  };
  const warnings = [
    ...(check.warnings ?? []),
    ...unusedSources.map(
      (id) =>
        `data "${id}" was saved, but the page never calls useSource("${id}"), so it shows nothing.`,
    ),
  ];
  return warnings.length ? { ...result, warnings } : result;
}

class PageChangedError extends Error {}

export const pageTools: ToolHandlers = {
  async save_page(ctx, call) {
    return call.finish(await savePage(ctx, call));
  },
};
