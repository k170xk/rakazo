import type {
  NotificationCategory,
  NotificationPreferences,
  UpdateNotificationPreferencesInput,
} from "@rakazo/contracts";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";

type PreferenceClient = Pick<PrismaClient, "notificationPreference">;

type PreferenceScope = { spaceId: string; userId: string };

const PREFERENCE_SELECT = {
  inApp: true,
  push: true,
  actionNeeded: true,
  updates: true,
  problems: true,
} as const;

function toPreferences(row: NotificationPreferences): NotificationPreferences {
  return {
    inApp: row.inApp,
    push: row.push,
    actionNeeded: row.actionNeeded,
    updates: row.updates,
    problems: row.problems,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Load the member's preferences in this space, creating the default row when missing. */
export async function getOrCreateNotificationPreferences(
  prisma: PreferenceClient,
  scope: PreferenceScope,
): Promise<NotificationPreferences> {
  const where = { spaceId_userId: { spaceId: scope.spaceId, userId: scope.userId } };
  const existing = await prisma.notificationPreference.findUnique({
    where,
    select: PREFERENCE_SELECT,
  });
  if (existing) return toPreferences(existing);
  try {
    const created = await prisma.notificationPreference.create({
      data: { spaceId: scope.spaceId, userId: scope.userId },
      select: PREFERENCE_SELECT,
    });
    return toPreferences(created);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await prisma.notificationPreference.findUniqueOrThrow({
      where,
      select: PREFERENCE_SELECT,
    });
    return toPreferences(raced);
  }
}

/** Apply a partial update for the member in this space and return the saved preferences. */
export async function updateNotificationPreferences(
  prisma: PreferenceClient,
  scope: PreferenceScope,
  input: UpdateNotificationPreferencesInput,
): Promise<NotificationPreferences> {
  await getOrCreateNotificationPreferences(prisma, scope);
  const updated = await prisma.notificationPreference.update({
    where: { spaceId_userId: { spaceId: scope.spaceId, userId: scope.userId } },
    data: {
      ...(input.inApp === undefined ? {} : { inApp: input.inApp }),
      ...(input.push === undefined ? {} : { push: input.push }),
      ...(input.actionNeeded === undefined ? {} : { actionNeeded: input.actionNeeded }),
      ...(input.updates === undefined ? {} : { updates: input.updates }),
      ...(input.problems === undefined ? {} : { problems: input.problems }),
    },
    select: PREFERENCE_SELECT,
  });
  return toPreferences(updated);
}

/** Maps a legacy alert kind onto the preference category that gates it. */
export function notificationCategoryFromKind(
  kind: "completion" | "failure" | "help" | "takeover",
): NotificationCategory {
  switch (kind) {
    case "help":
    case "takeover":
      return "action_needed";
    case "completion":
      return "updates";
    case "failure":
      return "problems";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/** Whether the member still wants alerts in this category. */
export function notificationCategoryAllowed(
  prefs: Pick<NotificationPreferences, "actionNeeded" | "updates" | "problems">,
  category: NotificationCategory,
): boolean {
  switch (category) {
    case "action_needed":
      return prefs.actionNeeded;
    case "updates":
      return prefs.updates;
    case "problems":
      return prefs.problems;
    default: {
      const _exhaustive: never = category;
      return _exhaustive;
    }
  }
}

/** Which delivery channels remain on for this member. */
export function notificationChannelsEnabled(
  prefs: Pick<NotificationPreferences, "inApp" | "push">,
): { inApp: boolean; push: boolean } {
  return { inApp: prefs.inApp, push: prefs.push };
}
