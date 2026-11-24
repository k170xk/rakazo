// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, createElement, useEffect } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NotificationsSettings from "../app/(settings)/notifications";

const preferenceDefaults = {
  inApp: true,
  push: true,
  actionNeeded: true,
  updates: true,
  problems: true,
};

const api = vi.hoisted(() => ({
  rpc: vi.fn(async (method: string, input?: Record<string, unknown>) => {
    if (method === "me") return { userId: "user-1" };
    if (method === "notifications/preferences") return { ...preferenceDefaults };
    if (method === "notifications/updatePreferences") {
      return { ...preferenceDefaults, ...input };
    }
    if (method === "bots/list") {
      return [
        { id: "bot-1", name: "Scout", notifyOnFinish: true },
        { id: "bot-2", name: "Clerk", notifyOnFinish: false },
      ];
    }
    if (method === "bots/update") {
      return {
        id: input?.botId,
        name: input?.botId === "bot-1" ? "Scout" : "Clerk",
        notifyOnFinish: input?.notifyOnFinish,
      };
    }
    return {};
  }),
  registerPushToken: vi.fn(async () => undefined),
  unregisterPushToken: vi.fn(async () => undefined),
  grantPushPermissionConsent: vi.fn(async () => undefined),
  markPushConsentPromptSeen: vi.fn(async () => undefined),
  readPushOsPermission: vi.fn(async () => "default" as const),
}));

const { element } = vi.hoisted(() => ({
  element:
    (tag: string) =>
    ({
      children,
      accessibilityLabel,
      onPress,
      onClick,
      disabled,
      title,
    }: {
      children?: ReactNode;
      accessibilityLabel?: string;
      onPress?: () => void;
      onClick?: () => void;
      disabled?: boolean;
      title?: string;
    }) =>
      createElement(
        tag,
        {
          "aria-label": accessibilityLabel ?? title,
          disabled,
          onClick: onPress ?? onClick,
        },
        children ?? title,
      ),
}));

vi.mock("./side-insets", () => ({ useSideInsets: () => ({}) }));
vi.mock("./native", () => ({
  native: { groupedPage: "#fff", destructive: "#f00" },
  useThemedStyles: (factory: () => unknown) => factory(),
}));
vi.mock("./i18n", () => {
  const i18n = { t: (text: string) => text };
  return { useI18n: () => i18n };
});
vi.mock("./user-error", () => ({ errorText: (_: unknown, fallback: string) => fallback }));
vi.mock("./api", () => ({
  rpc: api.rpc,
  currentApiBase: () => "https://example.test",
  loadSessionToken: vi.fn(async () => "token"),
  selectedSpaceId: () => "space-1",
}));
vi.mock("./push", () => ({
  registerPushToken: api.registerPushToken,
  unregisterPushToken: api.unregisterPushToken,
}));
vi.mock("./push-consent", () => ({
  grantPushPermissionConsent: api.grantPushPermissionConsent,
  markPushConsentPromptSeen: api.markPushConsentPromptSeen,
  readPushOsPermission: api.readPushOsPermission,
}));
vi.mock("./live-notifications", () => ({
  DEFAULT_LIVE_NOTIFICATION_SETTINGS: {
    liveConnection: false,
    messages: true,
    scheduledTasks: true,
    needsAttention: true,
  },
  getLiveNotificationSettings: vi.fn(async () => ({
    liveConnection: false,
    messages: true,
    scheduledTasks: true,
    needsAttention: true,
  })),
  setLiveNotificationSettings: vi.fn(),
  canPostPromotedNotifications: vi.fn(async () => true),
  hasLiveUpdateSettings: () => false,
  openLiveNotificationSettings: vi.fn(),
  openPromotedNotificationSettings: vi.fn(),
}));
vi.mock("expo-router", () => ({
  useFocusEffect: (effect: () => undefined | (() => void)) => useEffect(effect, [effect]),
}));
vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
  Linking: { openSettings: vi.fn() },
  Platform: { OS: "ios" },
  ScrollView: element("div"),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: element("span"),
  View: element("div"),
}));
vi.mock("../components/settings-group", () => ({
  useStackedSettings: () => false,
  SettingsGroup: ({ label, children }: { label?: string; children?: ReactNode }) =>
    createElement("section", { "aria-label": label }, label, children),
  SettingsRow: ({
    title,
    onPress,
    detail,
  }: {
    title: string;
    onPress?: () => void;
    detail?: string;
  }) =>
    createElement(
      "button",
      { type: "button", onClick: onPress },
      title,
      detail ? createElement("span", null, detail) : null,
    ),
  SettingsSwitch: ({
    label,
    value,
    disabled,
    onChange,
  }: {
    label: string;
    value: boolean;
    disabled?: boolean;
    onChange: (value: boolean) => void;
  }) =>
    createElement(
      "label",
      null,
      label,
      createElement("input", {
        type: "checkbox",
        role: "switch",
        "aria-label": label,
        checked: value,
        disabled,
        onChange: (event: { target: { checked: boolean } }) => onChange(event.target.checked),
      }),
    ),
}));

let container: HTMLDivElement;
let root: Root;

async function renderScreen() {
  await act(async () => {
    root.render(createElement(NotificationsSettings));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.rpc.mockClear();
  api.registerPushToken.mockClear();
  api.unregisterPushToken.mockClear();
  api.grantPushPermissionConsent.mockClear();
  api.markPushConsentPromptSeen.mockClear();
  api.readPushOsPermission.mockResolvedValue("default");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("loads channels and categories, and saves preference updates", async () => {
  await renderScreen();
  expect(container.textContent).toContain("Channels");
  expect(container.textContent).toContain("Notify me about");
  expect(container.textContent).toContain("Bot updates");

  const problems = container.querySelector('input[aria-label="Problems"]') as HTMLInputElement;
  expect(problems.checked).toBe(true);
  await act(async () => {
    problems.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(api.rpc).toHaveBeenCalledWith("notifications/updatePreferences", { problems: false });
});

it("requests OS permission when push is turned on", async () => {
  await renderScreen();
  const push = container.querySelector(
    'input[aria-label="Push notifications"]',
  ) as HTMLInputElement;
  expect(push.checked).toBe(true);
  await act(async () => {
    push.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(api.rpc).toHaveBeenCalledWith("notifications/updatePreferences", { push: false });
  expect(api.unregisterPushToken).toHaveBeenCalled();

  await act(async () => {
    push.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(api.rpc).toHaveBeenCalledWith("notifications/updatePreferences", { push: true });
  expect(api.grantPushPermissionConsent).toHaveBeenCalledWith("user-1");
  expect(api.registerPushToken).toHaveBeenCalledWith({ requestPermission: true });
});

it("keeps Choose bots collapsed until opened, then updates notifyOnFinish", async () => {
  await renderScreen();
  expect(container.querySelector('input[aria-label="Scout"]')).toBeNull();
  const choose = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.includes("Choose bots"),
  );
  expect(choose).toBeTruthy();
  await act(async () => {
    choose?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    await Promise.resolve();
  });
  const scout = container.querySelector('input[aria-label="Scout"]') as HTMLInputElement;
  expect(scout).toBeTruthy();
  expect(scout.checked).toBe(true);
  await act(async () => {
    scout.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(api.rpc).toHaveBeenCalledWith("bots/update", {
    botId: "bot-1",
    notifyOnFinish: false,
  });
});
