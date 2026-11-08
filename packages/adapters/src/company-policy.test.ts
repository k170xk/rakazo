import { DEFAULT_COMPANY_FEATURES, DEFAULT_COMPANY_TOOLS } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_MODEL_SECRET_RECORD,
  companyAssistantModel,
  companyFeatures,
  companyModel,
  liveDeploymentModelConfigured,
  liveDeploymentModelKey,
  refreshCompanyPolicy,
  setCompanyPolicy,
} from "./company-policy.js";
import { resolveDeploymentModel } from "./deployment-model.js";
import { COMPUTER_TOOL_NAMES, selectBuiltinToolsForRun } from "./run-tool-selection.js";

function prismaWith(row: Record<string, unknown> | null) {
  return {
    deploymentSettings: { findUnique: vi.fn(async () => row) },
  } as unknown as PrismaClient;
}

afterEach(() => {
  setCompanyPolicy({ features: null, model: null, tools: null });
});

describe("company policy", () => {
  it("allows everything until an admin turns something off", () => {
    expect(companyFeatures()).toEqual(DEFAULT_COMPANY_FEATURES);
    expect(companyModel()).toBeNull();
  });

  it("reads the switches and decrypts the company key", async () => {
    const load = vi.fn(async () => "sk-company");
    await refreshCompanyPolicy(
      prismaWith({
        companyFeatures: { computers: false, memberModels: false },
        defaultModelProvider: "openai",
        defaultModelId: "gpt-5.5",
        deploymentModelCredentialCipher: "cipher",
      }),
      { load },
    );
    expect(load).toHaveBeenCalledWith("cipher", COMPANY_MODEL_SECRET_RECORD);
    expect(companyFeatures()).toEqual({
      ...DEFAULT_COMPANY_FEATURES,
      computers: false,
      memberModels: false,
    });
    expect(companyModel()).toEqual({ provider: "openai", model: "gpt-5.5", key: "sk-company" });
  });

  it("keeps the last key when the store cannot be read", async () => {
    setCompanyPolicy({ model: { provider: "openai", model: "gpt-5.5", key: "sk-company" } });
    await refreshCompanyPolicy(
      prismaWith({
        companyFeatures: {},
        defaultModelProvider: "openai",
        defaultModelId: "gpt-5.5",
        deploymentModelCredentialCipher: "cipher",
      }),
      { load: async () => Promise.reject(new Error("store offline")) },
    );
    expect(companyModel()?.key).toBe("sk-company");
  });

  it("drops the model once the admin removes it", async () => {
    setCompanyPolicy({ model: { provider: "openai", model: "gpt-5.5", key: "sk-company" } });
    await refreshCompanyPolicy(prismaWith({ companyFeatures: {} }), { load: vi.fn() });
    expect(companyModel()).toBeNull();
  });

  it("runs every account on the company model ahead of the environment's", () => {
    setCompanyPolicy({ model: { provider: "openai", model: "gpt-5.5", key: "sk-company" } });
    expect(resolveDeploymentModel({ OPENROUTER_API_KEY: "or-key" })).toMatchObject({
      provider: "openai",
      model: "gpt-5.5",
      key: "sk-company",
      configured: true,
      hostCredentials: false,
    });
    expect(liveDeploymentModelKey("or-key")).toBe("sk-company");
    expect(liveDeploymentModelConfigured(false)).toBe(true);
  });

  it("falls back to the environment without a company model", () => {
    expect(liveDeploymentModelKey("or-key")).toBe("or-key");
    expect(liveDeploymentModelConfigured(false)).toBe(false);
  });
});

describe("company switches in tool selection", () => {
  const base = {
    graphicalToolsAllowed: true,
    pageBrowserAllowed: true,
    groupId: null,
    trigger: "user",
    semanticMemoryEnabled: false,
    messagingChannelRun: false,
  };
  const names = (options: Partial<Parameters<typeof selectBuiltinToolsForRun>[0]>) =>
    new Set(selectBuiltinToolsForRun({ ...base, ...options }).map((tool) => tool.name));

  it("removes the tools each switch turns off", () => {
    const all = names({});
    expect(all.has("shell")).toBe(true);
    expect(all.has("connect_app")).toBe(true);

    const off = names({
      computersEnabled: false,
      connectedAppsEnabled: false,
      mcpServersEnabled: false,
      routinesEnabled: false,
    });
    for (const name of COMPUTER_TOOL_NAMES) expect(off.has(name)).toBe(false);
    expect(off.has("connect_app")).toBe(false);
    expect(off.has("add_mcp_server")).toBe(false);
    expect([...off].some((name) => name.startsWith("schedule_"))).toBe(false);
    expect(off.has("remember")).toBe(all.has("remember"));
  });

  it("runs an Evolve assistant's bots on its own model only on the company provider", () => {
    const civil = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
    const chosen = { provider: "openrouter", modelId: "openai/gpt-6", thinkingLevel: null };
    setCompanyPolicy({
      model: { provider: "openrouter", model: "openai/gpt-6-luna", key: "sk-company" },
      tools: { ...DEFAULT_COMPANY_TOOLS, assistantModels: { [civil]: chosen } },
    });
    expect(companyAssistantModel(civil)).toEqual(chosen);
    expect(companyAssistantModel(null)).toBeNull();
    expect(companyAssistantModel("00000000-0000-4000-8000-000000000000")).toBeNull();
    setCompanyPolicy({ model: { provider: "anthropic", model: "claude-sonnet-5", key: "sk-a" } });
    expect(companyAssistantModel(civil)).toBeNull();
  });
});
