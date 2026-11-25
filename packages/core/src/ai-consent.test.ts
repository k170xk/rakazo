import type { AiConsentStatus } from "@rakazo/contracts";
import { AI_DISCLOSURE_VERSION } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  AiConsentBlocked,
  aiConsentTarget,
  aiDataSharingPlaceholder,
  aiDataUsesForProcedure,
  aiPrivacyLinks,
  ensureAiDataConsent,
  groupAiRecipients,
} from "./ai-consent.js";

const status: AiConsentStatus = {
  scope: "account-space",
  version: AI_DISCLOSURE_VERSION,
  recipients: [
    {
      key: "model",
      name: "Example AI",
      use: "model",
      detail: "",
      privacyUrl: "https://example.com/privacy",
      allowed: false,
    },
    {
      key: "voice",
      name: "Example Voice",
      use: "voice",
      detail: "",
      privacyUrl: "https://example.com/privacy",
      allowed: false,
    },
  ],
};

describe("foreground AI consent", () => {
  it("identifies a failed preflight separately from a dispatched mutation failure", async () => {
    const check = ensureAiDataConsent({
      uses: ["model"],
      status: async () => {
        throw new Error("Offline");
      },
      prompt: vi.fn(),
      allow: vi.fn(),
    });
    await expect(check).rejects.toBeInstanceOf(AiConsentBlocked);
  });
  it("keeps the preflight failure as the cause so an unreachable server stays recognizable", async () => {
    const offline = new TypeError("Network request failed");
    const check = ensureAiDataConsent({
      uses: ["model"],
      status: async () => {
        throw offline;
      },
      prompt: vi.fn(),
      allow: vi.fn(),
    });
    await expect(check).rejects.toMatchObject({ cause: offline });
  });
  it("does not grant anything when declined", async () => {
    const allow = vi.fn();
    await expect(
      ensureAiDataConsent({
        uses: ["model"],
        status: async () => status,
        prompt: async () => false,
        allow,
      }),
    ).rejects.toThrow();
    expect(allow).not.toHaveBeenCalled();
  });
  it("only grants the disclosed feature after explicit permission, bound to the account and version", async () => {
    const order: string[] = [];
    const allow = vi.fn(async () => {
      order.push("allow");
    });
    await ensureAiDataConsent({
      uses: ["model"],
      status: async () => status,
      prompt: async () => {
        order.push("prompt");
        return true;
      },
      allow,
    });
    expect(order).toEqual(["prompt", "allow"]);
    expect(allow).toHaveBeenCalledExactlyOnceWith({
      scope: status.scope,
      version: status.version,
      keys: ["model"],
    });
  });
  it("does not prompt for already granted permissions or read-only procedures", async () => {
    const prompt = vi.fn();
    await ensureAiDataConsent({
      uses: ["model"],
      status: async () => ({
        ...status,
        recipients: status.recipients.map((item) => ({ ...item, allowed: true })),
      }),
      prompt,
      allow: vi.fn(),
    });
    expect(prompt).not.toHaveBeenCalled();
    expect(aiDataUsesForProcedure("threads/get")).toEqual([]);
    expect(aiDataUsesForProcedure("threads/send")).toEqual(["model", "memory"]);
    expect(aiDataUsesForProcedure("threads/sendWithRoutines")).toEqual(["model", "memory"]);
    expect(aiDataUsesForProcedure("voice/prepare")).toEqual(["voice"]);
    expect(
      aiDataUsesForProcedure("routines/update", { routineId: "routine", active: false }),
    ).toEqual([]);
    expect(
      aiDataUsesForProcedure("routines/update", { routineId: "routine", active: true }),
    ).toEqual(["model", "memory"]);
    expect(aiConsentTarget({ routineId: "routine-1" })).toEqual({ routineId: "routine-1" });
    expect(aiConsentTarget({ botId: "bot", text: "hello" })).toEqual({ botId: "bot" });
    // A voice request for the account's copy is asked about the account's provider.
    expect(aiConsentTarget({ text: "hello", scope: "account" })).toEqual({
      settingsScope: "account",
    });
    expect(aiConsentTarget({ botId: "bot", scope: "elsewhere" })).toEqual({ botId: "bot" });
  });
  it("coalesces concurrent prompts and grants for one account-space recipient", async () => {
    let decide!: (allowed: boolean) => void;
    const decision = new Promise<boolean>((resolve) => {
      decide = resolve;
    });
    const prompt = vi.fn(() => decision);
    const allow = vi.fn(async () => undefined);
    const first = ensureAiDataConsent({
      uses: ["model"],
      status: async () => status,
      prompt,
      allow,
    });
    const second = ensureAiDataConsent({
      uses: ["model"],
      status: async () => status,
      prompt,
      allow,
    });

    await Promise.resolve();
    expect(prompt).toHaveBeenCalledOnce();
    decide(true);
    await Promise.all([first, second]);
    expect(allow).toHaveBeenCalledExactlyOnceWith({
      scope: status.scope,
      version: status.version,
      keys: ["model"],
    });
  });
  it("does not share a pending grant across account-space scopes or recipients", async () => {
    const prompt = vi.fn(async () => true);
    const allow = vi.fn(async () => undefined);
    const statuses = [
      {
        ...status,
        scope: "account-a-space",
        recipients: [status.recipients[0]!],
      },
      {
        ...status,
        scope: "account-b-space",
        recipients: [status.recipients[0]!],
      },
      {
        ...status,
        scope: "account-a-space",
        recipients: [status.recipients[1]!],
      },
    ];

    await Promise.all(
      statuses.map((current) =>
        ensureAiDataConsent({
          uses: ["model", "voice"],
          status: async () => current,
          prompt,
          allow,
        }),
      ),
    );
    expect(prompt).toHaveBeenCalledTimes(3);
    expect(allow).toHaveBeenCalledTimes(3);
  });
  it("does not share a grant across independent API contexts", async () => {
    const prompt = vi.fn(async () => true);
    const allow = vi.fn(async () => undefined);
    await Promise.all([
      ensureAiDataConsent({
        uses: ["model"],
        status: async () => status,
        prompt,
        allow,
        coalesceKey: "https://one.example",
      }),
      ensureAiDataConsent({
        uses: ["model"],
        status: async () => status,
        prompt,
        allow,
        coalesceKey: "https://two.example",
      }),
    ]);
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(allow).toHaveBeenCalledTimes(2);
  });
});

describe("AI data sharing sections", () => {
  const model = status.recipients[0]!;

  it("stops loading on failure and keeps empty loaded status available", () => {
    expect(aiDataSharingPlaceholder(null, false)).toBe("loading");
    expect(aiDataSharingPlaceholder(null, true)).toBe("failed");
    const empty: AiConsentStatus = {
      scope: "mobile",
      version: AI_DISCLOSURE_VERSION,
      recipients: [],
    };
    expect(aiDataSharingPlaceholder(empty, false)).toBe("empty");
    expect(aiDataSharingPlaceholder(empty, true)).toBe("empty");
    expect(aiDataSharingPlaceholder({ ...empty, recipients: [model] }, false)).toBeNull();
  });

  it("groups recipients in model, voice, memory order without changing consent state", () => {
    const voice = { ...model, key: "voice", use: "voice" as const, allowed: true };
    const memory = { ...model, key: "memory", use: "memory" as const };
    expect(groupAiRecipients([memory, voice, model])).toEqual([
      { use: "model", recipients: [model] },
      { use: "voice", recipients: [voice] },
      { use: "memory", recipients: [memory] },
    ]);
    expect(groupAiRecipients([voice])).toEqual([{ use: "voice", recipients: [voice] }]);
    expect(groupAiRecipients([])).toEqual([]);
  });

  it("lists each provider policy once across models and uses, omitting missing policies", () => {
    expect(
      aiPrivacyLinks([
        model,
        { ...model, key: "other-model", detail: "example/other" },
        { ...model, key: "voice", use: "voice" },
        { ...model, key: "other-provider", name: "Other AI" },
        { ...model, key: "custom", privacyUrl: undefined },
      ]),
    ).toEqual([
      { name: model.name, url: model.privacyUrl },
      { name: "Other AI", url: model.privacyUrl },
    ]);
    expect(aiPrivacyLinks([])).toEqual([]);
  });
});
