// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EnableNotificationsDialog } from "./EnableNotificationsDialog";
import { resetNativePushForTest, setNativePushAppIdForTest } from "../lib/capacitor-push";

const lingui = vi.hoisted(() => ({
  Trans: ({ children, message, id }: { children?: ReactNode; message?: string; id?: string }) => (
    <>{children ?? message ?? id}</>
  ),
}));
vi.mock("@lingui/react/macro", () => lingui);
vi.mock("@lingui/react", () => lingui);

const updatePreferences = vi.hoisted(() => vi.fn(async () => ({ inApp: true, push: true })));
vi.mock("../lib/rpc", () => ({
  rpc: {
    notifications: {
      updatePreferences,
    },
  },
}));

vi.mock("@rakazo/ui-web", () => {
  const Passthrough = ({
    children,
    ...props
  }: { children?: ReactNode } & Record<string, unknown>) => <div {...props}>{children}</div>;
  return {
    AlertDialog: ({
      children,
      open,
    }: {
      children?: ReactNode;
      open?: boolean;
    }) => (open ? <div>{children}</div> : null),
    AlertDialogAction: ({
      children,
      onClick,
      disabled,
      ...props
    }: {
      children?: ReactNode;
      onClick?: (event: { preventDefault(): void }) => void;
      disabled?: boolean;
    } & Record<string, unknown>) => (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onClick?.({ preventDefault() {} })}
        {...props}
      >
        {children}
      </button>
    ),
    AlertDialogCancel: ({
      children,
      onClick,
      disabled,
      ...props
    }: {
      children?: ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    } & Record<string, unknown>) => (
      <button type="button" disabled={disabled} onClick={onClick} {...props}>
        {children}
      </button>
    ),
    AlertDialogContent: Passthrough,
    AlertDialogDescription: Passthrough,
    AlertDialogFooter: Passthrough,
    AlertDialogHeader: Passthrough,
    AlertDialogTitle: Passthrough,
  };
});

class FakeNotification {
  static permission: NotificationPermission = "default";
  static requestPermission = vi.fn(async () => {
    FakeNotification.permission = "granted";
    return "granted" as NotificationPermission;
  });
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  FakeNotification.permission = "default";
  FakeNotification.requestPermission.mockClear();
  updatePreferences.mockClear();
  vi.stubGlobal("Notification", FakeNotification);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetNativePushForTest();
  Reflect.deleteProperty(globalThis, "Capacitor");
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("opens after a short delay with approved copy, then enables preferences before permission", async () => {
  const onEnabled = vi.fn();
  await act(async () =>
    root.render(<EnableNotificationsDialog userId="user-1" ready onEnabled={onEnabled} />),
  );
  expect(host.querySelector('[data-testid="enable-notifications-dialog"]')).toBeNull();

  await act(async () => {
    vi.advanceTimersByTime(1_200);
  });
  const dialog = host.querySelector('[data-testid="enable-notifications-dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog?.textContent).toContain("Stay in the loop");
  expect(dialog?.textContent).toContain(
    "Get notified when a bot needs you or finishes important work.",
  );
  expect(dialog?.textContent).toContain("Enable notifications");
  expect(dialog?.textContent).toContain("Not now");

  const enable = host.querySelector(
    '[data-testid="enable-notifications-enable"]',
  ) as HTMLButtonElement;
  await act(async () => enable.click());
  await act(async () => undefined);

  expect(updatePreferences).toHaveBeenCalledWith({ inApp: true, push: true });
  expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  expect(onEnabled).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem("rakazo:notifications-prompt:v1:user-1")).toBe("1");
  expect(host.querySelector('[data-testid="enable-notifications-dialog"]')).toBeNull();
});

it("stays closed after Not now", async () => {
  await act(async () => root.render(<EnableNotificationsDialog userId="user-1" ready />));
  await act(async () => {
    vi.advanceTimersByTime(1_200);
  });
  const notNow = host.querySelector(
    '[data-testid="enable-notifications-not-now"]',
  ) as HTMLButtonElement;
  await act(async () => notNow.click());

  await act(async () =>
    root.render(<EnableNotificationsDialog key="again" userId="user-1" ready />),
  );
  await act(async () => {
    vi.advanceTimersByTime(1_200);
  });
  expect(host.querySelector('[data-testid="enable-notifications-dialog"]')).toBeNull();
});

it("does not open when permission is already decided", async () => {
  FakeNotification.permission = "granted";
  await act(async () => root.render(<EnableNotificationsDialog userId="user-1" ready />));
  await act(async () => {
    vi.advanceTimersByTime(1_200);
  });
  expect(host.querySelector('[data-testid="enable-notifications-dialog"]')).toBeNull();
});

it("prompts via Capacitor.Plugins.OneSignalCapacitor and binds the user on Allow", async () => {
  vi.stubGlobal("Notification", undefined);
  setNativePushAppIdForTest("app-public");
  const initialize = vi.fn(async () => undefined);
  const permissionNative = vi.fn(async () => ({ permission: 0 }));
  const requestPermission = vi.fn(async () => ({ permission: true }));
  const login = vi.fn(async () => undefined);
  (globalThis as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    isPluginAvailable: (name: string) => name === "OneSignalCapacitor",
    Plugins: {
      OneSignalCapacitor: {
        initialize,
        permissionNative,
        requestPermission,
        login,
      },
    },
  };

  await act(async () => root.render(<EnableNotificationsDialog userId="user-1" ready />));
  await act(async () => {
    vi.advanceTimersByTime(1_200);
  });

  const enable = host.querySelector(
    '[data-testid="enable-notifications-enable"]',
  ) as HTMLButtonElement | null;
  expect(enable).not.toBeNull();

  await act(async () => enable?.click());
  await act(async () => undefined);

  expect(initialize).toHaveBeenCalledTimes(1);
  expect(initialize).toHaveBeenCalledWith({ appId: "app-public" });
  expect(permissionNative).toHaveBeenCalled();
  expect(requestPermission).toHaveBeenCalledWith({ fallbackToSettings: false });
  expect(login).toHaveBeenCalledWith({ externalId: "user-1" });
});
