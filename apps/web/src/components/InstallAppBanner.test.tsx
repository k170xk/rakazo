// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InstallAppBanner } from "./InstallAppBanner";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

const EVOLVE = "https://evolve.ocsc.me";
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const parent = { postMessage: vi.fn() };

beforeEach(() => {
  localStorage.clear();
  parent.postMessage.mockReset();
  vi.spyOn(window, "parent", "get").mockReturnValue(parent as never);
  vi.spyOn(window, "top", "get").mockReturnValue(parent as never);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

it("inside Evolve's frame, asks Evolve to open the app in a signed-in window", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  await act(async () => root.render(<InstallAppBanner />));
  expect(parent.postMessage).toHaveBeenCalledWith({ type: "ocsc-intelligence:hello" }, "*");

  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: parent as never,
        origin: EVOLVE,
        data: { type: "ocsc-intelligence:host", openStandalone: true },
      }),
    );
  });
  const button = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Open in its own window"),
  )!;
  await act(async () => button.click());

  expect(parent.postMessage).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: "ocsc-intelligence:open-standalone" }),
    EVOLVE,
  );
  expect(open).not.toHaveBeenCalled();
  expect(host.querySelector('[data-testid="install-app-banner"]')).toBeNull();
});

it("opens the app itself when the framing page does not offer to", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  await act(async () => root.render(<InstallAppBanner />));
  const button = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Open in its own window"),
  )!;
  await act(async () => button.click());
  expect(open).toHaveBeenCalledWith(`${location.origin}/`, "_blank", "noopener");
});

it("stays closed after Not now", async () => {
  await act(async () => root.render(<InstallAppBanner />));
  const notNow = [...host.querySelectorAll("button")].find((b) => b.textContent === "Not now")!;
  await act(async () => notNow.click());
  await act(async () => root.render(<InstallAppBanner key="again" />));
  expect(host.querySelector('[data-testid="install-app-banner"]')).toBeNull();
});
