/** @vitest-environment jsdom */
import type { AiConsentStatus } from "@rakazo/contracts";
import { AI_CONSENT_REQUIRED, AI_DISCLOSURE_VERSION } from "@rakazo/contracts";
import { AiConsentBlocked } from "@rakazo/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  answerAiConsentPrompt,
  ensureCapacitorAiConsent,
  getAiConsentPrompt,
  isCapacitorNative,
  promptCapacitorAiConsent,
  resetCapacitorAiConsentForTest,
  setCapacitorNativeForTest,
  subscribeAiConsentPrompt,
} from "./capacitor-ai-consent";

afterEach(() => {
  resetCapacitorAiConsentForTest();
});

const status: AiConsentStatus = {
  scope: "account-space",
  version: AI_DISCLOSURE_VERSION,
  recipients: [
    {
      key: "model",
      name: "Example AI",
      use: "model",
      detail: "example/model",
      privacyUrl: "https://example.com/privacy",
      allowed: false,
    },
  ],
  privacyUrl: "https://example.com/app-privacy",
};

describe("Capacitor AI consent", () => {
  it("is a no-op outside the Capacitor shell", async () => {
    setCapacitorNativeForTest(false);
    const statusFn = vi.fn(async () => status);
    await ensureCapacitorAiConsent({
      uses: ["model"],
      status: statusFn,
      allow: vi.fn(),
    });
    expect(isCapacitorNative()).toBe(false);
    expect(statusFn).not.toHaveBeenCalled();
  });

  it("prompts, grants, and proceeds when Allow is chosen", async () => {
    setCapacitorNativeForTest(true);
    const allow = vi.fn(async () => status);
    const pending = ensureCapacitorAiConsent({
      uses: ["model"],
      spaceId: "space-1",
      target: { botId: "bot-1" },
      status: async () => status,
      allow,
    });
    await Promise.resolve();
    expect(getAiConsentPrompt()?.recipient.name).toBe("Example AI");
    answerAiConsentPrompt(true);
    await pending;
    expect(allow).toHaveBeenCalledExactlyOnceWith({
      scope: status.scope,
      version: status.version,
      keys: ["model"],
    });
    expect(getAiConsentPrompt()).toBeNull();
  });

  it("blocks the action when Not now is chosen", async () => {
    setCapacitorNativeForTest(true);
    const allow = vi.fn();
    const pending = ensureCapacitorAiConsent({
      uses: ["model"],
      status: async () => status,
      allow,
    });
    await Promise.resolve();
    answerAiConsentPrompt(false);
    await expect(pending).rejects.toBeInstanceOf(AiConsentBlocked);
    await expect(pending).rejects.toThrow(AI_CONSENT_REQUIRED);
    expect(allow).not.toHaveBeenCalled();
  });

  it("keeps prompts separate across Spaces", async () => {
    setCapacitorNativeForTest(true);
    const allow = vi.fn(async () => undefined);

    const first = ensureCapacitorAiConsent({
      uses: ["model"],
      spaceId: "space-a",
      status: async () => status,
      allow,
    });
    await Promise.resolve();
    expect(getAiConsentPrompt()).not.toBeNull();
    answerAiConsentPrompt(true);
    await first;

    const second = ensureCapacitorAiConsent({
      uses: ["model"],
      spaceId: "space-b",
      status: async () => status,
      allow,
    });
    await Promise.resolve();
    expect(getAiConsentPrompt()).not.toBeNull();
    answerAiConsentPrompt(true);
    await second;

    expect(allow).toHaveBeenCalledTimes(2);
  });

  it("notifies subscribers when a prompt opens and closes", async () => {
    const listener = vi.fn();
    const stop = subscribeAiConsentPrompt(listener);
    const pending = promptCapacitorAiConsent(status.recipients[0]!, status.privacyUrl);
    expect(listener).toHaveBeenCalledOnce();
    expect(getAiConsentPrompt()?.privacyUrl).toBe(status.privacyUrl);
    answerAiConsentPrompt(true);
    await expect(pending).resolves.toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });
});
