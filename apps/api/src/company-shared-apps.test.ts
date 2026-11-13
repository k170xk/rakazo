import { describe, expect, it, vi } from "vitest";
import { listSharedApps, setSharedAppFrozen } from "./company-shared-apps.js";
import type { RouterDeps } from "./router.js";

const actor = {
  userId: "admin-1",
  spaceId: "space-1",
  email: "boss@ocsc.co.uk",
  isDeploymentOwner: false,
};
const row = {
  id: "page-1",
  title: "Tracker",
  kind: "app",
  visibility: "link",
  evolvePluginSlug: "tracker",
  frozenAt: null as Date | null,
  updatedAt: new Date("2026-11-01T00:00:00Z"),
  user: { name: "Ann", email: "ann@ocsc.co.uk" },
};

function deps(admin: boolean) {
  const prisma = {
    user: {
      findUnique: vi.fn(async () => ({
        email: admin ? "boss@ocsc.co.uk" : "someone@ocsc.co.uk",
        emailVerified: true,
      })),
    },
    page: {
      findMany: vi.fn(async () => [row]),
      findUnique: vi.fn(async () => ({ id: row.id })),
      update: vi.fn(async ({ data }: { data: { frozenAt: Date | null } }) => ({
        ...row,
        frozenAt: data.frozenAt,
      })),
    },
  };
  const value = {
    prisma,
    env: { adminEmails: ["boss@ocsc.co.uk"] },
  } as unknown as Pick<RouterDeps, "prisma" | "env">;
  return { value, prisma };
}

describe("shared app freeze", () => {
  it("is for admins only", async () => {
    const { value, prisma } = deps(false);
    await expect(listSharedApps(value, actor)).rejects.toThrow(/Admins only/);
    await expect(
      setSharedAppFrozen(value, actor, { pageId: "page-1", frozen: true }),
    ).rejects.toThrow(/Admins only/);
    expect(prisma.page.update).not.toHaveBeenCalled();
  });

  it("lists shared, published and frozen pages", async () => {
    const { value, prisma } = deps(true);
    expect(await listSharedApps(value, actor)).toEqual([
      {
        id: "page-1",
        title: "Tracker",
        kind: "app",
        owner: "Ann",
        visibility: "link",
        evolvePluginSlug: "tracker",
        frozenAt: null,
        updatedAt: "2026-11-01T00:00:00.000Z",
      },
    ]);
    expect(prisma.page.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { visibility: { in: ["link", "public"] } },
            { evolvePluginSlug: { not: null } },
            { frozenAt: { not: null } },
          ],
        },
      }),
    );
  });

  it("records who froze it and clears that on unfreeze", async () => {
    const { value, prisma } = deps(true);
    const frozen = await setSharedAppFrozen(value, actor, { pageId: "page-1", frozen: true });
    expect(frozen.frozenAt).not.toBeNull();
    expect(prisma.page.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: "page-1" },
        data: { frozenAt: expect.any(Date), frozenBy: "admin-1" },
      }),
    );
    await setSharedAppFrozen(value, actor, { pageId: "page-1", frozen: false });
    expect(prisma.page.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { frozenAt: null, frozenBy: null } }),
    );
  });
});
