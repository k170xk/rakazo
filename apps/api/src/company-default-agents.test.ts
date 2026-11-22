import { setCompanyPolicy } from "@rakazo/adapters";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCompanySkill,
  createDefaultAgent,
  listCompanySkills,
  listDefaultAgents,
  listVectorStores,
  removeCompanySkill,
  removeDefaultAgent,
  updateCompanySkill,
  updateDefaultAgent,
} from "./company-default-agents.js";
import type { RouterDeps } from "./router.js";

const ASSISTANT_ID = "11111111-1111-4111-8111-111111111111";

function makeHarness(evolveHandler?: (body: Record<string, unknown>) => unknown) {
  let storedTools: Record<string, unknown> = {};
  const users: Record<string, { email: string; emailVerified: boolean }> = {
    admin: { email: "admin@ocsc.ie", emailVerified: true },
    member: { email: "member@ocsc.ie", emailVerified: true },
  };
  const calls: Array<Record<string, unknown>> = [];

  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push(body);
    const reply = evolveHandler ? evolveHandler(body) : {};
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => users[where.id] ?? null,
    },
    deploymentSettings: {
      findUnique: async () => ({
        companyTools: storedTools,
        companyFeatures: {},
        defaultModelProvider: null,
        defaultModelId: null,
        deploymentModelCredentialCipher: null,
        companyThinkingLevel: null,
        staffLimits: {},
      }),
      upsert: async ({ update }: { update: { companyTools: Record<string, unknown> } }) => {
        storedTools = update.companyTools;
        return { companyTools: storedTools };
      },
    },
  };

  const deps = {
    env: { adminEmails: ["admin@ocsc.ie"] },
    prisma,
    secrets: { load: async () => "k" },
    evolvePlugins: {
      url: "https://evolve.test/functions/v1/",
      secret: "s".repeat(40),
    },
  } as unknown as RouterDeps;

  return {
    deps,
    calls,
    fetchMock,
    getStoredTools: () => storedTools,
    setStoredTools: (next: Record<string, unknown>) => {
      storedTools = next;
    },
  };
}

const adminActor = {
  userId: "admin",
  spaceId: "space-1",
  email: "admin@ocsc.ie",
  isDeploymentOwner: true,
};
const memberActor = {
  userId: "member",
  spaceId: "space-1",
  email: "member@ocsc.ie",
  isDeploymentOwner: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
  setCompanyPolicy({ tools: null, features: null });
});

describe("company skills CRUD", () => {
  it("creates, lists, updates, and removes company skills and cleans default agent attachments", async () => {
    const h = makeHarness();

    await expect(listCompanySkills(h.deps, memberActor)).rejects.toThrow();

    const created = await createCompanySkill(h.deps, adminActor, {
      name: "House Style",
      description: "OCSC tone and formatting",
      body: "Lead with the recommendation.",
      availableToAll: false,
    });
    expect(created.name).toBe("House Style");
    expect(created.availableToAll).toBe(false);
    expect(created.content).toContain("Lead with the recommendation.");

    // Duplicate name (case-insensitive) is rejected.
    await expect(
      createCompanySkill(h.deps, adminActor, {
        name: "house style",
        description: "Duplicate",
        body: "nope",
      }),
    ).rejects.toThrow("already exists");

    // Attach to a default agent config, then update and delete the skill.
    h.setStoredTools({
      ...h.getStoredTools(),
      assistantConfigs: {
        [ASSISTANT_ID]: {
          standingInstructions: "Keep it brief.",
          skills: [
            { skillKey: `company:${created.id}`, mode: "required" },
            { skillKey: "builtin:Interrogate", mode: "available" },
          ],
        },
      },
    });

    const updated = await updateCompanySkill(h.deps, adminActor, {
      id: created.id,
      availableToAll: true,
      body: "Lead with the answer and list assumptions.",
    });
    expect(updated.availableToAll).toBe(true);
    expect(updated.content).toContain("list assumptions");

    await removeCompanySkill(h.deps, adminActor, created.id);
    expect(await listCompanySkills(h.deps, adminActor)).toEqual([]);

    const configs = h.getStoredTools().assistantConfigs as Record<
      string,
      { skills?: Array<{ skillKey: string; mode: string }> }
    >;
    expect(configs[ASSISTANT_ID]?.skills).toEqual([
      { skillKey: "builtin:Interrogate", mode: "available" },
    ]);
  });
});

describe("default agents CRUD & vector stores", () => {
  it("creates, lists, updates, and deletes default agents synced with Evolve + Rakazo settings", async () => {
    const evolveAgent = {
      id: ASSISTANT_ID,
      name: "OCSC Civil Intelligence",
      description: "Civil engineering assistant",
      model: "gpt-5",
      instructions: "Starter prompt for civil staff.",
      systemInstructions: "",
      fileSearchEnabled: true,
      vectorStoreIds: ["vs_store1", "vs_store2"],
      enablePeople: true,
      enableResponses: false,
      allowedGroupIds: [],
      allowedUsers: [],
      isLineManagerOnly: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const h = makeHarness((body) => {
      if (body.action === "admin.create") {
        return {
          assistant: { ...evolveAgent, name: body.name, vectorStoreIds: body.vectorStoreIds },
        };
      }
      if (body.action === "admin.list") {
        return {
          assistants: [evolveAgent],
          groups: [{ id: "33333333-3333-4333-8333-333333333333", name: "Civil" }],
          people: [
            {
              id: 42,
              name: "Keith Knox",
              email: "admin@ocsc.ie",
              isAdmin: true,
              isLineManager: true,
            },
          ],
        };
      }
      if (body.action === "admin.update") {
        return { assistant: { ...evolveAgent, name: body.name ?? evolveAgent.name } };
      }
      if (body.action === "admin.delete") {
        return { ok: true, id: body.id };
      }
      if (body.action === "admin.vectorStores.list") {
        return {
          vectorStores: [
            {
              id: "vs_store1",
              name: "Eurocodes",
              fileCount: 12,
              inProgressCount: 0,
              failedCount: 0,
              status: "completed",
              usageBytes: 1024,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      return {};
    });
    vi.stubGlobal("fetch", h.fetchMock);

    // Non-admin cannot call default agent admin APIs.
    await expect(listDefaultAgents(h.deps, memberActor)).rejects.toThrow();

    const created = await createDefaultAgent(h.deps, adminActor, {
      name: "OCSC Civil Intelligence",
      description: "Civil engineering assistant",
      instructions: "Starter prompt for civil staff.",
      fileSearchEnabled: true,
      vectorStoreIds: ["vs_store1", "vs_store2"],
      enablePeople: true,
      enableResponses: false,
      allowedGroupIds: [],
      allowedUsers: [],
      isLineManagerOnly: false,
      rakazoModel: { provider: "openai", modelId: "gpt-5", thinkingLevel: "high" },
      config: {
        standingInstructions: "Always state design codes.",
        skills: [{ skillKey: "builtin:Interrogate", mode: "required" }],
        temperature: 0.3,
        maxTokens: 8192,
        disabledBuiltinTools: ["web_search"],
      },
    });
    expect(created.vectorStoreIds).toEqual(["vs_store1", "vs_store2"]);
    expect(created.rakazoModel).toEqual({
      provider: "openai",
      modelId: "gpt-5",
      thinkingLevel: "high",
    });
    expect(created.config).toMatchObject({
      standingInstructions: "Always state design codes.",
      temperature: 0.3,
      maxTokens: 8192,
      disabledBuiltinTools: ["web_search"],
    });

    const state = await listDefaultAgents(h.deps, adminActor);
    expect(state.agents).toHaveLength(1);
    expect(state.groups).toHaveLength(1);
    expect(state.people).toHaveLength(1);
    expect(state.builtinSkills.length).toBeGreaterThan(0);
    expect(state.builtinTools.length).toBeGreaterThan(0);

    const updated = await updateDefaultAgent(h.deps, adminActor, {
      id: ASSISTANT_ID,
      name: "OCSC Civil Intelligence v2",
      rakazoModel: null,
      config: { standingInstructions: "Updated live rule." },
    });
    expect(updated.name).toBe("OCSC Civil Intelligence v2");
    expect(updated.rakazoModel).toBeNull();
    expect(updated.config.standingInstructions).toBe("Updated live rule.");

    const stores = await listVectorStores(h.deps, adminActor);
    expect(stores).toHaveLength(1);
    expect(stores[0]?.name).toBe("Eurocodes");

    await removeDefaultAgent(h.deps, adminActor, ASSISTANT_ID);
    expect(h.getStoredTools().assistantModels).toEqual({});
    expect(h.getStoredTools().assistantConfigs).toEqual({});
  });
});
