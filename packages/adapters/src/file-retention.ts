import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rm, statfs } from "node:fs/promises";
import path from "node:path";
import type { AgentHomeStore } from "@rakazo/adapter-kit";
import type { StoredFile } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { Prisma, runAsSystem } from "@rakazo/db";
import { companyTools } from "./company-policy.js";
import { teamBotWorkspaceDirectory } from "./computer-support.js";
import { fileHandlePath } from "./file-handle-path.js";
import { isContained, resolveAgentHomePath } from "./home.js";

/** Folders whose children are listed and cleaned one by one instead of as a single item. */
export const OUTPUT_FOLDERS: readonly string[] = ["outputs", "work"];
const CONVERSATIONS = "conversations";
const DAY_MS = 86_400_000;
const MAX_ITEMS = 2000;
/** A measured size counts as current this long before an OCSC command measures again. */
const MEASURE_FRESH_MS = 10 * 60_000;
/** Below this share of free disk, nobody's bot starts new OCSC work. */
const MIN_FREE_DISK_SHARE = 0.05;

export interface StoredItem {
  path: string;
  kind: "file" | "dir";
  size: number;
  files: number;
  modifiedMs: number;
}

interface Tree {
  size: number;
  files: number;
  newestMs: number;
}

/** Size and newest change of a tree, never following links, which may point anywhere on the host. */
export async function measureTree(full: string): Promise<Tree> {
  const info = await lstat(full).catch(() => null);
  if (!info) return { size: 0, files: 0, newestMs: 0 };
  if (!info.isDirectory()) {
    return { size: info.isFile() ? info.size : 0, files: 1, newestMs: changedMs(info) };
  }
  const tree: Tree = { size: 0, files: 0, newestMs: changedMs(info) };
  const pending = [full];
  while (pending.length > 0) {
    const dir = pending.pop()!;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      const stat = await lstat(child).catch(() => null);
      if (!stat) continue;
      tree.newestMs = Math.max(tree.newestMs, changedMs(stat));
      if (stat.isDirectory()) pending.push(child);
      else {
        tree.files += 1;
        if (stat.isFile()) tree.size += stat.size;
      }
    }
  }
  return tree;
}

/** ctime too, since unzip and copies can set an old mtime on a file made just now. */
function changedMs(info: { mtimeMs: number; ctimeMs: number }) {
  return Math.max(info.mtimeMs, info.ctimeMs);
}

/**
 * Opens `relative` under `root` one real directory at a time, refusing links, and keeps it open.
 * On Linux `path` goes through the open handle, so a folder later swapped for a link (the home's
 * owner controls everything in it) cannot redirect what is read or moved to another home.
 */
export async function pinnedDirectory(
  root: string,
  relative: string,
  options: { create?: boolean } = {},
) {
  const handles: Awaited<ReturnType<typeof open>>[] = [];
  const close = async () => {
    await Promise.all(handles.map((handle) => handle.close().catch(() => undefined)));
  };
  const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  try {
    const realRoot = await realpath(root);
    let current = await open(root, flags);
    handles.push(current);
    for (const segment of relative.split("/").filter((part) => part && part !== ".")) {
      if (segment === "..") throw new Error("Path leaves the home");
      const next = path.join(await handlePath(current.fd), segment);
      if (options.create) {
        await mkdir(next).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        });
      }
      current = await open(next, flags);
      handles.push(current);
    }
    if (!isContained(realRoot, await fileHandlePath(current.fd)))
      throw new Error("Path leaves the home");
    return { path: await handlePath(current.fd), close };
  } catch {
    await close();
    return null;
  }
}

async function handlePath(fd: number) {
  return process.platform === "linux" ? `/proc/self/fd/${fd}` : fileHandlePath(fd);
}

async function withPinned<T>(root: string, relative: string, use: (dir: string) => Promise<T>) {
  const pinned = await pinnedDirectory(root, relative);
  if (!pinned) return null;
  try {
    return await use(pinned.path);
  } finally {
    await pinned.close();
  }
}

/** Server-only folder beside the homes, which no computer mounts, for items on their way out. */
function trashFolder(home: string) {
  return path.resolve(home, "..", "..", "file-trash");
}

/**
 * Moves one entry out of the home in a single rename, then deletes it where its former owner can
 * no longer reach it. A link is moved as a link and never followed.
 */
async function removeEntry(home: string, parent: string, name: string, trash = trashFolder(home)) {
  await mkdir(trash, { recursive: true, mode: 0o700 });
  const moved = path.join(trash, randomUUID());
  const done = await withPinned(home, parent, async (dir) => {
    await rename(path.join(dir, name), moved);
    return true;
  });
  if (!done) throw new Error("That is not an item in this bot's folder.");
  await rm(moved, { recursive: true, force: true });
}

const visible = (name: string) => !name.startsWith(".");

/**
 * What a bot made, as the Files tab shows it and cleanup deletes it: each top-level file or
 * folder in its folder, except `outputs` and `work`, whose children count separately. Hidden
 * entries are settings, never listed or deleted.
 */
export async function listStoredItems(home: string, botFolder: string): Promise<StoredItem[]> {
  const items = await withPinned(home, botFolder, async (root) => {
    const found: StoredItem[] = [];
    const add = async (dir: string, name: string, relative: string) => {
      const full = path.join(dir, name);
      const info = await lstat(full).catch(() => null);
      if (!info) return;
      const tree = await measureTree(full);
      found.push({
        path: relative,
        kind: info.isDirectory() ? "dir" : "file",
        size: tree.size,
        files: tree.files,
        modifiedMs: tree.newestMs,
      });
    };
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!visible(entry.name) || found.length >= MAX_ITEMS) continue;
      if (entry.isDirectory() && OUTPUT_FOLDERS.includes(entry.name)) {
        await withPinned(root, entry.name, async (inner) => {
          for (const child of await readdir(inner, { withFileTypes: true }).catch(() => [])) {
            if (visible(child.name) && found.length < MAX_ITEMS) {
              await add(inner, child.name, `${entry.name}/${child.name}`);
            }
          }
        });
      } else {
        await add(root, entry.name, entry.name);
      }
    }
    return found;
  });
  return (items ?? []).sort((a, b) => b.modifiedMs - a.modifiedMs);
}

/** A pin keeps the item it names, the item holding it, and every item inside it. */
export function isPinned(itemPath: string, pins: readonly string[]) {
  return pins.some(
    (pin) => pin === itemPath || pin.startsWith(`${itemPath}/`) || itemPath.startsWith(`${pin}/`),
  );
}

export function expiredItems(
  items: readonly StoredItem[],
  pins: readonly string[],
  retentionDays: number,
  now: number,
) {
  const cutoff = now - retentionDays * DAY_MS;
  return items.filter((item) => item.modifiedMs < cutoff && !isPinned(item.path, pins));
}

function storedItemSegments(itemPath: string) {
  const segments = itemPath.split("/");
  const shapeOk =
    segments.every(
      (segment) => segment !== "" && segment !== "." && segment !== ".." && visible(segment),
    ) &&
    (segments.length === 1 || (segments.length === 2 && OUTPUT_FOLDERS.includes(segments[0]!)));
  if (!shapeOk) throw new Error("That is not an item in this bot's folder.");
  return segments;
}

/** Deletes one listed item; anything not exactly a listed item, or reached through a link, is refused. */
export async function removeStoredItem(home: string, botFolder: string, itemPath: string) {
  const segments = storedItemSegments(itemPath);
  await removeEntry(
    home,
    path.posix.join(botFolder, ...segments.slice(0, -1)),
    segments[segments.length - 1]!,
  );
}

/** Opens one listed file for reading through its pinned folder, refusing a link. */
export async function openStoredFile(home: string, botFolder: string, itemPath: string) {
  const segments = itemPath.split("/");
  const pinned = await pinnedDirectory(home, path.posix.join(botFolder, ...segments.slice(0, -1)));
  if (!pinned) throw new Error("That is not an item in this bot's folder.");
  try {
    return await open(
      path.join(pinned.path, segments[segments.length - 1]!),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
  } finally {
    await pinned.close();
  }
}

const MAX_ITEM_FILES = 5000;

async function* fileChunks(handle: Awaited<ReturnType<typeof open>>) {
  try {
    for await (const chunk of handle.createReadStream()) yield chunk as Uint8Array;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * Every file in one listed item, for a download: the file itself, or each file inside the
 * folder. Each folder is opened one real directory at a time and links are skipped, so nothing
 * outside the bot's folder is read.
 */
export async function* readStoredItem(
  home: string,
  botFolder: string,
  itemPath: string,
): AsyncGenerator<{ path: string; data: AsyncIterable<Uint8Array> }> {
  const base = path.posix.join(botFolder, ...storedItemSegments(itemPath));
  const top = await pinnedDirectory(home, base);
  if (!top) {
    yield { path: itemPath, data: fileChunks(await openStoredFile(home, botFolder, itemPath)) };
    return;
  }
  await top.close();
  const pending = [""];
  let count = 0;
  while (pending.length > 0 && count < MAX_ITEM_FILES) {
    const relative = pending.pop()!;
    const dir = await pinnedDirectory(home, path.posix.join(base, relative));
    if (!dir) continue;
    try {
      for (const entry of await readdir(dir.path, { withFileTypes: true }).catch(() => [])) {
        const child = path.posix.join(relative, entry.name);
        if (entry.isDirectory()) pending.push(child);
        if (!entry.isFile() || count >= MAX_ITEM_FILES) continue;
        const handle = await open(
          path.join(dir.path, entry.name),
          constants.O_RDONLY | constants.O_NOFOLLOW,
        ).catch(() => null);
        if (!handle) continue;
        count += 1;
        yield { path: path.posix.join(itemPath, child), data: fileChunks(handle) };
      }
    } finally {
      await dir.close();
    }
  }
}

export function storedFileView(
  item: StoredItem,
  pins: readonly string[],
  retentionDays: number,
): StoredFile {
  const pinned = isPinned(item.path, pins);
  return {
    path: item.path,
    kind: item.kind,
    size: item.size,
    files: item.files,
    modifiedAt: new Date(item.modifiedMs).toISOString(),
    pinned,
    deletesAt: pinned ? null : new Date(item.modifiedMs + retentionDays * DAY_MS).toISOString(),
  };
}

/** Where a bot's own files sit inside its computer's home. */
export function botFolderInHome(scope: string, botId: string) {
  return scope === "team" ? teamBotWorkspaceDirectory(botId) : "";
}

/**
 * Homes are swept straight on this server's disk only while they live here; homes kept in object
 * storage are copies that a later save would overwrite.
 */
export function localHomePath(
  home: AgentHomeStore,
  homeKey: string,
  dataDir: string | undefined,
): string | null {
  if (home.describe().id !== "local-fs") return null;
  return resolveAgentHomePath(home, homeKey, dataDir);
}

/**
 * The runners' copy of a home for someone whose computer keeps its own copy of it, laid out like
 * the home and never mounted by a computer, so a computer saving its home cannot wipe documents.
 */
export function documentHomePath(dataDir: string, homeKey: string): string | null {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(homeKey)) return null;
  return path.join(path.resolve(dataDir), "tool-work", "documents", homeKey);
}

/**
 * Where the runners, the Files tab, storage limits and cleanup find a person's bot files on this
 * server: their home, or its document home when the runners must not share the home
 * (`toolRunnersShareHome`).
 */
export function runnerHomePath(input: {
  home: AgentHomeStore;
  dataDir: string | undefined;
  homeKey: string;
  sharesHome: boolean;
}): string | null {
  // Tools-only / computers-off still need a folder the runners can mount. Prefer the on-disk
  // home when it is shared; fall back to the document home so Word/PowerPoint keep working when
  // the home lives elsewhere (object storage) or the computer keeps its own copy.
  if (input.sharesHome) {
    return (
      localHomePath(input.home, input.homeKey, input.dataDir) ??
      (input.dataDir ? documentHomePath(input.dataDir, input.homeKey) : null)
    );
  }
  return input.dataDir ? documentHomePath(input.dataDir, input.homeKey) : null;
}

/** Every folder on this server holding a person's bot files, which together count to their storage. */
export function storedHomePaths(input: Parameters<typeof runnerHomePath>[0]): string[] {
  const paths = [runnerHomePath(input)];
  if (!input.sharesHome) paths.push(localHomePath(input.home, input.homeKey, input.dataDir));
  return paths.filter((home): home is string => home !== null);
}

export interface HomeSweep {
  deletedItems: number;
  freedBytes: number;
  homeBytes: number;
}

/**
 * Deletes every unpinned item older than the retention in each bot folder, and colleague
 * conversation folders nobody touched for as long, then measures the whole home.
 */
export async function sweepHome(input: {
  home: string;
  scope: string;
  /** The bots whose folders are in this home, each with its pins. */
  bots: ReadonlyMap<string, readonly string[]>;
  retentionDays: number;
  now: number;
  /**
   * With tool runners on, colleague conversations live here instead; any still in the home
   * move out, so the home's owner can no longer reach them from their computer.
   */
  conversationsTo?: string;
}): Promise<HomeSweep> {
  const result: HomeSweep = { deletedItems: 0, freedBytes: 0, homeBytes: 0 };
  const folders: [string, readonly string[]][] =
    input.scope === "team"
      ? await teamBotFolders(input.home, input.bots)
      : [...input.bots.values()].slice(0, 1).map((pins) => ["", pins]);
  for (const [folder, pins] of folders) {
    const items = await listStoredItems(input.home, folder);
    for (const item of expiredItems(items, pins, input.retentionDays, input.now)) {
      await removeStoredItem(input.home, folder, item.path);
      result.deletedItems += 1;
      result.freedBytes += item.size;
    }
  }
  const cutoff = input.now - input.retentionDays * DAY_MS;
  if (input.conversationsTo) await moveConversationsOut(input.home, input.conversationsTo);
  const stale =
    (await withPinned(input.home, CONVERSATIONS, async (root) => {
      const found: { name: string; size: number }[] = [];
      for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory()) continue;
        const tree = await measureTree(path.join(root, entry.name));
        if (tree.newestMs < cutoff) found.push({ name: entry.name, size: tree.size });
      }
      return found;
    })) ?? [];
  for (const folder of stale) {
    await removeEntry(input.home, CONVERSATIONS, folder.name);
    result.deletedItems += 1;
    result.freedBytes += folder.size;
  }
  result.homeBytes = (await measureTree(input.home)).size;
  return result;
}

/** Moves each conversation folder in a home to `destination`, keeping one already there. */
async function moveConversationsOut(home: string, destination: string) {
  await mkdir(destination, { recursive: true, mode: 0o750 });
  const names =
    (await withPinned(home, CONVERSATIONS, async (root) =>
      (
        await readdir(root, { withFileTypes: true }).catch(() => [])
      )
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    )) ?? [];
  for (const name of names) {
    const target = path.join(destination, name);
    if (await lstat(target).catch(() => null)) {
      await removeEntry(home, CONVERSATIONS, name);
      continue;
    }
    await withPinned(home, CONVERSATIONS, (root) =>
      rename(path.join(root, name), target).catch(() => undefined),
    );
  }
}

/** Deletes colleague conversation folders in the tool runners' folder nobody touched for the retention. */
export async function sweepConversationFolders(input: {
  dataDir: string;
  retentionDays: number;
  now: number;
}) {
  const root = path.resolve(input.dataDir);
  const relative = "tool-work/conversations";
  const cutoff = input.now - input.retentionDays * DAY_MS;
  const result = { deletedItems: 0, freedBytes: 0 };
  const stale =
    (await withPinned(root, relative, async (dir) => {
      const found: { name: string; size: number }[] = [];
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory()) continue;
        const tree = await measureTree(path.join(dir, entry.name));
        if (tree.newestMs < cutoff) found.push({ name: entry.name, size: tree.size });
      }
      return found;
    })) ?? [];
  for (const folder of stale) {
    await removeEntry(root, relative, folder.name, path.join(root, "file-trash"));
    result.deletedItems += 1;
    result.freedBytes += folder.size;
  }
  return result;
}

/** Deletes a deleted chat's colleague conversation folder from the tool runners' folder. */
export async function removeConversationToolWork(dataDir: string, threadId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(threadId)) return;
  const root = path.resolve(dataDir);
  const relative = `tool-work/${CONVERSATIONS}`;
  const present = await withPinned(root, relative, (dir) =>
    lstat(path.join(dir, threadId)).then(
      () => true,
      () => false,
    ),
  );
  if (present) await removeEntry(root, relative, threadId, path.join(root, "file-trash"));
}

/** Every folder under `bots/`, including those of bots deleted since, which have no pins. */
async function teamBotFolders(home: string, bots: ReadonlyMap<string, readonly string[]>) {
  const entries =
    (await withPinned(home, "bots", (dir) =>
      readdir(dir, { withFileTypes: true }).catch(() => []),
    )) ?? [];
  return entries
    .filter((entry) => entry.isDirectory() && visible(entry.name))
    .map((entry): [string, readonly string[]] => [
      teamBotWorkspaceDirectory(entry.name),
      bots.get(entry.name) ?? [],
    ]);
}

export async function pinsForBots(prisma: PrismaClient, botIds: readonly string[]) {
  const rows = await runAsSystem("read pinned files", () =>
    prisma.keptFile.findMany({ where: { botId: { in: [...botIds] } } }),
  );
  const pins = new Map<string, string[]>(botIds.map((id) => [id, []]));
  for (const row of rows) pins.get(row.botId)?.push(row.path);
  return pins;
}

/** Runs cleanup over every computer whose home is on this server's disk. */
export async function sweepComputerFiles(deps: {
  prisma: PrismaClient;
  home: AgentHomeStore;
  dataDir: string | undefined;
  /** Tool runners are on: colleague conversations belong in tool-work, not in homes. */
  toolRunners?: boolean;
  now?: number;
}) {
  const now = deps.now ?? Date.now();
  const retentionDays = companyTools().fileRetentionDays;
  const conversationsTo =
    deps.toolRunners && deps.dataDir
      ? path.resolve(deps.dataDir, "tool-work", CONVERSATIONS)
      : undefined;
  const computers = await runAsSystem("list computers for file cleanup", () =>
    deps.prisma.computer.findMany({
      select: { id: true, scope: true, homeKey: true, bots: { select: { id: true } } },
    }),
  );
  const total: HomeSweep = { deletedItems: 0, freedBytes: 0, homeBytes: 0 };
  for (const computer of computers) {
    const home = localHomePath(deps.home, computer.homeKey, deps.dataDir);
    const documents = deps.dataDir ? documentHomePath(deps.dataDir, computer.homeKey) : null;
    let pins: Map<string, string[]> | undefined;
    let homeBytes = 0;
    let measured = false;
    for (const folder of [home, documents]) {
      if (!folder) continue;
      const reachable = await pinnedDirectory(folder, "");
      if (!reachable) continue;
      await reachable.close();
      pins ??= await pinsForBots(
        deps.prisma,
        computer.bots.map((bot) => bot.id),
      );
      const swept = await sweepHome({
        home: folder,
        scope: computer.scope,
        bots: pins,
        retentionDays,
        now,
        conversationsTo: folder === home ? conversationsTo : undefined,
      });
      total.deletedItems += swept.deletedItems;
      total.freedBytes += swept.freedBytes;
      total.homeBytes += swept.homeBytes;
      homeBytes += swept.homeBytes;
      measured = true;
    }
    if (measured) await recordHomeBytes(deps.prisma, computer.id, homeBytes, now);
  }
  if (conversationsTo && deps.dataDir) {
    const swept = await sweepConversationFolders({ dataDir: deps.dataDir, retentionDays, now });
    total.deletedItems += swept.deletedItems;
    total.freedBytes += swept.freedBytes;
  }
  return total;
}

async function recordHomeBytes(
  prisma: PrismaClient,
  computerId: string,
  bytes: number,
  now: number,
) {
  await runAsSystem("record computer home size", () =>
    prisma.computer.updateMany({
      where: { id: computerId },
      data: { homeBytes: BigInt(bytes), homeBytesAt: new Date(now) },
    }),
  );
}

export async function storageLimitBytes(prisma: PrismaClient, userId: string) {
  const user = await runAsSystem("read storage limit", () =>
    prisma.user.findUnique({ where: { id: userId }, select: { storageLimitMb: true } }),
  );
  const mb = user?.storageLimitMb ?? companyTools().defaultStorageLimitMb;
  return mb * 1024 * 1024;
}

/**
 * Everything one person keeps across their computers, measuring `current` again when its last
 * measurement is stale. Other computers count at their last measured size.
 */
export async function personStorageBytes(
  prisma: PrismaClient,
  userId: string,
  current?: { computerId: string; homes: readonly string[]; measuredAt: Date | null },
  now = Date.now(),
) {
  if (current && (!current.measuredAt || now - current.measuredAt.getTime() > MEASURE_FRESH_MS)) {
    let bytes = 0;
    for (const home of current.homes) bytes += (await measureTree(home)).size;
    await recordHomeBytes(prisma, current.computerId, bytes, now);
  }
  const rows = await runAsSystem("read computer home sizes", () =>
    prisma.computer.findMany({ where: { userId }, select: { homeBytes: true } }),
  );
  return rows.reduce((sum, row) => sum + Number(row.homeBytes ?? 0n), 0);
}

/**
 * Files bots attached in this person's chats, each stored file once however many rows name it.
 * A file counts as the bot's when every version of it is, which is also what chat cleanup deletes.
 */
export async function chatAttachmentBytes(prisma: PrismaClient, userId: string) {
  const rows = await runAsSystem("measure chat attachments", () =>
    prisma.$queryRaw<Array<{ bytes: bigint | null }>>(Prisma.sql`
      SELECT sum(size)::bigint AS bytes FROM (
        SELECT DISTINCT ON ("storageKey") size
        FROM "artifacts"
        WHERE "userId" = ${userId}
          AND COALESCE("rootArtifactId", id) IN (
            SELECT COALESCE("rootArtifactId", id)
            FROM "artifacts"
            WHERE "userId" = ${userId}
            GROUP BY 1
            HAVING bool_and("runId" IS NOT NULL)
          )
      ) stored
    `),
  );
  return Number(rows[0]?.bytes ?? 0n);
}

/** `chatAttachmentBytes` for everyone at once, for the admin's storage list. */
export async function chatAttachmentBytesByPerson(prisma: PrismaClient) {
  return runAsSystem("measure everyone's chat attachments", () =>
    prisma.$queryRaw<Array<{ userId: string; bytes: bigint }>>(Prisma.sql`
      SELECT "userId", sum(size)::bigint AS bytes FROM (
        SELECT DISTINCT ON (a."userId", a."storageKey") a."userId", a.size
        FROM "artifacts" a
        JOIN (
          SELECT COALESCE("rootArtifactId", id) AS family
          FROM "artifacts"
          GROUP BY 1
          HAVING bool_and("runId" IS NOT NULL)
        ) bot_made ON bot_made.family = COALESCE(a."rootArtifactId", a.id)
      ) stored
      GROUP BY "userId"
    `),
  );
}

export interface PersonUsage {
  computerBytes: number;
  chatBytes: number;
  usedBytes: number;
  limitBytes: number;
}

/** What counts against a person's limit: their computers' files and files bots attached in chats. */
export async function personUsage(
  prisma: PrismaClient,
  userId: string,
  current?: Parameters<typeof personStorageBytes>[2],
  now = Date.now(),
): Promise<PersonUsage> {
  const [computerBytes, chatBytes, limitBytes] = await Promise.all([
    personStorageBytes(prisma, userId, current, now),
    chatAttachmentBytes(prisma, userId),
    storageLimitBytes(prisma, userId),
  ]);
  return { computerBytes, chatBytes, usedBytes: computerBytes + chatBytes, limitBytes };
}

/** The disk holding every computer's files, or null where it cannot be read. */
export async function serverDisk(dataDir: string | undefined) {
  const info = await statfs(dataDir ?? "./data").catch(() => null);
  if (!info) return null;
  const totalBytes = info.blocks * info.bsize;
  const freeBytes = info.bavail * info.bsize;
  return { usedBytes: totalBytes - freeBytes, totalBytes, freeBytes };
}

export function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Why new OCSC work cannot start for lack of space, or null when there is room. */
export async function storageRefusal(input: {
  prisma: PrismaClient;
  home: AgentHomeStore;
  dataDir: string | undefined;
  userId: string;
  computer: { id: string; homeKey: string; homeBytesAt: Date | null };
  documentsApart?: boolean;
}): Promise<string | null> {
  const disk = await serverDisk(input.dataDir);
  if (disk && disk.freeBytes < disk.totalBytes * MIN_FREE_DISK_SHARE) {
    return "The company server is nearly out of space, so new documents and videos are paused. Tell an admin.";
  }
  const homes = storedHomePaths({
    home: input.home,
    dataDir: input.dataDir,
    homeKey: input.computer.homeKey,
    sharesHome: !input.documentsApart,
  });
  if (homes.length === 0) return null;
  const usage = await personUsage(input.prisma, input.userId, {
    computerId: input.computer.id,
    homes,
    measuredAt: input.computer.homeBytesAt,
  });
  if (usage.usedBytes < usage.limitBytes) return null;
  return `Your storage is full (${formatBytes(usage.usedBytes)} of ${formatBytes(usage.limitBytes)}, counting files bots attached in chats). Ask the person to open Manage storage from their account menu to download or delete old files, or ask an admin for a higher limit.`;
}
