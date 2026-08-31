import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { IsolationError, requireMembership } from "./scope.js";

function member(organizationId: string, createdAt: string) {
  return {
    userId: "user-1",
    organizationId,
    createdAt: new Date(createdAt),
    user: { email: "user@rakazo.test" },
    organization: { id: organizationId, name: organizationId },
  };
}

describe("requireMembership", () => {
  it("uses the active workspace when the user belongs to it", async () => {
    const prisma = {
      member: {
        findMany: vi.fn(async () => [
          member("ws-first", "2026-01-01"),
          member("ws-two", "2026-02-01"),
        ]),
      },
      deploymentSettings: { findUnique: vi.fn(async () => ({ ownerUserId: "user-1" })) },
    } as unknown as PrismaClient;

    await expect(requireMembership(prisma, "user-1", "ws-two")).resolves.toMatchObject({
      userId: "user-1",
      workspaceId: "ws-two",
      isDeploymentOwner: true,
    });
  });

  it("falls back to the first membership when the active id is unknown", async () => {
    const prisma = {
      member: {
        findMany: vi.fn(async () => [
          member("ws-first", "2026-01-01"),
          member("ws-two", "2026-02-01"),
        ]),
      },
      deploymentSettings: { findUnique: vi.fn(async () => ({ ownerUserId: "other" })) },
    } as unknown as PrismaClient;

    await expect(requireMembership(prisma, "user-1", "ws-gone")).resolves.toMatchObject({
      workspaceId: "ws-first",
      isDeploymentOwner: false,
    });
  });

  it("throws when the user has no workspace", async () => {
    const prisma = {
      member: { findMany: vi.fn(async () => []) },
      deploymentSettings: { findUnique: vi.fn(async () => null) },
    } as unknown as PrismaClient;

    await expect(requireMembership(prisma, "user-1")).rejects.toBeInstanceOf(IsolationError);
  });
});
