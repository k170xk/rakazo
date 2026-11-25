/** @vitest-environment jsdom */
import type { AiConsentStatus } from "@rakazo/contracts";
import { AI_DISCLOSURE_VERSION } from "@rakazo/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { answerAiConsentPrompt, resetCapacitorAiConsentForTest } from "../lib/capacitor-ai-consent";
import { AiDataSharingSettings } from "./AiDataSharingSettings";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => `${text}${part}${values[index] ?? ""}`, ""),
  }),
}));

const statusMock = vi.hoisted(() => vi.fn());
const allowMock = vi.hoisted(() => vi.fn());
const revokeMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/rpc", () => ({
  rpc: {
    aiConsent: {
      status: (...args: unknown[]) => statusMock(...args),
      allow: (...args: unknown[]) => allowMock(...args),
      revoke: (...args: unknown[]) => revokeMock(...args),
    },
  },
}));

vi.mock("../lib/user-error", () => ({
  errorText: (cause: unknown, fallback: string) =>
    cause instanceof Error ? cause.message : fallback,
}));

vi.mock("@rakazo/ui-web", () => {
  const Passthrough = ({
    children,
    ...props
  }: { children?: ReactNode } & Record<string, unknown>) => <div {...props}>{children}</div>;
  return {
    Button: ({ children, ...props }: ComponentProps<"button">) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Switch: ({
      checked,
      onCheckedChange,
      ...props
    }: {
      checked: boolean;
      onCheckedChange?: (checked: boolean) => void;
    } & ComponentProps<"button">) => (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onCheckedChange?.(!checked)}
        {...props}
      />
    ),
    AlertDialog: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
      open ? <div>{children}</div> : null,
    AlertDialogAction: ({
      children,
      onClick,
      ...props
    }: {
      children?: ReactNode;
      onClick?: (event: { preventDefault(): void }) => void;
    } & Record<string, unknown>) => (
      <button type="button" onClick={() => onClick?.({ preventDefault() {} })} {...props}>
        {children}
      </button>
    ),
    AlertDialogCancel: ({
      children,
      onClick,
      ...props
    }: {
      children?: ReactNode;
      onClick?: () => void;
    } & Record<string, unknown>) => (
      <button type="button" onClick={onClick} {...props}>
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

const baseStatus: AiConsentStatus = {
  scope: "account-space",
  version: AI_DISCLOSURE_VERSION,
  privacyUrl: "https://example.com/app-privacy",
  recipients: [
    {
      key: "model",
      name: "Example AI",
      use: "model",
      detail: "example/model",
      privacyUrl: "https://example.com/privacy",
      allowed: true,
    },
  ],
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  resetCapacitorAiConsentForTest();
  statusMock.mockReset();
  allowMock.mockReset();
  revokeMock.mockReset();
  statusMock.mockResolvedValue(baseStatus);
  revokeMock.mockImplementation(async ({ key }: { key: string | null }) => ({
    ...baseStatus,
    recipients: baseStatus.recipients.map((recipient) =>
      key === null || recipient.key === key ? { ...recipient, allowed: false } : recipient,
    ),
  }));
  allowMock.mockResolvedValue(baseStatus);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetCapacitorAiConsentForTest();
});

it("loads recipients and can withdraw all permissions", async () => {
  await act(async () => {
    root.render(<AiDataSharingSettings />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(host.textContent).toContain("Example AI");
  expect(host.querySelector('[data-testid="ai-data-sharing-privacy"]')?.getAttribute("href")).toBe(
    baseStatus.privacyUrl,
  );

  act(() => {
    host.querySelector<HTMLButtonElement>('[data-testid="ai-data-sharing-withdraw-all"]')?.click();
  });
  act(() => {
    host
      .querySelector<HTMLButtonElement>('[data-testid="ai-data-sharing-withdraw-confirm"]')
      ?.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(revokeMock).toHaveBeenCalledWith({ key: null });
});

it("revokes a single recipient when the switch is turned off", async () => {
  await act(async () => {
    root.render(<AiDataSharingSettings />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    host.querySelector<HTMLButtonElement>('[data-testid="ai-data-sharing-toggle-model"]')?.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(revokeMock).toHaveBeenCalledWith({ key: "model" });
});

it("re-prompts before allowing a recipient again", async () => {
  statusMock.mockResolvedValue({
    ...baseStatus,
    recipients: baseStatus.recipients.map((recipient) => ({ ...recipient, allowed: false })),
  });
  await act(async () => {
    root.render(<AiDataSharingSettings />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    host.querySelector<HTMLButtonElement>('[data-testid="ai-data-sharing-toggle-model"]')?.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    answerAiConsentPrompt(true);
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(allowMock).toHaveBeenCalledExactlyOnceWith({
    scope: baseStatus.scope,
    version: baseStatus.version,
    keys: ["model"],
  });
});
