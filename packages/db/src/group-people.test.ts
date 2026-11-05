import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { groupGuestActor, sharedGroupRunFromColleague } from "./group-people.js";

function prismaWith(options: {
  people?: number;
  source?: { role: string; authorUserId: string | null } | null;
  shared?: Array<{ groupId: string }>;
}) {
  return {
    chatGroupPerson: {
      count: vi.fn(async () => options.people ?? 0),
      findMany: vi.fn(async () => options.shared ?? []),
    },
    message: { findUnique: vi.fn(async () => options.source ?? null) },
  } as unknown as PrismaClient;
}

describe("sharedGroupRunFromColleague", () => {
  it("keeps the owner's context in a group with no colleagues", async () => {
    const prisma = prismaWith({ people: 0, source: { role: "user", authorUserId: "colleague" } });
    await expect(
      sharedGroupRunFromColleague(prisma, { groupId: "group", sourceMessageId: "message" }),
    ).resolves.toBe(false);
  });

  it("keeps the owner's context for the owner's own message", async () => {
    const prisma = prismaWith({ people: 1, source: { role: "user", authorUserId: null } });
    await expect(
      sharedGroupRunFromColleague(prisma, { groupId: "group", sourceMessageId: "message" }),
    ).resolves.toBe(false);
  });

  it("restricts a colleague's message, a bot handoff and a run with no message", async () => {
    for (const source of [
      { role: "user", authorUserId: "colleague" },
      { role: "bot", authorUserId: null },
      null,
    ]) {
      const prisma = prismaWith({ people: 1, source });
      await expect(
        sharedGroupRunFromColleague(prisma, {
          groupId: "group",
          sourceMessageId: source ? "message" : null,
        }),
      ).resolves.toBe(true);
    }
  });
});

describe("groupGuestActor", () => {
  it("is null for someone added to no group in that Space", async () => {
    await expect(
      groupGuestActor(prismaWith({}), { id: "user", email: "a@ocsc.co.uk" }, "space"),
    ).resolves.toBeNull();
  });

  it("names only the groups the colleague was added to", async () => {
    const prisma = prismaWith({ shared: [{ groupId: "g1" }, { groupId: "g2" }] });
    await expect(
      groupGuestActor(prisma, { id: "user", email: "a@ocsc.co.uk" }, "space"),
    ).resolves.toEqual({
      userId: "user",
      spaceId: "space",
      email: "a@ocsc.co.uk",
      isDeploymentOwner: false,
      guestGroupIds: ["g1", "g2"],
    });
  });
});
