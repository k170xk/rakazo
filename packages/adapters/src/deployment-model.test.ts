import { describe, expect, it } from "vitest";
import {
  DEPLOYMENT_MODEL_SECRET_ID,
  decryptDeploymentModelKey,
  resolveDeploymentModel,
  resolveEffectiveDeploymentModel,
} from "./deployment-model.js";

describe("resolveDeploymentModel", () => {
  it("pairs the deployment model key with the provider it belongs to", () => {
    const both = { OPENROUTER_API_KEY: "or-key", ANTHROPIC_API_KEY: "sk-ant-key" };
    expect(resolveDeploymentModel(both)).toEqual({
      provider: "openrouter",
      model: "deepseek/deepseek-v4-flash-0731",
      key: "or-key",
    });
    // The whole point: switching the provider switches the key with it.
    expect(resolveDeploymentModel({ ...both, PI_DEFAULT_PROVIDER: "anthropic" })).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
      key: "sk-ant-key",
    });
    // A provider with no key configured yields no key — never another vendor's.
    expect(
      resolveDeploymentModel({ OPENROUTER_API_KEY: "or-key", PI_DEFAULT_PROVIDER: "anthropic" }),
    ).toEqual({ provider: "anthropic", model: "claude-sonnet-5", key: undefined });
  });

  it("reads an OpenAI env key when that provider is the default", () => {
    expect(
      resolveDeploymentModel({
        PI_DEFAULT_PROVIDER: "openai",
        OPENAI_API_KEY: "sk-openai",
        OPENROUTER_API_KEY: "or-key",
      }),
    ).toEqual({ provider: "openai", model: "gpt-4.1", key: "sk-openai" });
  });
});

describe("resolveEffectiveDeploymentModel", () => {
  it("prefers a stored owner key and provider over env", () => {
    expect(
      resolveEffectiveDeploymentModel({
        storedProvider: "openai",
        storedModel: "gpt-4.1-mini",
        storedKey: "sk-stored",
        envKey: "or-key",
        env: { OPENROUTER_API_KEY: "or-key" },
      }),
    ).toEqual({ provider: "openai", model: "gpt-4.1-mini", key: "sk-stored" });
  });

  it("does not hand an env key to a different stored provider", () => {
    expect(
      resolveEffectiveDeploymentModel({
        storedProvider: "anthropic",
        storedModel: "claude-sonnet-5",
        envKey: "or-key",
        env: { OPENROUTER_API_KEY: "or-key" },
      }),
    ).toEqual({ provider: "anthropic", model: "claude-sonnet-5", key: undefined });
  });
});

describe("decryptDeploymentModelKey", () => {
  it("loads with the stable deployment secret id and swallows bad ciphertext", () => {
    const load = (ciphertext: string, recordId: string) => {
      if (recordId !== DEPLOYMENT_MODEL_SECRET_ID) throw new Error("wrong id");
      if (ciphertext === "bad") throw new Error("malformed");
      return ` ${ciphertext} `;
    };
    expect(decryptDeploymentModelKey({ load }, "sk-live")).toBe("sk-live");
    expect(decryptDeploymentModelKey({ load }, "bad")).toBeUndefined();
    expect(decryptDeploymentModelKey({ load }, null)).toBeUndefined();
  });
});
