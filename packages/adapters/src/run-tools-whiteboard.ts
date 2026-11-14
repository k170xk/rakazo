import type {
  BOARD_COLORS,
  BoardDirection,
  BoardItem,
  BoardOp,
  MessageBlock,
} from "@rakazo/contracts";
import {
  applyBoardOps,
  BOARD_KINDS,
  BoardItemSchema,
  BoardOpSchema,
  boardForModel,
  boardSource,
  danglingArrow,
  fitBoardItemSize,
  inspectBoardLayout,
  layoutBoardItems,
  PAGE_SOURCE_MAX_BYTES,
  PAGE_TITLE_MAX_LENGTH,
  PageTitleSchema,
  pageSourceBytes,
  readBoardItems,
  settleBoardSections,
} from "@rakazo/contracts";
import { containsEncodedSecret, containsSecret, redactSecrets } from "@rakazo/core";
import { addAppAsset, isAppDataError } from "@rakazo/db";
import type { RunContext } from "./run-context.js";
import { isUniqueViolation, publishMessage } from "./run-messages.js";
import type { ToolCall, ToolHandlers } from "./run-tool-gate.js";
import { loadPagePictureBytes } from "./run-tools-apps.js";
import { argumentGiven } from "./update-bot-patch.js";

const SHAPE: Record<
  (typeof BOARD_KINDS)[number],
  { w: number; h: number; color: (typeof BOARD_COLORS)[number] }
> = {
  sticky: { w: 180, h: 150, color: "yellow" },
  text: { w: 240, h: 48, color: "ink" },
  rect: { w: 200, h: 84, color: "green" },
  ellipse: { w: 160, h: 90, color: "grey" },
  diamond: { w: 170, h: 110, color: "orange" },
  cylinder: { w: 150, h: 96, color: "blue" },
  document: { w: 150, h: 110, color: "grey" },
  cloud: { w: 190, h: 110, color: "green" },
  queue: { w: 180, h: 80, color: "purple" },
  section: { w: 520, h: 300, color: "grey" },
  arrow: { w: 0, h: 0, color: "ink" },
  pen: { w: 0, h: 0, color: "ink" },
  image: { w: 360, h: 202, color: "grey" },
};

function place(
  index: number,
  existing: readonly BoardItem[],
  kind: keyof typeof SHAPE,
  sectionId?: string,
) {
  const shape = SHAPE[kind];
  if (sectionId) {
    const sec = existing.find((item) => item.id === sectionId && item.kind === "section");
    if (sec) {
      const siblings = existing.filter(
        (item) => item.section === sectionId && item.kind !== "arrow",
      );
      const col = siblings.length % 2;
      const row = Math.floor(siblings.length / 2);
      return {
        x: sec.x + 32 + col * (shape.w + 48),
        y: sec.y + 64 + row * (shape.h + 40),
      };
    }
  }
  const boxes = existing.filter((item) => item.kind !== "arrow");
  const bottom = boxes.length ? Math.max(...boxes.map((item) => item.y + item.h)) : 0;
  return {
    x: 48 + (index % 3) * (shape.w + 40),
    y: (boxes.length ? bottom + 48 : 48) + Math.floor(index / 3) * (shape.h + 36),
  };
}

/**
 * A pen is stored as offsets from its box. Points already inside that box stay. Points written as
 * canvas positions are moved into a box around the stroke, so the line lands where it was drawn.
 */
function placedPen(
  raw: unknown,
  x: unknown,
  y: unknown,
  w: unknown,
  h: unknown,
): { x: number; y: number; w: number; h: number; points: [number, number][] } | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const points = raw.flatMap((point) => {
    if (!Array.isArray(point) || point.length < 2) return [];
    const px = Number(point[0]);
    const py = Number(point[1]);
    return Number.isFinite(px) && Number.isFinite(py) ? [[px, py] as [number, number]] : [];
  });
  if (!points.length) return null;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const width = typeof w === "number" ? w : maxX - minX;
  const height = typeof h === "number" ? h : maxY - minY;
  const relative = minX >= -1 && minY >= -1 && maxX <= width + 8 && maxY <= height + 8;
  if (relative && typeof x === "number" && typeof y === "number") {
    return {
      x,
      y,
      w: Math.max(width, maxX - minX, 8),
      h: Math.max(height, maxY - minY, 8),
      points,
    };
  }
  return {
    x: minX,
    y: minY,
    w: Math.max(8, Math.round(maxX - minX)),
    h: Math.max(8, Math.round(maxY - minY)),
    points: points.map(([px, py]) => [Math.round(px - minX), Math.round(py - minY)]),
  };
}

/** Fills in size, colour and a spot when the model names a block without laying it out. */
function normalizeItem(
  raw: unknown,
  index: number,
  existing: readonly BoardItem[],
): BoardItem | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return `Item ${index + 1} must be an object.`;
  }
  const item = raw as Record<string, unknown>;
  const kind = typeof item.kind === "string" ? item.kind : "";
  if (!(kind in SHAPE)) {
    return `Item ${index + 1}: kind must be one of ${BOARD_KINDS.join(", ")}.`;
  }
  const shape = SHAPE[kind as keyof typeof SHAPE];
  const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : `n${index + 1}`;
  const section =
    typeof item.section === "string" &&
    item.section.trim() &&
    kind !== "section" &&
    kind !== "arrow"
      ? item.section.trim()
      : undefined;
  const spot =
    typeof item.x === "number" && typeof item.y === "number"
      ? null
      : place(index, existing, kind as keyof typeof SHAPE, section);
  const pen = kind === "pen" ? placedPen(item.points, item.x, item.y, item.w, item.h) : null;
  const baseDraft = {
    id,
    kind,
    x: pen?.x ?? (typeof item.x === "number" ? item.x : spot!.x),
    y: pen?.y ?? (typeof item.y === "number" ? item.y : spot!.y),
    w: pen?.w ?? (typeof item.w === "number" ? item.w : shape.w),
    h: pen?.h ?? (typeof item.h === "number" ? item.h : shape.h),
    color: typeof item.color === "string" ? item.color : shape.color,
    ...(typeof item.text === "string" ? { text: item.text } : {}),
    ...(section ? { section } : {}),
    ...(item.from && typeof item.from === "object" ? { from: item.from } : {}),
    ...(item.to && typeof item.to === "object" ? { to: item.to } : {}),
    ...(typeof item.asset === "string" ? { asset: item.asset } : {}),
    ...(pen ? { points: pen.points } : Array.isArray(item.points) ? { points: item.points } : {}),
  };
  const parsed = BoardItemSchema.safeParse(baseDraft);
  if (!parsed.success) {
    return `Item ${index + 1}: ${parsed.error.issues[0]?.message ?? "invalid"}.`;
  }
  if (typeof item.w !== "number" || typeof item.h !== "number") {
    const fitted = fitBoardItemSize(parsed.data);
    return {
      ...parsed.data,
      w: typeof item.w === "number" ? item.w : fitted.w,
      h: typeof item.h === "number" ? item.h : fitted.h,
    };
  }
  return parsed.data;
}

function parseItems(value: unknown): BoardItem[] | string {
  if (!Array.isArray(value)) return "items must be a list of blocks.";
  const items: BoardItem[] = [];
  for (const [index, raw] of value.entries()) {
    const item = normalizeItem(raw, index, items);
    if (typeof item === "string") return item;
    items.push(item);
  }
  const dangling = danglingArrow(items);
  if (dangling) return dangling;
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) return `"${item.id}" is used more than once.`;
    ids.add(item.id);
  }
  return items;
}

function parseOps(value: unknown, existing: readonly BoardItem[]): BoardOp[] | string {
  if (!Array.isArray(value) || value.length === 0) return "ops must be a non-empty list.";
  const ops: BoardOp[] = [];
  const added: BoardItem[] = [];
  for (const [index, raw] of value.entries()) {
    const op = raw as { op?: unknown; item?: unknown } | null;
    if (op?.op === "add") {
      const item = normalizeItem(op.item, index, [...existing, ...added]);
      if (typeof item === "string") return item;
      added.push(item);
      ops.push({ op: "add", item });
      continue;
    }
    const parsed = BoardOpSchema.safeParse(raw);
    if (!parsed.success || parsed.data.op === "add") {
      return `Change ${index + 1}: ${parsed.success ? "invalid" : (parsed.error.issues[0]?.message ?? "invalid")}.`;
    }
    ops.push(parsed.data);
  }
  return ops;
}

type PendingPicture = { bytes: Uint8Array; mime: string; name: string; source: string };

async function prepareItemInput(
  ctx: RunContext,
  call: ToolCall,
  raw: unknown,
  pending: Map<string, PendingPicture>,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: true, value: raw };
  const obj = raw as Record<string, unknown>;
  const hasSource = [obj.url, obj.artifactId, obj.path].some(argumentGiven);
  if (!hasSource) return { ok: true, value: raw };
  const loaded = await loadPagePictureBytes(ctx, call, {
    url: obj.url,
    artifactId: obj.artifactId,
    path: obj.path,
    name: obj.name ?? obj.text,
  });
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const token = `pending_${pending.size + 1}`;
  pending.set(token, loaded);
  const { url: _u, artifactId: _a, path: _p, name: _n, ...rest } = obj;
  return { ok: true, value: { ...rest, asset: token } };
}

async function prepareOpsInput(
  ctx: RunContext,
  call: ToolCall,
  rawOps: unknown[],
  pending: Map<string, PendingPicture>,
): Promise<unknown[] | { error: string }> {
  const out: unknown[] = [];
  for (const entry of rawOps) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      out.push(entry);
      continue;
    }
    const op = entry as Record<string, unknown>;
    if (op.op === "add" && op.item && typeof op.item === "object") {
      const prepared = await prepareItemInput(ctx, call, op.item, pending);
      if (!prepared.ok) return { error: prepared.error };
      out.push({ ...op, item: prepared.value });
      continue;
    }
    if (op.op === "update" && op.patch && typeof op.patch === "object") {
      const prepared = await prepareItemInput(ctx, call, op.patch, pending);
      if (!prepared.ok) return { error: prepared.error };
      out.push({ ...op, patch: prepared.value });
      continue;
    }
    out.push(entry);
  }
  return out;
}

function parseLayoutArg(raw: unknown): BoardDirection | "manual" | null {
  if (raw === undefined || raw === null) return null;
  if (raw === "right" || raw === "down" || raw === "lanes" || raw === "grid" || raw === "manual") {
    return raw;
  }
  if (raw === "auto" || raw === true) return "right";
  if (raw === false) return "manual";
  return null;
}

class BoardChangedError extends Error {}

const WHITEBOARD_GUIDE = `# Whiteboard Authoring Guide (save_whiteboard)

## 1. Choose the Right Layout Mode
- \`"right"\` — End-to-end workflows, pipelines, bid/approval gateways, system architectures (stages flow left-to-right; wide section rows wrap cleanly so the board fits a widescreen monitor).
- \`"down"\` — Org charts, work breakdown structures (WBS), decision trees, top-down hierarchies.
- \`"lanes"\` — Retrospectives, option trade-off matrices, RACI / swimlane columns, phase comparisons (sections stand side-by-side at equal height).
- \`"grid"\` — Brainstorming clusters, risk registers, stakeholder maps, feature cards.
- \`"manual"\` — Exact \`x, y, w, h\` coordinates when building custom spatial canvases or layered annotations.

## 2. Segment Every Board with Sections
- Always group related steps or cards into \`kind: "section"\` containers (\`{id: "s1", kind: "section", text: "1. Intake & Gateways", color: "blue"}\`).
- Put \`section: "s1"\` on every block inside that section and omit \`x, y, w, h\` when using \`layout\`: the engine sizes every shape to fit its text (including wider inner bounds for diamonds and cylinders), leaves 64px header clearance under the section title, and wraps the section around its children.

## 3. Shape Vocabulary & Semantic Colours
- \`section\` — Stage, phase, lane, or group container.
- \`rect\` — Process step, task, action item (include owner & date when planning).
- \`diamond\` — Decision / gateway question (keep label concise, e.g. \`"Bid / No-Bid Approved?"\`, and label outgoing arrows \`"Yes"\` / \`"No"\`).
- \`cylinder\` — Database, register, CDE, data store.
- \`document\` — Deliverable, report, ITT, specification, contract.
- \`queue\` — Review queue, checklist, backlog, buffer.
- \`cloud\` — Option, hypothesis, external system, risk/opportunity callout.
- \`sticky\` — Brainstorm note, workshop comment, retro observation.
- \`ellipse\` — Start / finish terminal, milestone, external actor.
- \`text\` — Board headline banner (leave outside sections with no arrows).
- \`image\` — Visual card with \`url\` (from \`evolve_infographics\` or \`mcp__evolve__search_project_datasheets\`), \`artifactId\` (\`generate_image\`), \`path\`, or \`asset\`, plus \`text\` caption.
- Colours: \`blue\` (data/context), \`green\` (delivery/approved), \`orange\` (decisions/risks), \`purple\` (review/options), \`yellow\` (notes/highlights), \`pink\` (escalations), \`grey\` (inputs/documents), \`ink\` (headers/connectors).

## 4. Connectors & Labels
- Join blocks by id: \`{id: "a1", kind: "arrow", from: {item: "step1"}, to: {item: "gate1"}, text: "Submit", color: "ink"}\`.
- Keep arrow \`text\` short (1–3 words: \`"Approved"\`, \`"Revise"\`, \`" Escalate"\`). Orthogonal multi-port routing automatically separates parallel lines and places label pills without overlapping shapes or other labels.

## 5. Surgical Updates & Coordinate Accuracy
- Never recreate a board to edit part of it. First call \`save_whiteboard({whiteboardId})\` to read \`version\`, \`items\`, and \`layoutSummary\`.
- Apply \`ops\` with \`baseVersion\`: \`{op: "add", item}\`, \`{op: "update", id, patch}\` (can update \`text\`, \`color\`, \`section\`, \`x\`, \`y\`, \`w\`, \`h\`, \`from\`, \`to\`), or \`{op: "remove", id}\` (removing a block automatically removes dangling arrows).
- Always inspect \`layoutSummary\` (\`overlaps\`, \`headerClashes\`, \`outsideSection\`, \`textClipping\`, \`arrowCrossings\`, \`labelClashes\`). Keep an overlap only if intentionally layering a callout; otherwise fix via \`ops\` or pass \`layout\` alongside \`ops\` to re-tidy cleanly.`;

async function saveWhiteboard(ctx: RunContext, call: ToolCall) {
  const { deps, run, bot, thread } = ctx;
  const { args } = call;
  if (args.help === true) {
    return { guide: WHITEBOARD_GUIDE };
  }
  const whiteboardId = argumentGiven(args.whiteboardId)
    ? String(args.whiteboardId)
    : argumentGiven(args.pageId)
      ? String(args.pageId)
      : undefined;
  const hasItems = Array.isArray(args.items);
  const hasOps = Array.isArray(args.ops) ? args.ops.length > 0 : argumentGiven(args.ops);
  if (hasItems && hasOps)
    return { error: "Send items for a new board, or ops to change one, not both." };

  let title: string | undefined;
  if (argumentGiven(args.title)) {
    const parsed = PageTitleSchema.safeParse(args.title);
    if (!parsed.success) return { error: "title must be 1 to 200 characters." };
    title = redactSecrets(parsed.data, ctx.secrets).slice(0, PAGE_TITLE_MAX_LENGTH);
  }

  // A whiteboard belongs to the person (like an app), not a single agent, so boards created in the
  // sidebar studio with botId null or opened alongside any assistant can be read and updated.
  const reachable = thread.groupId
    ? [{ groupId: null }, { groupId: thread.groupId }]
    : [{ groupId: null }];
  const page = whiteboardId
    ? await deps.prisma.page.findFirst({
        where: { id: whiteboardId, spaceId: run.spaceId, userId: run.userId, OR: reachable },
        select: {
          id: true,
          kind: true,
          title: true,
          currentVersion: true,
          versions: { orderBy: { version: "desc" }, take: 1, select: { source: true } },
        },
      })
    : null;
  if (whiteboardId && !page) {
    return { error: "No whiteboard with that id belongs to you in this space." };
  }
  if (page && page.kind !== "whiteboard") {
    return { error: "That id is not a whiteboard." };
  }

  const layoutChoice = parseLayoutArg(args.layout);
  if (argumentGiven(args.layout) && layoutChoice === null) {
    return { error: 'layout must be "right", "down", "lanes", "grid" or "manual".' };
  }

  const current = readBoardItems(page?.versions[0]?.source ?? "");
  const tidyOnly = Boolean(
    page && layoutChoice && layoutChoice !== "manual" && !hasItems && !hasOps,
  );
  if (page && !hasItems && !hasOps && !title && !tidyOnly) {
    ctx.state.tainted = true;
    return {
      whiteboardId: page.id,
      pageId: page.id,
      version: page.currentVersion,
      title: page.title,
      items: boardForModel(current),
      layoutSummary: inspectBoardLayout(current),
    };
  }
  if (!page && hasOps) return { error: "ops need the whiteboardId of the board to change." };
  if (!page && !title) return { error: "A new whiteboard needs a title." };

  let items = current;
  const pendingPictures = new Map<string, PendingPicture>();
  if (hasItems) {
    const rawList = Array.isArray(args.items) ? args.items : [];
    const preparedList: unknown[] = [];
    for (const raw of rawList) {
      const prepared = await prepareItemInput(ctx, call, raw, pendingPictures);
      if (!prepared.ok) {
        return { error: prepared.error, unchanged: true };
      }
      preparedList.push(prepared.value);
    }
    const parsed = parseItems(preparedList);
    if (typeof parsed === "string") return { error: parsed, unchanged: true };
    const boxedRaw = rawList.filter(
      (raw) =>
        raw &&
        typeof raw === "object" &&
        (raw as { kind?: unknown }).kind !== "arrow" &&
        (raw as { kind?: unknown }).kind !== "pen",
    );
    const allOmittedCoords =
      boxedRaw.length > 0 &&
      boxedRaw.every(
        (raw) =>
          typeof (raw as { x?: unknown }).x !== "number" ||
          typeof (raw as { y?: unknown }).y !== "number",
      );
    // Preserve explicit coordinates accurately unless layout was requested or all coordinates were omitted.
    const shouldAutoLayout =
      layoutChoice !== "manual" && (layoutChoice !== null || allOmittedCoords);
    items = shouldAutoLayout
      ? layoutBoardItems(parsed, layoutChoice ?? "right")
      : settleBoardSections(parsed);
  }
  if (hasOps || tidyOnly) {
    const base = typeof args.baseVersion === "number" ? args.baseVersion : null;
    if (base === null)
      return { error: "ops and layout changes need baseVersion from the last read or save." };
    if (page && base !== page.currentVersion) {
      ctx.state.tainted = true;
      return {
        error:
          "The whiteboard changed since that version. Apply your changes to this board and retry.",
        unchanged: true,
        whiteboardId: page.id,
        version: page.currentVersion,
        title: page.title,
        items: boardForModel(current),
        layoutSummary: inspectBoardLayout(current),
      };
    }
    if (hasOps) {
      const preparedOps = await prepareOpsInput(
        ctx,
        call,
        Array.isArray(args.ops) ? args.ops : [],
        pendingPictures,
      );
      if ("error" in preparedOps) return { error: preparedOps.error, unchanged: true };
      const ops = parseOps(preparedOps, current);
      if (typeof ops === "string") return { error: ops, unchanged: true };
      const applied = applyBoardOps(current, ops);
      if (!applied.ok) return { error: applied.error, unchanged: true };
      items = applied.items;
    }
    if (layoutChoice && layoutChoice !== "manual") {
      items = layoutBoardItems(items, layoutChoice);
    } else if (hasOps) {
      items = settleBoardSections(items);
    }
  }

  // When updating an existing board with new pictures, store them before writing the next version.
  if (page && pendingPictures.size > 0) {
    try {
      const resolved = new Map<string, string>();
      for (const [token, pic] of pendingPictures) {
        const stored = await addAppAsset(deps.prisma, page.id, pic);
        resolved.set(token, stored.id);
      }
      items = items.map((item) =>
        item.asset && resolved.has(item.asset)
          ? { ...item, asset: resolved.get(item.asset) }
          : item,
      );
      pendingPictures.clear();
    } catch (error) {
      if (isAppDataError(error)) {
        return { error: error instanceof Error ? error.message : "Refused", unchanged: true };
      }
      throw error;
    }
  }

  const source = boardSource(items);
  if (pageSourceBytes(source) > PAGE_SOURCE_MAX_BYTES) {
    return { error: "That board is too large. Remove some items and save again.", unchanged: true };
  }
  if (
    containsSecret([source, title ?? ""], ctx.secrets) ||
    containsEncodedSecret([source], ctx.secrets)
  ) {
    return {
      error: "The whiteboard contains a secret value; nothing was saved. Remove it and save again.",
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
            kind: "whiteboard",
            versions: {
              create: {
                version: 1,
                title: title!,
                source,
                code: source,
                runId: ctx.runId,
                via: "assistant",
              },
            },
          },
        });
        return { pageId: created.id, version: 1, title: created.title };
      }
      const version = page.currentVersion + 1;
      const moved = await tx.page.updateMany({
        where: { id: page.id, currentVersion: page.currentVersion },
        data: { currentVersion: version, title, updatedAt: new Date() },
      });
      if (moved.count === 0) throw new BoardChangedError();
      let nextTitle =
        title ??
        (await tx.page.findUniqueOrThrow({ where: { id: page.id }, select: { title: true } }))
          .title;
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
          code: source,
          runId: ctx.runId,
          via: "assistant",
        },
      });
      return { pageId: page.id, version, title: nextTitle };
    });
  } catch (error) {
    if (error instanceof BoardChangedError || isUniqueViolation(error)) {
      return {
        error: "The whiteboard changed while saving; read it again and retry.",
        unchanged: true,
      };
    }
    throw error;
  }

  // If a brand-new whiteboard included inline pictures (infographics, project photos, attachments),
  // store them now that the page exists and update version 1 with their permanent asset ids.
  if (pendingPictures.size > 0) {
    try {
      const resolved = new Map<string, string>();
      for (const [token, pic] of pendingPictures) {
        const stored = await addAppAsset(deps.prisma, saved.pageId, pic);
        resolved.set(token, stored.id);
      }
      items = items.map((item) =>
        item.asset && resolved.has(item.asset)
          ? { ...item, asset: resolved.get(item.asset) }
          : item,
      );
      const updatedSource = boardSource(items);
      await deps.prisma.pageVersion.update({
        where: { pageId_version: { pageId: saved.pageId, version: saved.version } },
        data: { source: updatedSource, code: updatedSource },
      });
    } catch (error) {
      if (isAppDataError(error)) {
        return { error: error instanceof Error ? error.message : "Refused", unchanged: true };
      }
      throw error;
    }
  }

  const linkText = saved.title.replace(/[\\[\]]/g, "\\$&");
  const mention = `Mention it in your reply as [${linkText}](page:${saved.pageId})`;
  if (!page) {
    const block: MessageBlock = { kind: "page", ...saved };
    try {
      await publishMessage(deps, run, "bot", [block]);
    } catch (error) {
      return {
        ...saved,
        whiteboardId: saved.pageId,
        items: boardForModel(items),
        error: `The whiteboard was saved, but its card could not be posted in the chat (${
          error instanceof Error ? error.message : "unknown error"
        }). Link it in your reply as [${linkText}](page:${saved.pageId}).`,
      };
    }
  }
  return {
    whiteboardId: saved.pageId,
    pageId: saved.pageId,
    version: saved.version,
    title: saved.title,
    items: boardForModel(items),
    layoutSummary: inspectBoardLayout(items),
    mention,
  };
}

export const whiteboardTools: ToolHandlers = {
  async save_whiteboard(ctx, call) {
    return call.finish(await saveWhiteboard(ctx, call));
  },
};
