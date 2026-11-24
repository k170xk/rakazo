import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-notifications", () => ({
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
}));
vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Linking: { openSettings: vi.fn() },
  Platform: { OS: "ios" },
}));
vi.mock("./api", () => ({ rpc: vi.fn() }));
vi.mock("./i18n", () => ({ t: (text: string) => text }));
vi.mock("./push", () => ({ registerPushToken: vi.fn() }));

import { shouldOfferPushConsentPrompt } from "./push-consent";

describe("push consent prompt", () => {
  beforeEach(() => {
    vi.stubGlobal("__DEV__", false);
  });

  it("offers only when push is on, permission is undecided, and the prompt is unseen", () => {
    expect(
      shouldOfferPushConsentPrompt({
        userId: "user-1",
        permission: "default",
        pushEnabled: true,
        promptSeen: false,
      }),
    ).toBe(true);
  });

  it("does not offer after the user answered, when push is off, or when the OS decided", () => {
    expect(
      shouldOfferPushConsentPrompt({
        userId: "user-1",
        permission: "default",
        pushEnabled: true,
        promptSeen: true,
      }),
    ).toBe(false);
    expect(
      shouldOfferPushConsentPrompt({
        userId: "user-1",
        permission: "default",
        pushEnabled: false,
        promptSeen: false,
      }),
    ).toBe(false);
    expect(
      shouldOfferPushConsentPrompt({
        userId: "user-1",
        permission: "granted",
        pushEnabled: true,
        promptSeen: false,
      }),
    ).toBe(false);
    expect(
      shouldOfferPushConsentPrompt({
        userId: "user-1",
        permission: "denied",
        pushEnabled: true,
        promptSeen: false,
      }),
    ).toBe(false);
    expect(
      shouldOfferPushConsentPrompt({
        userId: undefined,
        permission: "default",
        pushEnabled: true,
        promptSeen: false,
      }),
    ).toBe(false);
  });
});
