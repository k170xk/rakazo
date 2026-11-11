import { ORPCError } from "@orpc/server";
import type { ArtifactStore } from "@rakazo/adapter-kit";
import { createAdapterContext } from "@rakazo/adapter-kit";
import {
  companyTools,
  listStoredItems,
  personUsage,
  readStoredItem,
  storedFileView,
} from "@rakazo/adapters";
import type { Auth } from "@rakazo/auth";
import type { Actor, MyStorageItem, MyStorageState, StorageItemRef } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { IsolationError, Prisma, runAsSystem, runAsTenant } from "@rakazo/db";
import type { Hono } from "hono";
import { zipStream } from "./account-export.js";
import { deleteArtifactFamily } from "./artifacts.js";
import type { OwnedBot, StoredFilesDeps } from "./stored-files.js";
import { botPins, deleteStoredFile, located, pinStoredFile } from "./stored-files.js";

export const STORAGE_DOWNLOAD_PATH = "/api/storage/download";

const DAY_MS = 86_400_000;
/** Most chat files listed at once, largest first. */
const MAX_CHAT_FAMILIES = 1000;

type Deps = StoredFilesDeps & { artifacts: ArtifactStore };

type NamedBot = OwnedBot & { name: string; archivedAt: Date | null };

/** Every bot the person owns in any of their spaces, archived ones too, since their files still count. */
async function ownedBots(prisma: PrismaClient, userId: string): Promise<NamedBot[]> {
  return runAsSystem("list a person's bots for their storage", () =>
    prisma.bot.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        userId: true,
        archivedAt: true,
        computer: { select: { id: true, scope: true, homeKey: true, homeBytesAt: true } },
      },
      orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    }),
  );
}

async function ownedBot(prisma: PrismaClient, userId: string, botId: string) {
  const bot = (await ownedBots(prisma, userId)).find((candidate) => candidate.id === botId);
  if (!bot) throw new ORPCError("NOT_FOUND", { message: "That file is no longer there." });
  return bot;
}

type ChatFamily = {
  family: string;
  spaceId: string;
  name: string;
  botId: string | null;
  size: bigint;
  createdAt: Date;
};

/** Files bots attached in the person's chats, one row per file with its versions together. */
async function chatFamilies(prisma: PrismaClient, userId: string, familyIds?: readonly string[]) {
  return runAsSystem("list a person's chat attachments", () =>
    prisma.$queryRaw<ChatFamily[]>(Prisma.sql`
      SELECT COALESCE("rootArtifactId", id) AS family,
        (array_agg("spaceId"))[1] AS "spaceId",
        (array_agg(name ORDER BY version DESC))[1] AS name,
        (array_agg("botId" ORDER BY version DESC))[1] AS "botId",
        sum(size)::bigint AS size,
        max("createdAt") AS "createdAt"
      FROM "artifacts"
      WHERE "userId" = ${userId}
      ${familyIds ? Prisma.sql`AND COALESCE("rootArtifactId", id) IN (${Prisma.join(familyIds)})` : Prisma.empty}
      GROUP BY 1
      HAVING bool_and("runId" IS NOT NULL)
      ORDER BY 5 DESC
      LIMIT ${MAX_CHAT_FAMILIES}
    `),
  );
}

/** Computers several bots share are listed once, under the first bot using each folder. */
async function computerItems(deps: Deps, bots: readonly NamedBot[]) {
  const retentionDays = companyTools().fileRetentionDays;
  const seen = new Set<string>();
  const items: MyStorageItem[] = [];
  for (const bot of bots) {
    const where = await located(deps, bot).catch(() => null);
    if (!where) continue;
    const key = `${where.home}\0${where.folder}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [stored, pins] = await Promise.all([
      listStoredItems(where.home, where.folder),
      botPins(deps, bot.id),
    ]);
    for (const item of stored) {
      const view = storedFileView(item, pins, retentionDays);
      items.push({
        ref: { kind: "computer", botId: bot.id, path: item.path },
        name: item.path,
        botName: bot.name,
        kind: item.kind,
        size: item.size,
        modifiedAt: view.modifiedAt,
        pinnable: true,
        pinned: view.pinned,
        deletesAt: view.deletesAt,
      });
    }
  }
  return items;
}

export async function myStorageState(deps: Deps, actor: Actor): Promise<MyStorageState> {
  const chatDays = companyTools().chatFileRetentionDays;
  const bots = await ownedBots(deps.prisma, actor.userId);
  const names = new Map(bots.map((bot) => [bot.id, bot.name]));
  const [computer, families, usage] = await Promise.all([
    computerItems(deps, bots),
    chatFamilies(deps.prisma, actor.userId),
    personUsage(deps.prisma, actor.userId),
  ]);
  const chats = families.map(
    (family): MyStorageItem => ({
      ref: { kind: "chat", artifactId: family.family },
      name: family.name,
      botName: family.botId ? (names.get(family.botId) ?? null) : null,
      kind: "file",
      size: Number(family.size),
      modifiedAt: family.createdAt.toISOString(),
      pinnable: false,
      pinned: false,
      deletesAt:
        chatDays === null
          ? null
          : new Date(family.createdAt.getTime() + chatDays * DAY_MS).toISOString(),
    }),
  );
  return {
    ...usage,
    computerRetentionDays: companyTools().fileRetentionDays,
    chatRetentionDays: chatDays,
    items: [...computer, ...chats].sort((a, b) => b.size - a.size),
  };
}

/** Deletes each chosen item the caller owns; anything else is refused before anything is deleted. */
export async function deleteMyStorage(
  deps: Deps,
  actor: Actor,
  items: readonly StorageItemRef[],
): Promise<MyStorageState> {
  const bots = new Map((await ownedBots(deps.prisma, actor.userId)).map((bot) => [bot.id, bot]));
  const chatIds = items.flatMap((item) => (item.kind === "chat" ? [item.artifactId] : []));
  const families = new Map(
    (chatIds.length ? await chatFamilies(deps.prisma, actor.userId, chatIds) : []).map((row) => [
      row.family,
      row,
    ]),
  );
  for (const item of items) {
    const owned = item.kind === "computer" ? bots.has(item.botId) : families.has(item.artifactId);
    if (!owned) throw new ORPCError("NOT_FOUND", { message: "That file is no longer there." });
  }
  for (const item of items) {
    if (item.kind === "computer") {
      await deleteStoredFile(deps, bots.get(item.botId)!, item.path).catch((error: unknown) => {
        if (!(error instanceof ORPCError && error.code === "NOT_FOUND")) throw error;
      });
      continue;
    }
    const family = families.get(item.artifactId)!;
    const tenant = { ...actor, spaceId: family.spaceId };
    await runAsTenant(tenant, () =>
      deleteArtifactFamily(deps, tenant, { familyId: family.family }),
    ).catch((error: unknown) => {
      if (!(error instanceof IsolationError)) throw error;
    });
  }
  return myStorageState(deps, actor);
}

export async function pinMyStorage(
  deps: Deps,
  actor: Actor,
  input: { botId: string; path: string; pinned: boolean },
): Promise<MyStorageState> {
  const bot = await ownedBot(deps.prisma, actor.userId, input.botId);
  await pinStoredFile(deps, bot, input.path, input.pinned);
  return myStorageState(deps, actor);
}

export async function myStorageDownloadUrl(
  deps: Deps & { auth: Pick<Auth, "issueStorageDownloadToken"> },
  actor: Actor,
  items: readonly StorageItemRef[],
) {
  const token = await deps.auth.issueStorageDownloadToken({
    userId: actor.userId,
    items: [...items],
  });
  return { url: `${STORAGE_DOWNLOAD_PATH}?token=${encodeURIComponent(token)}` };
}

function safeSegment(value: string) {
  return value.replace(/[\\/:*?"<>|\r\n]/g, "_").trim() || "file";
}

/** `report.docx`, then `report (2).docx`, so two items never overwrite each other in the zip. */
function uniquePath(used: Set<string>, wanted: string) {
  let candidate = wanted;
  const dot = wanted.lastIndexOf(".");
  const [stem, ext] =
    dot > wanted.lastIndexOf("/") + 1 ? [wanted.slice(0, dot), wanted.slice(dot)] : [wanted, ""];
  for (let n = 2; used.has(candidate); n += 1) candidate = `${stem} (${n})${ext}`;
  used.add(candidate);
  return candidate;
}

/** Each chosen item the person still owns, in the order chosen; the rest are skipped. */
async function* archiveFiles(deps: Deps, userId: string, items: readonly StorageItemRef[]) {
  const bots = new Map((await ownedBots(deps.prisma, userId)).map((bot) => [bot.id, bot]));
  const chatIds = items.flatMap((item) => (item.kind === "chat" ? [item.artifactId] : []));
  const families = new Map(
    (chatIds.length ? await chatFamilies(deps.prisma, userId, chatIds) : []).map((row) => [
      row.family,
      row,
    ]),
  );
  const used = new Set<string>();
  for (const item of items) {
    if (item.kind === "computer") {
      const bot = bots.get(item.botId);
      const where = bot ? await located(deps, bot).catch(() => null) : null;
      if (!bot || !where) continue;
      const files = readStoredItem(where.home, where.folder, item.path);
      for (;;) {
        const next = await files.next().catch(() => null);
        if (!next || next.done) break;
        yield {
          path: uniquePath(used, `${safeSegment(bot.name)}/${next.value.path}`),
          data: next.value.data,
        };
      }
      continue;
    }
    const family = families.get(item.artifactId);
    if (!family) continue;
    const tenant = { spaceId: family.spaceId, userId };
    const bytes = await runAsTenant(tenant, async () => {
      const row = await deps.prisma.artifact.findFirst({
        where: {
          userId,
          OR: [{ id: family.family }, { rootArtifactId: family.family }],
        },
        orderBy: { version: "desc" },
      });
      if (!row) return null;
      return deps.artifacts.get(
        row.storageKey,
        createAdapterContext(tenant, row.botId ?? row.id, `storage-download:${row.id}`),
      );
    }).catch(() => null);
    if (!bytes) continue;
    const folder = family.botId ? (bots.get(family.botId)?.name ?? "Chat files") : "Chat files";
    yield {
      path: uniquePath(used, `Chat files/${safeSegment(folder)}/${safeSegment(family.name)}`),
      data: [Uint8Array.from(bytes)],
    };
  }
}

/**
 * `GET /api/storage/download?token=`: a plain navigation, so the browser saves the zip itself.
 * The one-time token from `computer.myStorageDownload` is the only credential, and every item is
 * checked again as the token holder's when the zip is built.
 */
export function mountStorageDownloadRoute(
  app: Hono,
  deps: Deps & { auth: Pick<Auth, "consumeStorageDownloadToken"> },
): void {
  app.get(STORAGE_DOWNLOAD_PATH, async (c) => {
    const grant = await deps.auth.consumeStorageDownloadToken(c.req.query("token") ?? "");
    if (!grant) return c.text("Download link expired", 410, { "cache-control": "no-store" });
    const day = new Date().toISOString().slice(0, 10);
    return new Response(zipStream(archiveFiles(deps, grant.userId, grant.items)), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="rakazo-files-${day}.zip"`,
        "cache-control": "no-store",
      },
    });
  });
}
