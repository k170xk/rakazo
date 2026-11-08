import { setCompanyPolicy } from "@rakazo/adapters";
import { DEFAULT_COMPANY_FEATURES } from "@rakazo/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { requireCompanyFeature } from "./company-admin.js";
import type { RouterDeps } from "./router.js";

const users: Record<string, { email: string; emailVerified: boolean }> = {
  admin: { email: "Admin@ocsc.co.uk", emailVerified: true },
  member: { email: "member@ocsc.co.uk", emailVerified: true },
};

const deps = {
  env: { adminEmails: ["admin@ocsc.co.uk"] },
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => users[where.id] ?? null,
    },
  },
} as unknown as Pick<RouterDeps, "prisma"> & { env: Pick<RouterDeps["env"], "adminEmails"> };

afterEach(() => {
  setCompanyPolicy({ features: null });
});

describe("staff integrations switch", () => {
  it("is off by default", () => {
    expect(DEFAULT_COMPANY_FEATURES.staffIntegrations).toBe(false);
  });

  it("refuses members while off", async () => {
    await expect(
      requireCompanyFeature(deps, { userId: "member" }, "staffIntegrations"),
    ).rejects.toThrow("coming soon");
  });

  it("lets admins in while off", async () => {
    await expect(
      requireCompanyFeature(deps, { userId: "admin" }, "staffIntegrations"),
    ).resolves.toBeUndefined();
  });

  it("lets members in once on", async () => {
    setCompanyPolicy({ features: { ...DEFAULT_COMPANY_FEATURES, staffIntegrations: true } });
    await expect(
      requireCompanyFeature(deps, { userId: "member" }, "staffIntegrations"),
    ).resolves.toBeUndefined();
  });

  it("still blocks admins from a switch that applies to everyone", async () => {
    setCompanyPolicy({ features: { ...DEFAULT_COMPANY_FEATURES, plugins: false } });
    await expect(requireCompanyFeature(deps, { userId: "admin" }, "plugins")).rejects.toThrow(
      "Plugins are turned off",
    );
  });
});
