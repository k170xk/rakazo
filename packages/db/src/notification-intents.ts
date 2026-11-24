import type { NotificationCategory } from "@rakazo/contracts";
import type { Prisma, PrismaClient } from "./client.js";
import { Prisma as PrismaNs } from "./client.js";

type IntentClient = Pick<PrismaClient, "notificationIntent" | "$queryRaw" | "$executeRaw">;
type IntentTx = Pick<Prisma.TransactionClient, "notificationIntent" | "$queryRaw" | "$executeRaw">;
type IntentDb = IntentClient | IntentTx;

export type NotificationIntentKind = "completion" | "failure" | "help" | "takeover";
export type NotificationIntentStatus =
  | "pending"
  | "processing"
  | "sent"
  | "skipped"
  | "failed";

export type NotificationIntentRow = {
  id: string;
  spaceId: string;
  userId: string;
  botId: string;
  threadId: string;
  groupId: string | null;
  runId: string | null;
  messageId: string | null;
  sourceEventKey: string;
  kind: string;
  category: string;
  title: string;
  body: string;
  status: string;
  attempts: number;
  nextAttemptAt: Date | null;
  claimedBy: string | null;
  claimedAt: Date | null;
  deliveryId: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type UpsertNotificationIntentInput = {
  spaceId: string;
  userId: string;
  botId: string;
  threadId: string;
  groupId?: string | null;
  runId?: string | null;
  messageId?: string | null;
  sourceEventKey: string;
  kind: NotificationIntentKind;
  category: NotificationCategory;
  title: string;
  body: string;
};

/** A worker that dies mid-delivery leaves processing rows; reclaim after this age. */
export const NOTIFICATION_INTENT_CLAIM_STALE_MS = 2 * 60_000;

/** Stable key for one alert event so retries upsert rather than duplicate. */
export function notificationSourceEventKey(input: {
  kind: NotificationIntentKind;
  runId: string;
  messageId?: string | null;
}): string {
  const messagePart = input.messageId?.trim() ? input.messageId.trim() : "-";
  return `${input.kind}:${input.runId}:${messagePart}`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof PrismaNs.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Create the intent when missing. Concurrent upserts for the same user and
 * source key converge on one row.
 */
export async function upsertNotificationIntent(
  db: IntentDb,
  input: UpsertNotificationIntentInput,
): Promise<{ id: string; created: boolean }> {
  try {
    const created = await db.notificationIntent.create({
      data: {
        spaceId: input.spaceId,
        userId: input.userId,
        botId: input.botId,
        threadId: input.threadId,
        groupId: input.groupId ?? null,
        runId: input.runId ?? null,
        messageId: input.messageId ?? null,
        sourceEventKey: input.sourceEventKey,
        kind: input.kind,
        category: input.category,
        title: input.title,
        body: input.body,
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await db.notificationIntent.findUniqueOrThrow({
      where: {
        userId_sourceEventKey: {
          userId: input.userId,
          sourceEventKey: input.sourceEventKey,
        },
      },
      select: { id: true },
    });
    return { id: existing.id, created: false };
  }
}

/**
 * Claim due intents for this worker. Uses SKIP LOCKED so concurrent drains
 * never take the same row.
 */
export async function claimPendingNotificationIntents(
  db: IntentDb,
  input: { workerId: string; limit: number; now: Date; intentId?: string },
): Promise<NotificationIntentRow[]> {
  const limit = Math.max(1, Math.min(input.limit, 100));
  const staleBefore = new Date(input.now.getTime() - NOTIFICATION_INTENT_CLAIM_STALE_MS);
  if (input.intentId) {
    return claimSpecificIntent(db, {
      intentId: input.intentId,
      workerId: input.workerId,
      now: input.now,
      staleBefore,
    });
  }
  return db.$queryRaw<NotificationIntentRow[]>`
    UPDATE notification_intents AS claimed
    SET
      status = 'processing',
      "claimedBy" = ${input.workerId},
      "claimedAt" = ${input.now},
      attempts = claimed.attempts + 1,
      "updatedAt" = ${input.now}
    FROM (
      SELECT id
      FROM notification_intents
      WHERE
        (
          status = 'pending'
          OR (status = 'failed' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${input.now}))
          OR (status = 'processing' AND "claimedAt" IS NOT NULL AND "claimedAt" < ${staleBefore})
        )
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    ) AS due
    WHERE claimed.id = due.id
    RETURNING claimed.*
  `;
}

async function claimSpecificIntent(
  db: IntentDb,
  input: { intentId: string; workerId: string; now: Date; staleBefore: Date },
): Promise<NotificationIntentRow[]> {
  return db.$queryRaw<NotificationIntentRow[]>`
    UPDATE notification_intents AS claimed
    SET
      status = 'processing',
      "claimedBy" = ${input.workerId},
      "claimedAt" = ${input.now},
      attempts = claimed.attempts + 1,
      "updatedAt" = ${input.now}
    FROM (
      SELECT id
      FROM notification_intents
      WHERE id = ${input.intentId}
        AND (
          status = 'pending'
          OR (status = 'failed' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${input.now}))
          OR (status = 'processing' AND "claimedAt" IS NOT NULL AND "claimedAt" < ${input.staleBefore})
        )
      FOR UPDATE SKIP LOCKED
    ) AS due
    WHERE claimed.id = due.id
    RETURNING claimed.*
  `;
}

export async function markNotificationIntentSent(
  db: IntentDb,
  input: { id: string; deliveryId: string },
): Promise<void> {
  await db.notificationIntent.updateMany({
    where: { id: input.id, status: "processing" },
    data: {
      status: "sent",
      deliveryId: input.deliveryId,
      nextAttemptAt: null,
      claimedBy: null,
      claimedAt: null,
      lastError: null,
    },
  });
}

export async function markNotificationIntentSkipped(
  db: IntentDb,
  input: { id: string; reason?: string },
): Promise<void> {
  await db.notificationIntent.updateMany({
    where: { id: input.id, status: "processing" },
    data: {
      status: "skipped",
      nextAttemptAt: null,
      claimedBy: null,
      claimedAt: null,
      lastError: input.reason ?? null,
    },
  });
}

export async function markNotificationIntentFailed(
  db: IntentDb,
  input: { id: string; error: string; nextAttemptAt: Date | null },
): Promise<void> {
  await db.notificationIntent.updateMany({
    where: { id: input.id, status: "processing" },
    data: {
      status: "failed",
      lastError: input.error.slice(0, 500),
      nextAttemptAt: input.nextAttemptAt,
      claimedBy: null,
      claimedAt: null,
    },
  });
}
