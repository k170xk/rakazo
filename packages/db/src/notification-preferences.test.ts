import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import {
  getOrCreateNotificationPreferences,
  notificationCategoryAllowed,
  notificationCategoryFromKind,
  notificationChannelsEnabled,
  updateNotificationPreferences,
} from "./notification-preferences.js";

const defaults = {
  inApp: true,
  push: true,
  actionNeeded: true,
  updates: true,
  problems: true,
};

describe("notificationCategoryFromKind", () => {
  it("maps each legacy kind onto a preference category", () => {
    expect(notificationCategoryFromKind("help")).toBe("action_needed");
    expect(notificationCategoryFromKind("takeover")).toBe("action_needed");
    expect(notificationCategoryFromKind("completion")).toBe("updates");
    expect(notificationCategoryFromKind("failure")).toBe("problems");
  });
});

describe("notificationCategoryAllowed", () => {
  it("gates each category on its own preference", () => {
    const prefs = {
      actionNeeded: false,
      updates: true,
      problems: false,
    };
    expect(notificationCategoryAllowed(prefs, "action_needed")).toBe(false);
    expect(notificationCategoryAllowed(prefs, "updates")).toBe(true);
    expect(notificationCategoryAllowed(prefs, "problems")).toBe(false);
  });
});

describe("notificationChannelsEnabled", () => {
  it("returns the channel flags the member saved", () => {
    expect(notificationChannelsEnabled({ inApp: true, push: false })).toEqual({
      inApp: true,
      push: false,
    });
  });
});

describe("getOrCreateNotificationPreferences", () => {
  it("returns an existing row without creating another", async () => {
    const findUnique = vi.fn(async () => defaults);
    const create = vi.fn();
    const prisma = {
      notificationPreference: { findUnique, create },
    } as unknown as PrismaClient;

    await expect(
      getOrCreateNotificationPreferences(prisma, { spaceId: "space-1", userId: "user-1" }),
    ).resolves.toEqual(defaults);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates defaults when the member has no row yet", async () => {
    const findUnique = vi.fn(async () => null);
    const create = vi.fn(async () => defaults);
    const prisma = {
      notificationPreference: { findUnique, create },
    } as unknown as PrismaClient;

    await expect(
      getOrCreateNotificationPreferences(prisma, { spaceId: "space-1", userId: "user-1" }),
    ).resolves.toEqual(defaults);
    expect(create).toHaveBeenCalledWith({
      data: { spaceId: "space-1", userId: "user-1" },
      select: {
        inApp: true,
        push: true,
        actionNeeded: true,
        updates: true,
        problems: true,
      },
    });
  });

  it("reads the winning row when a concurrent create lands first", async () => {
    const findUnique = vi.fn(async () => null);
    const findUniqueOrThrow = vi.fn(async () => ({ ...defaults, push: false }));
    const create = vi.fn(async () => {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      });
    });
    const prisma = {
      notificationPreference: { findUnique, findUniqueOrThrow, create },
    } as unknown as PrismaClient;

    await expect(
      getOrCreateNotificationPreferences(prisma, { spaceId: "space-1", userId: "user-1" }),
    ).resolves.toEqual({ ...defaults, push: false });
  });
});

describe("updateNotificationPreferences", () => {
  it("writes only the fields the caller sent", async () => {
    const findUnique = vi.fn(async () => defaults);
    const update = vi.fn(async () => ({ ...defaults, problems: false, push: false }));
    const prisma = {
      notificationPreference: { findUnique, create: vi.fn(), update },
    } as unknown as PrismaClient;

    await expect(
      updateNotificationPreferences(
        prisma,
        { spaceId: "space-1", userId: "user-1" },
        { problems: false, push: false },
      ),
    ).resolves.toEqual({ ...defaults, problems: false, push: false });
    expect(update).toHaveBeenCalledWith({
      where: { spaceId_userId: { spaceId: "space-1", userId: "user-1" } },
      data: { problems: false, push: false },
      select: {
        inApp: true,
        push: true,
        actionNeeded: true,
        updates: true,
        problems: true,
      },
    });
  });
});
