// @vitest-environment jsdom
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { folders, setFolders, browse } = vi.hoisted(() => ({
  folders: vi.fn(),
  setFolders: vi.fn(),
  browse: vi.fn(),
}));

const lingui = vi.hoisted(() => ({
  t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw({ raw: parts }, ...values),
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => lingui,
  Trans: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../../lib/rpc", () => ({
  rpc: {
    connections: {
      sharePoint: { folders, setFolders, browse },
    },
  },
}));

import { SharePointFolders } from "./SharePointFolders";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  i18n.load("en", {});
  i18n.activate("en");
  folders.mockReset();
  setFolders.mockReset();
  browse.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function renderFolders(connectionId = "conn-1") {
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <SharePointFolders connectionId={connectionId} />
      </I18nProvider>,
    ),
  );
  await act(async () => undefined);
}

it("makes Choose folders the main action when none are chosen yet", async () => {
  folders.mockResolvedValueOnce([]);
  await renderFolders();
  const section = host.querySelector('[data-testid="sharepoint-folders"]')!;
  expect(section.textContent).toContain(
    "Assistants cannot read SharePoint until you choose folders",
  );
  const button = [...section.querySelectorAll("button")].find((el) =>
    el.textContent?.includes("Choose folders"),
  );
  expect(button).toBeTruthy();
  expect(button!.className).toContain("bg-primary");
});

it("keeps Choose folders available after folders are chosen", async () => {
  folders.mockResolvedValueOnce([
    {
      driveId: "d1",
      itemId: "i1",
      name: "Projects",
      location: "OCSC / Documents",
      webUrl: null,
    },
  ]);
  await renderFolders();
  expect(host.textContent).toContain("Projects");
  const button = [...host.querySelectorAll("button")].find((el) =>
    el.textContent?.includes("Choose folders"),
  );
  expect(button).toBeTruthy();
  expect(button!.className).toContain("text-muted-foreground");
  expect(button!.className).not.toContain("bg-primary");
});

it("opens the folder browser from Choose folders", async () => {
  folders.mockResolvedValueOnce([]);
  browse.mockResolvedValue([]);
  await renderFolders();
  const button = [...host.querySelectorAll("button")].find((el) =>
    el.textContent?.includes("Choose folders"),
  )!;
  await act(async () => button.click());
  expect(host.querySelector('[data-testid="sharepoint-browser"]')).toBeTruthy();
});
