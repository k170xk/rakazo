// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EnableNotificationsDialog } from "./EnableNotificationsDialog";

const lingui = vi.hoisted(() => ({
  Trans: ({ children, message, id }: { children?: ReactNode; message?: string; id?: string }) => (
    <>{children ?? message ?? id}</>
  ),
}));
vi.mock("@lingui/react/macro", () => lingui);
vi.mock("@lingui/react", () => lingui);

vi.mock("@rakazo/ui-web", () => {
  const Passthrough = ({
    children,
    ...props
  }: { children?: ReactNode } & Record<string, unknown>) => <div {...props}>{children}</div>;
  return {
    AlertDialog: Passthrough,
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
  vi.stubGlobal("Notification", FakeNotification);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("opens after a short delay, then requests permission from Turn on", async () => {
  const onEnabled = vi.fn();
  await act(async () =>
    root.render(<EnableNotificationsDialog userId="user-1" ready onEnabled={onEnabled} />),
  );
  expect(host.querySelector('[data-testid="enable-notifications-dialog"]')).toBeNull();

  await act(async () => {
    vi.advanceTimersByTime(1_200);
  });
  expect(host.querySelector('[data-testid="enable-notifications-dialog"]')).not.toBeNull();

  const enable = host.querySelector(
    '[data-testid="enable-notifications-enable"]',
  ) as HTMLButtonElement;
  await act(async () => enable.click());
  await act(async () => undefined);

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
