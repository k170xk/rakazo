// @vitest-environment jsdom
import type { DesktopUpdateState } from "@rakazo/contracts";
import { Toaster } from "@rakazo/ui-web";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopUpdatesProvider } from "./DesktopUpdates";
import { SidebarFooter, sidebarMarkCount } from "./SidebarFooter";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.rakazoDesktop;
  vi.restoreAllMocks();
});
async function render(
  name = "Demo User",
  image?: string,
  onIntegrations = vi.fn(),
  onBoard?: () => void,
  logos?: Array<{ name: string; logo?: string }>,
) {
  const email = "account@rakazo.test";
  await act(async () =>
    root.render(
      <DesktopUpdatesProvider>
        <SidebarFooter
          logos={logos}
          name={name}
          initials={name
            .split(" ")
            .map((part) => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
          image={image}
          email={email}
          open
          onOpenChange={() => {}}
          onIntegrations={onIntegrations}
          onSkills={vi.fn()}
          onBoard={onBoard}
          onArtifacts={() => {}}
          onSettings={() => {}}
          onLogOut={() => {}}
          signingOut={false}
          logOutError={null}
        />
        <Toaster />
      </DesktopUpdatesProvider>,
    ),
  );
}
function bridge(phase: DesktopUpdateState["phase"]) {
  const state: DesktopUpdateState = {
    phase,
    currentVersion: "0.1.0",
    availableVersion: "0.2.0",
    percent: null,
    message: null,
    checkedAt: null,
  };
  const install = vi.fn(async () => state);
  window.rakazoDesktop = {
    platform: "darwin",
    window: {
      close: async () => {},
      minimize: async () => {},
      toggleMaximize: async () => {},
      state: async () => ({ minimized: false, maximized: false, fullScreen: false }),
    },
    oauth: { onCallback: () => () => {} },
    update: {
      state: async () => state,
      install,
      download: async () => state,
      check: async () => state,
    },
  };
  return install;
}
it("hides update controls without a desktop bridge", async () => {
  await render();
  expect(document.querySelector('[aria-label="Install update"]')).toBeNull();
  expect(document.body.textContent).not.toContain("New update available");
});
it.each(["unsupported", "idle", "available", "downloading", "checking", "error"] as const)(
  "hides install controls in phase %s",
  async (phase) => {
    bridge(phase);
    await render();
    expect(document.querySelector('[aria-label="Install update"]')).toBeNull();
    expect(document.body.textContent).not.toContain("New update available");
  },
);
it("installs the ready update only through the footer button", async () => {
  const install = bridge("ready");
  await render("Ada Lovelace");
  const icon = document.querySelector<HTMLButtonElement>('[aria-label="Install update"]')!;
  expect(icon).not.toBeNull();
  expect(document.body.textContent).not.toContain("New update available");
  await act(async () => icon.click());
  expect(install).toHaveBeenCalledTimes(1);
  expect(
    [...document.querySelectorAll("button")].some((button) => button.textContent === "Install"),
  ).toBe(false);
});
it("shows the account image and falls back to the initial after a load error", async () => {
  await render("Ada Lovelace", "https://example.test/avatar.png");
  const trigger = host.querySelector('[data-testid="user-menu-trigger"]')!;
  const image = trigger.querySelector("img")!;
  expect(image.src).toBe("https://example.test/avatar.png");
  await act(async () => image.dispatchEvent(new Event("error")));
  expect(trigger.querySelector("img")).toBeNull();
  expect(trigger.textContent).toBe("AL");
});

it("opens integrations and keeps the existing account actions and links", async () => {
  const onIntegrations = vi.fn();
  await render("Demo User", undefined, onIntegrations, vi.fn());
  const connect = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Connect apps"),
  )!;
  await act(async () => connect.click());
  expect(onIntegrations).toHaveBeenCalledOnce();
  const menu = document.querySelector('[data-slot="popover-content"]')!;
  const rows = menu.querySelectorAll('button:not([data-testid^="menu-appearance-"]), a');
  expect([...rows].map((row) => row.textContent)).toEqual([
    "Settings",
    "Tools and skills",
    "Artifacts",
    "Board",
    "Log out",
  ]);
  const appearance = [...menu.querySelectorAll('[data-testid^="menu-appearance-"]')];
  expect(appearance.map((button) => button.getAttribute("aria-label"))).toEqual([
    "Light",
    "Dark",
    "System",
  ]);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  await act(async () => (appearance[1] as HTMLButtonElement).click());
  expect(document.documentElement.dataset.theme).toBe("dark");
  await act(async () => (appearance[0] as HTMLButtonElement).click());
  expect(document.documentElement.dataset.theme).toBe("light");
  vi.unstubAllGlobals();
  expect(host.querySelector('[data-testid="user-menu-trigger"]')?.getAttribute("aria-label")).toBe(
    "Account menu for Demo User",
  );
});
it("offers a new work space from the account menu and opens the create dialog", async () => {
  const onCreateWorkSpace = vi.fn();
  await act(async () =>
    root.render(
      <DesktopUpdatesProvider>
        <SidebarFooter
          name="Demo User"
          initials="DU"
          email="account@rakazo.test"
          open
          onOpenChange={() => {}}
          onSkills={() => {}}
          onArtifacts={() => {}}
          onSettings={() => {}}
          onCreateWorkSpace={onCreateWorkSpace}
          onLogOut={() => {}}
          signingOut={false}
          logOutError={null}
        />
      </DesktopUpdatesProvider>,
    ),
  );
  const create = document.querySelector<HTMLButtonElement>(
    '[data-testid="account-new-work-space"]',
  )!;
  expect(create.getAttribute("aria-label")).toBe("Create work space");
  expect(document.querySelector('[data-testid="account-work-spaces"]')?.textContent).toContain(
    "Work spaces",
  );
  await act(async () => create.click());
  expect(onCreateWorkSpace).toHaveBeenCalledOnce();
});
it("omits Board when unavailable", async () => {
  await render();
  expect(document.querySelector('[data-slot="popover-content"]')?.textContent).not.toContain(
    "Board",
  );
});

it("links to neither the mobile app nor the docs", async () => {
  await render();
  const menu = document.querySelector('[data-slot="popover-content"]')!;
  expect(menu.textContent).not.toContain("Get the mobile app");
  expect(menu.textContent).not.toContain("Docs");
  expect(menu.querySelector("a")).toBeNull();
});

it("falls back when app artwork fails and accepts replacement artwork", async () => {
  await render("Demo User", undefined, undefined, undefined, [
    { name: "Slack", logo: "https://example.test/slack.svg" },
  ]);
  const pill = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Connect apps"),
  )!;
  await act(async () => pill.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(pill.querySelector("img")).toBeNull();
  expect(pill.textContent).toContain("S");
  await render("Demo User", undefined, undefined, undefined, [
    { name: "Slack", logo: "https://example.test/new-slack.svg" },
  ]);
  expect(pill.querySelector("img")?.src).toBe("https://example.test/new-slack.svg");
});
it.each(["throw", "state"] as const)(
  "reveals a %s install failure after Later",
  async (failure) => {
    const install = bridge("ready");
    if (failure === "throw") install.mockRejectedValueOnce(new Error("offline"));
    else
      install.mockResolvedValueOnce({
        ...(await window.rakazoDesktop!.update.state()),
        phase: "error",
        message: "Update could not be installed",
      });
    await render();
    // The notice is a toast, which mounts and leaves on the toaster's own timers.
    const notice = () => document.querySelector('[aria-label="Desktop update"]');
    const later = () =>
      [...notice()!.querySelectorAll("button")].find((button) => button.textContent === "Later")!;
    await vi.waitFor(() => expect(notice()).not.toBeNull());
    await act(async () => later().click());
    await vi.waitFor(() => expect(notice()).toBeNull());
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Install update"]')!.click(),
    );
    await vi.waitFor(() =>
      expect(notice()?.querySelector('[role="status"]')?.textContent).toBe(
        failure === "throw"
          ? "Could not complete the update. Try again."
          : "Update could not be installed",
      ),
    );
    await act(async () => later().click());
    await vi.waitFor(() => expect(notice()).toBeNull());
  },
);

it.each([
  [-20, 0],
  [0, 0],
  [25, 0],
  [26, 1],
  [47, 1],
  [48, 2],
  [69, 2],
  [70, 3],
  [200, 3],
])("fits marks into %ipx without consuming label or padding space", (width, count) => {
  expect(sidebarMarkCount(width)).toBe(count);
});

it("keeps at most three marks with the same tile and a missing-logo fallback", async () => {
  await render("Demo User", undefined, undefined, undefined, [
    { name: "Gmail", logo: "https://example.test/gmail.svg" },
    { name: "Notion" },
    { name: "GitHub", logo: "https://example.test/github.svg" },
    { name: "Slack" },
  ]);
  const tiles = [...host.querySelectorAll('span[aria-hidden="true"] > span')];
  expect(tiles).toHaveLength(3);
  expect(new Set(tiles.map((tile) => tile.className)).size).toBe(1);
  expect(tiles[1]!.textContent).toBe("N");
});

const personal = {
  id: "org-personal",
  name: "Personal",
  defaultSpaceId: "s1",
  spaceIds: ["s1"],
  canManage: true,
};
const work = {
  id: "org-work",
  name: "Work",
  defaultSpaceId: "s2",
  spaceIds: ["s2"],
  canManage: true,
};

async function renderOrganizations(
  organizations: Array<typeof personal & { permanent?: boolean }>,
  onSwitchOrganization = vi.fn(),
  manage: {
    onRenameOrganization?: (organization: typeof personal, name: string) => Promise<void>;
    onDeleteOrganization?: (organization: typeof personal) => void;
  } = {},
) {
  await act(async () =>
    root.render(
      <DesktopUpdatesProvider>
        <SidebarFooter
          name="Demo User"
          initials="DU"
          email="account@rakazo.test"
          open
          onOpenChange={() => {}}
          onIntegrations={() => {}}
          onSkills={() => {}}
          onArtifacts={() => {}}
          onSettings={() => {}}
          onLogOut={() => {}}
          signingOut={false}
          logOutError={null}
          organizations={organizations}
          activeOrganizationId="org-personal"
          onSwitchOrganization={onSwitchOrganization}
          {...manage}
        />
      </DesktopUpdatesProvider>,
    ),
  );
  return [...document.querySelector('[data-slot="popover-content"]')!.querySelectorAll("button")];
}

it("shows no organization rows with one organization", async () => {
  const rows = await renderOrganizations([personal]);
  expect(rows[0]!.textContent).toBe("Settings");
});

it("lists two organizations with the active one checked", async () => {
  const onSwitch = vi.fn();
  const rows = await renderOrganizations([personal, work], onSwitch);
  expect(rows.map((row) => row.textContent).slice(0, 3)).toEqual(["Personal", "Work", "Settings"]);
  expect(rows[0]!.getAttribute("aria-current")).toBe("true");
  expect(rows[0]!.querySelector("svg")).not.toBeNull();
  expect(rows[1]!.hasAttribute("aria-current")).toBe(false);
  expect(rows[1]!.querySelector("svg")).toBeNull();
  await act(async () => rows[1]!.click());
  expect(onSwitch).toHaveBeenCalledWith(work);
});

const menuButton = (label: string) =>
  document.querySelector<HTMLButtonElement>(
    `[data-slot="popover-content"] button[aria-label="${label}"]`,
  );

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("renames a work space in place from its pen", async () => {
  const onRename = vi.fn(async () => undefined);
  await renderOrganizations([personal, work], vi.fn(), { onRenameOrganization: onRename });
  await act(async () => menuButton("Rename Work")!.click());
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid="organization-rename-input"]',
  )!;
  expect(input.value).toBe("Work");
  await typeInto(input, "  Client work ");
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(onRename).toHaveBeenCalledWith(work, "Client work");
  expect(document.querySelector('[data-testid="organization-rename-input"]')).toBeNull();
});

it("keeps the name when a rename is cancelled with Escape", async () => {
  const onRename = vi.fn(async () => undefined);
  await renderOrganizations([personal, work], vi.fn(), { onRenameOrganization: onRename });
  await act(async () => menuButton("Rename Work")!.click());
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid="organization-rename-input"]',
  )!;
  await typeInto(input, "Other");
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(onRename).not.toHaveBeenCalled();
  expect(document.querySelector('[data-testid="organization-rename-input"]')).toBeNull();
});

it("shows the rename error and keeps the field open", async () => {
  const onRename = vi.fn(async () => {
    throw new Error("Work space name must be readable");
  });
  await renderOrganizations([personal, work], vi.fn(), { onRenameOrganization: onRename });
  await act(async () => menuButton("Rename Work")!.click());
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid="organization-rename-input"]',
  )!;
  await typeInto(input, "!!!");
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("readable");
  expect(document.querySelector('[data-testid="organization-rename-input"]')).not.toBeNull();
});

it("offers delete only where it is allowed and hands the choice to the caller", async () => {
  const onDelete = vi.fn();
  const company = { ...personal, id: "org-ocsc", name: "OCSC", permanent: true };
  const viewer = { ...work, id: "org-viewer", name: "Shared", canManage: false };
  await renderOrganizations([company, work, viewer], vi.fn(), {
    onRenameOrganization: vi.fn(async () => undefined),
    onDeleteOrganization: onDelete,
  });
  expect(menuButton("Delete OCSC")).toBeNull();
  expect(menuButton("Delete Shared")).toBeNull();
  expect(menuButton("Rename Shared")).toBeNull();
  expect(menuButton("Rename OCSC")).not.toBeNull();
  await act(async () => menuButton("Delete Work")!.click());
  expect(onDelete).toHaveBeenCalledWith(work);
});

it("never offers to delete the last work space someone manages", async () => {
  const viewer = { ...work, canManage: false };
  await renderOrganizations([personal, viewer], vi.fn(), { onDeleteOrganization: vi.fn() });
  expect(menuButton("Delete Personal")).toBeNull();
});
