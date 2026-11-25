/** @vitest-environment jsdom */
import type { AiRecipient } from "@rakazo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  getAiConsentPrompt,
  promptCapacitorAiConsent,
  resetCapacitorAiConsentForTest,
} from "../lib/capacitor-ai-consent";
import { AiConsentDialog } from "./AiConsentDialog";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
}));

vi.mock("@rakazo/ui-web", () => {
  const Passthrough = ({
    children,
    ...props
  }: { children?: ReactNode } & Record<string, unknown>) => <div {...props}>{children}</div>;
  return {
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

const recipient: AiRecipient = {
  key: "model",
  name: "Example AI",
  use: "model",
  detail: "example/model",
  privacyUrl: "https://example.com/provider-privacy",
  allowed: false,
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  resetCapacitorAiConsentForTest();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetCapacitorAiConsentForTest();
});

it("names the provider and resolves Allow / Not now", async () => {
  act(() => {
    root.render(<AiConsentDialog />);
  });
  let allowed: Promise<boolean>;
  act(() => {
    allowed = promptCapacitorAiConsent(recipient, "https://example.com/app-privacy");
  });
  expect(host.textContent).toContain("Example AI");
  expect(host.querySelector('[data-testid="ai-consent-provider-privacy"]')?.getAttribute("href")).toBe(
    recipient.privacyUrl,
  );
  expect(host.querySelector('[data-testid="ai-consent-privacy"]')?.getAttribute("href")).toBe(
    "https://example.com/app-privacy",
  );

  act(() => {
    host.querySelector<HTMLButtonElement>('[data-testid="ai-consent-allow"]')?.click();
  });
  await expect(allowed!).resolves.toBe(true);
  expect(getAiConsentPrompt()).toBeNull();

  act(() => {
    allowed = promptCapacitorAiConsent(recipient);
  });
  act(() => {
    host.querySelector<HTMLButtonElement>('[data-testid="ai-consent-not-now"]')?.click();
  });
  await expect(allowed!).resolves.toBe(false);
});
