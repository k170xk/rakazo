import { ORPCError } from "@orpc/server";
import {
  botFolderInHome,
  companyTools,
  computerAccessFor,
  listStoredItems,
  openStoredFile,
  personUsage,
  removeStoredItem,
  runnerHomePath,
  storedFileView,
  storedHomePaths,
  toolRunnersShareHome,
} from "@rakazo/adapters";
import type { StoredFilesState } from "@rakazo/contracts";
import { runAsSystem } from "@rakazo/db";
import type { RouterDeps } from "./router.js";

/** A bot its owner opened through `getBot`, which already refuses anyone else's. */
export interface OwnedBot {
  id: string;
  userId: string;
  computer: { id: string; scope: string; homeKey: string; homeBytesAt: Date | null } | null;
}

export type StoredFilesDeps = Pick<RouterDeps, "prisma" | "home" | "dataDir" | "sandbox">;
type Deps = StoredFilesDeps;

/** The bot's files where its runs keep them: the home, or the document home kept apart from it. */
export async function located(deps: Deps, bot: OwnedBot) {
  const computer = bot.computer;
  if (!computer) return null;
  const where = {
    home: deps.home,
    dataDir: deps.dataDir,
    homeKey: computer.homeKey,
    sharesHome: toolRunnersShareHome(
      await computerAccessFor(deps.prisma, bot.userId),
      deps.sandbox.describe().capabilities.persistentHome !== false,
    ),
  };
  const home = runnerHomePath(where);
  if (!home) return null;
  return {
    computer,
    home,
    homes: storedHomePaths(where),
    folder: botFolderInHome(computer.scope, bot.id),
  };
}

export async function storedFilesState(
  deps: Deps,
  bot: OwnedBot,
  remeasure = false,
): Promise<StoredFilesState> {
  const retentionDays = companyTools().fileRetentionDays;
  const where = await located(deps, bot);
  if (!where) {
    const { usedBytes, limitBytes } = await personUsage(deps.prisma, bot.userId);
    return { available: false, files: [], usedBytes, limitBytes, retentionDays };
  }
  const [items, pins, usage] = await Promise.all([
    listStoredItems(where.home, where.folder),
    botPins(deps, bot.id),
    personUsage(deps.prisma, bot.userId, {
      computerId: where.computer.id,
      homes: where.homes,
      measuredAt: remeasure ? null : where.computer.homeBytesAt,
    }),
  ]);
  return {
    available: true,
    files: items.map((item) => storedFileView(item, pins, retentionDays)),
    usedBytes: usage.usedBytes,
    limitBytes: usage.limitBytes,
    retentionDays,
  };
}

export async function botPins(deps: Deps, botId: string) {
  const rows = await runAsSystem("read pinned files", () =>
    deps.prisma.keptFile.findMany({ where: { botId }, select: { path: true } }),
  );
  return rows.map((row) => row.path);
}

/** Only items the Files tab lists can be pinned or deleted, so a typed path reaches nothing else. */
async function listedItem(deps: Deps, bot: OwnedBot, itemPath: string) {
  const where = await located(deps, bot);
  if (!where)
    throw new ORPCError("CONFLICT", { message: "This bot's files are not on this server." });
  const items = await listStoredItems(where.home, where.folder);
  const item = items.find((candidate) => candidate.path === itemPath);
  if (!item) throw new ORPCError("NOT_FOUND", { message: "That file is no longer there." });
  return { where, item };
}

export async function pinStoredFile(deps: Deps, bot: OwnedBot, itemPath: string, pinned: boolean) {
  if (pinned) {
    await listedItem(deps, bot, itemPath);
    await runAsSystem("pin file", () =>
      deps.prisma.keptFile.upsert({
        where: { botId_path: { botId: bot.id, path: itemPath } },
        create: { botId: bot.id, userId: bot.userId, path: itemPath },
        update: {},
      }),
    );
  } else {
    await runAsSystem("unpin file", () =>
      deps.prisma.keptFile.deleteMany({
        where: {
          botId: bot.id,
          OR: [{ path: itemPath }, { path: { startsWith: `${itemPath}/` } }],
        },
      }),
    );
  }
  return storedFilesState(deps, bot);
}

export async function downloadStoredFile(
  deps: Deps,
  bot: OwnedBot,
  itemPath: string,
  maxBytes: number,
  sizeLabel: string,
) {
  const { where, item } = await listedItem(deps, bot, itemPath);
  if (item.kind !== "file") {
    throw new ORPCError("BAD_REQUEST", { message: "Only single files can be downloaded." });
  }
  if (item.size > maxBytes) {
    throw new ORPCError("BAD_REQUEST", {
      message: `File exceeds the ${sizeLabel} download limit. Ask the bot to send it in the chat.`,
    });
  }
  const handle = await openStoredFile(where.home, where.folder, itemPath);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) {
      throw new ORPCError("BAD_REQUEST", {
        message: "That file changed; open the Files tab again.",
      });
    }
    return { path: itemPath, contentBase64: (await handle.readFile()).toString("base64") };
  } finally {
    await handle.close();
  }
}

export async function deleteStoredFile(deps: Deps, bot: OwnedBot, itemPath: string) {
  const { where } = await listedItem(deps, bot, itemPath);
  await removeStoredItem(where.home, where.folder, itemPath);
  await runAsSystem("unpin deleted file", () =>
    deps.prisma.keptFile.deleteMany({
      where: {
        botId: bot.id,
        OR: [{ path: itemPath }, { path: { startsWith: `${itemPath}/` } }],
      },
    }),
  );
  return storedFilesState(deps, bot, true);
}
