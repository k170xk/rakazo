import { setCompanyPolicy } from "@rakazo/adapters";
import { DEFAULT_COMPANY_FEATURES, DEFAULT_COMPANY_TOOLS } from "@rakazo/contracts";
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

  it("lets admins add skills while staff cannot", async () => {
    expect(DEFAULT_COMPANY_FEATURES.staffSkills).toBe(false);
    await expect(requireCompanyFeature(deps, { userId: "member" }, "staffSkills")).rejects.toThrow(
      "Writing skills",
    );
    await expect(
      requireCompanyFeature(deps, { userId: "admin" }, "staffSkills"),
    ).resolves.toBeUndefined();
  });

  it("keeps personal vaults off for everyone until an admin turns them on", async () => {
    expect(DEFAULT_COMPANY_FEATURES.personalVault).toBe(false);
    await expect(
      requireCompanyFeature(deps, { userId: "member" }, "personalVault"),
    ).rejects.toThrow("Personal vaults are turned off");
    await expect(requireCompanyFeature(deps, { userId: "admin" }, "personalVault")).rejects.toThrow(
      "Personal vaults are turned off",
    );
  });

  it("still blocks admins from a switch that applies to everyone", async () => {
    setCompanyPolicy({ features: { ...DEFAULT_COMPANY_FEATURES, plugins: false } });
    await expect(requireCompanyFeature(deps, { userId: "admin" }, "plugins")).rejects.toThrow(
      "Plugins are turned off",
    );
  });
});

describe.each([
  ["outlookSend", "Outlook email drafts are not turned on for you."],
  ["outlookFiling", "Outlook email filing is not turned on for you."],
] as const)("%s switch", (feature, offMessage) => {
  afterEach(() => {
    setCompanyPolicy({ features: null, tools: null });
  });

  it("is off by default and refuses everyone, admins included", async () => {
    expect(DEFAULT_COMPANY_FEATURES[feature]).toBe(false);
    await expect(requireCompanyFeature(deps, { userId: "member" }, feature)).rejects.toThrow(
      offMessage,
    );
    await expect(requireCompanyFeature(deps, { userId: "admin" }, feature)).rejects.toThrow(
      offMessage,
    );
  });

  it("admits only the chosen people and groups once limited", async () => {
    setCompanyPolicy({
      features: { ...DEFAULT_COMPANY_FEATURES, [feature]: true },
      tools: {
        ...DEFAULT_COMPANY_TOOLS,
        accessGroups: [{ id: "g1", name: "Projects", userIds: ["grouped"] }],
        featureAudiences: { [feature]: { userIds: ["chosen"], groupIds: ["g1"] } },
      },
    });
    await expect(requireCompanyFeature(deps, { userId: "member" }, feature)).rejects.toThrow(
      "Your administrator has not turned this on for you.",
    );
    await expect(
      requireCompanyFeature(deps, { userId: "chosen" }, feature),
    ).resolves.toBeUndefined();
    await expect(
      requireCompanyFeature(deps, { userId: "grouped" }, feature),
    ).resolves.toBeUndefined();
    await expect(
      requireCompanyFeature(deps, { userId: "admin" }, feature),
    ).resolves.toBeUndefined();
  });
});
