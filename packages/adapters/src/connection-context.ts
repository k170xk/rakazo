import type { AdapterContext } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import type { PluginConnectionRow } from "./composio-connector.js";
import { planLiveConnectionSync } from "./composio-connector.js";
import type { ExecutorDeps } from "./executor-deps.js";
import { SHAREPOINT_PROVIDER } from "./microsoft-connector.js";
import { OUTLOOK_PROVIDER } from "./microsoft-mail.js";

/** Apps holding a person's own mail and files, reachable only from their private chat. */
const PRIVATE_APPS = [
  { connectorId: "microsoft", provider: OUTLOOK_PROVIDER },
  { connectorId: "microsoft", provider: SHAREPOINT_PROVIDER },
];

/** Runs the person started or scheduled themselves, never ones another person or bot set off. */
const OWNER_TRIGGERS = new Set([
  "user",
  "routine",
  "resume",
  "follow_up",
  "reaction",
  "call_end",
  "skill",
]);

/**
 * True only for the person's own one-to-one chat with their own bot, on a turn they set off
 * (or that another of their own bots woke in that same private chat). Group chats, Slack or Teams,
 * and messages from someone else's bot all fall outside it, so nobody else can read the replies.
 */
export function isOwnersPrivateChat(input: {
  run: { userId: string; trigger: string };
  bot: { id: string; userId: string };
  thread: {
    userId: string;
    botId: string | null;
    groupId: string | null;
    externalConversationId: string | null;
  };
  /** Owner of the bot that sent a bot_message wake; same-person PA handoffs keep mail and todos. */
  peerBotUserId?: string | null;
}): boolean {
  const { run, bot, thread, peerBotUserId } = input;
  const ownerTurn =
    OWNER_TRIGGERS.has(run.trigger) ||
    (run.trigger === "bot_message" && peerBotUserId != null && peerBotUserId === bot.userId);
  return (
    ownerTurn &&
    bot.userId === run.userId &&
    thread.userId === run.userId &&
    thread.botId === bot.id &&
    !thread.groupId &&
    !thread.externalConversationId
  );
}

/** Drops private apps from a run that is not the owner's private chat. */
export function withoutPrivateApps<T extends { connectorId: string; provider: string }>(
  rows: T[],
  privateChat: boolean,
): T[] {
  if (privateChat) return rows;
  return rows.filter(
    (row) =>
      !PRIVATE_APPS.some(
        (app) =>
          app.connectorId === row.connectorId && app.provider === row.provider.trim().toLowerCase(),
      ),
  );
}

export function selectRunConnections<
  T extends { connectorId: string; provider: string; status: string },
>(rows: T[], connectedComposioProviders: string[]): T[] {
  const liveProviders = new Set(
    connectedComposioProviders.map((provider) => provider.trim().toLowerCase()).filter(Boolean),
  );
  const connectedKeys = new Set(
    rows
      .filter((row) => row.status === "connected")
      .map((row) => `${row.connectorId}:${row.provider.trim().toLowerCase()}`),
  );
  return rows.filter((row) => {
    if (row.status === "connected") return true;
    if (row.status === "revoked") return false;
    // Recover a pending/error Composio row only when this provider has no
    // connected row of its own. A sibling that shares the slug must not
    // pull a non-live row — and its dead providerRef — into the run.
    if (row.connectorId !== "composio") return false;
    if (row.status !== "pending" && row.status !== "error") return false;
    const providerKey = row.provider.trim().toLowerCase();
    if (!liveProviders.has(providerKey)) return false;
    return !connectedKeys.has(`composio:${providerKey}`);
  });
}

/** Authorized connection metadata shared by model runs and unattended checks. */
export function connectedContext(
  rows: Array<{
    id: string;
    connectorId: string;
    provider: string;
    displayName: string;
    providerRef: string | null;
  }>,
): Pick<AdapterContext, "connectedConnections" | "connectedProviders"> {
  return {
    connectedConnections: rows.map((row) => ({
      id: row.id,
      connectorId: row.connectorId,
      externalId: row.provider,
      displayName: row.displayName,
      providerRef: row.providerRef ?? undefined,
    })),
    connectedProviders: rows
      .filter((row) => row.connectorId === "composio")
      .map((row) => row.provider),
  };
}

const PRIVACY_THREAD_FIELDS = {
  userId: true,
  botId: true,
  groupId: true,
  externalConversationId: true,
} as const;

/**
 * Whether a routine's checks may use private apps: its chat must be the owner's private chat
 * with the routine's own bot. Anything that cannot be confirmed counts as shared.
 */
export async function routineIsPrivate(
  prisma: PrismaClient,
  routine: { id: string; userId: string },
): Promise<boolean> {
  try {
    const found = await prisma.routine.findUnique({
      where: { id: routine.id },
      select: {
        bot: { select: { id: true, userId: true, thread: { select: PRIVACY_THREAD_FIELDS } } },
        thread: { select: PRIVACY_THREAD_FIELDS },
      },
    });
    const thread = found?.thread ?? found?.bot.thread;
    if (!found || !thread) return false;
    return isOwnersPrivateChat({
      run: { userId: routine.userId, trigger: "routine" },
      bot: found.bot,
      thread,
    });
  } catch {
    return false;
  }
}

export async function loadLivePluginSlugs(
  listConnectedPluginSlugs: ExecutorDeps["listConnectedPluginSlugs"],
  userId: string,
): Promise<{ ok: true; slugs: string[] } | { ok: false }> {
  if (!listConnectedPluginSlugs) return { ok: false };
  try {
    return { ok: true, slugs: await listConnectedPluginSlugs(userId) };
  } catch {
    return { ok: false };
  }
}

export async function persistLivePluginConnections(
  prisma: PrismaClient,
  owner: { userId: string; spaceId: string },
  rows: PluginConnectionRow[],
  liveSlugs: string[],
): Promise<void> {
  const sync = planLiveConnectionSync(rows, liveSlugs);
  if (sync.connectIds.length > 0) {
    await prisma.connection.updateMany({
      where: {
        id: { in: sync.connectIds },
        userId: owner.userId,
        spaceId: owner.spaceId,
      },
      data: { status: "connected" },
    });
    for (const row of rows) {
      if (sync.connectIds.includes(row.id)) row.status = "connected";
    }
  }
  if (sync.revokeIds.length > 0) {
    await prisma.connection.updateMany({
      where: {
        id: { in: sync.revokeIds },
        userId: owner.userId,
        spaceId: owner.spaceId,
      },
      data: { status: "revoked" },
    });
    for (const row of rows) {
      if (sync.revokeIds.includes(row.id)) row.status = "revoked";
    }
  }
}
