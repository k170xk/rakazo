// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const preferenceDefaults = {
  inApp: true,
  push: true,
  actionNeeded: true,
  updates: true,
  problems: true,
};

const api = vi.hoisted(() => ({
  notifications: {
    preferences: vi.fn(async () => ({ ...preferenceDefaults })),
    updatePreferences: vi.fn(async (patch: Partial<typeof preferenceDefaults>) => ({
      ...preferenceDefaults,
      ...patch,
    })),
  },
  bots: {
    list: vi.fn(async () => [
      { id: "bot-1", name: "Scout", notifyOnFinish: true },
      { id: "bot-2", name: "Clerk", notifyOnFinish: false },
    ]),
    update: vi.fn(async ({ botId, notifyOnFinish }: { botId: string; notifyOnFinish: boolean }) => ({
      id: botId,
      name: botId === "bot-1" ? "Scout" : "Clerk",
      notifyOnFinish,
    })),
  },
}));

vi.mock("../lib/rpc", () => ({
  rpc: api,
  rpcForSpace: () => api,
  createSpaceRpc: () => api,
  selectedSpaceId: () => null,
}));

vi.mock("../lib/capacitor-push", () => ({
  nativePushAvailable: () => false,
  nativePushPermissionState: vi.fn(async () => "default"),
  openNativePushSettings: vi.fn(),
  requestNativePushPermission: vi.fn(async () => false),
  syncNativePushUser: vi.fn(async () => undefined),
}));

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw({ raw: parts }, ...values),
    i18n: { locale: "en" },
  }),
  Trans: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock("@lingui/react", () => {
  type Descriptor = { id?: string; message?: string; values?: Record<string, unknown> };
  const format = (d: Descriptor | string) =>
    typeof d === "string"
      ? d
      : (d.message ?? d.id ?? "").replace(/\{(\w+)\}/g, (_, key: string) =>
          String(d.values?.[key] ?? ""),
        );
  const tagged = (parts: TemplateStringsArray, ...values: unknown[]) =>
    String.raw({ raw: parts }, ...values);
  const i18n = { locale: "en", _: format, t: format };
  return {
    useLingui: () => ({ i18n, _: format, t: tagged }),
    Trans: (props: Descriptor & { children?: ReactNode }) => props.children ?? format(props),
    I18nProvider: ({ children }: { children?: ReactNode }) => children,
  };
});

vi.mock("@rakazo/ui-web", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => (
    <button type="button" disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  ),
  Switch: ({
    checked,
    disabled,
    onCheckedChange,
    "aria-label": ariaLabel,
  }: {
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    "aria-label"?: string;
  }) => (
    <input
      type="checkbox"
      role="switch"
      aria-label={ariaLabel}
      checked={Boolean(checked)}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

import { NotificationsSettingsPanel } from "./NotificationsSettingsPanel";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;

async function renderPanel() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NotificationsSettingsPanel />
      </QueryClientProvider>,
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(0));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  class FakeNotification {
    static permission: NotificationPermission = "default";
    static requestPermission = vi.fn(async () => {
      FakeNotification.permission = "granted";
      return "granted" as NotificationPermission;
    });
  }
  vi.stubGlobal("Notification", FakeNotification);
  api.notifications.preferences.mockClear();
  api.notifications.updatePreferences.mockClear();
  api.bots.list.mockClear();
  api.bots.update.mockClear();
  api.notifications.preferences.mockResolvedValue({ ...preferenceDefaults });
  api.notifications.updatePreferences.mockImplementation(
    async (patch: Partial<typeof preferenceDefaults>) => ({
      ...preferenceDefaults,
      ...patch,
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("toggles preference categories through updatePreferences", async () => {
  await renderPanel();
  const panel = container.querySelector('[data-testid="notifications-settings"]');
  expect(panel).not.toBeNull();
  expect(panel?.textContent).toContain("In-app notifications");
  expect(panel?.textContent).toContain("Action needed");

  const problems = container.querySelector(
    'input[aria-label="Problems"]',
  ) as HTMLInputElement;
  expect(problems.checked).toBe(true);
  await act(async () => {
    problems.click();
  });
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(api.notifications.updatePreferences).toHaveBeenCalledWith({ problems: false });
});

it("keeps Choose bots collapsed until opened, then updates notifyOnFinish", async () => {
  await renderPanel();
  expect(container.textContent).not.toContain("Scout");

  const choose = container.querySelector(
    '[data-testid="notifications-choose-bots"]',
  ) as HTMLButtonElement;
  expect(choose.getAttribute("aria-expanded")).toBe("false");
  await act(async () => choose.click());
  expect(choose.getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).toContain("Scout");
  expect(container.textContent).toContain("Clerk");

  const clerk = container.querySelector(
    'input[aria-label="Notify when Clerk finishes or needs you"]',
  ) as HTMLInputElement;
  expect(clerk.checked).toBe(false);
  await act(async () => clerk.click());
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(api.bots.update).toHaveBeenCalledWith({ botId: "bot-2", notifyOnFinish: true });
});

it("turns push on by updating preferences then requesting permission", async () => {
  api.notifications.preferences.mockResolvedValue({ ...preferenceDefaults, push: false });
  await renderPanel();
  const push = container.querySelector(
    'input[aria-label="Push notifications"]',
  ) as HTMLInputElement;
  expect(push.checked).toBe(false);
  await act(async () => push.click());
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(api.notifications.updatePreferences).toHaveBeenCalledWith({ push: true });
  expect(
    (globalThis.Notification as unknown as { requestPermission: ReturnType<typeof vi.fn> })
      .requestPermission,
  ).toHaveBeenCalled();
});
