// @vitest-environment jsdom
import type { EvolveSafeguards, EvolveSafeguardsState } from "@rakazo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw(parts, ...values),
    i18n: { date: () => "11 Nov 2026, 16:00" },
  }),
}));

const limits = {
  add_project_deadline: { hour: 100, day: 200, projects: 5 },
  update_project_deadline: { hour: 60, day: 200, projects: 10 },
  add_work_package: { hour: 40, day: 100, projects: 10 },
  update_work_package: { hour: 60, day: 200, projects: 10 },
  delete_work_package: { hour: 10, day: 25, projects: 3 },
  add_project_comment: { hour: 30, day: 100, projects: 10 },
  update_project_comment: { hour: 30, day: 100, projects: 10 },
  delete_project_comment: { hour: 10, day: 30, projects: 5 },
  join_project_team: { hour: 5, day: 10, projects: 5 },
  leave_project_team: { hour: 5, day: 10, projects: 5 },
};
const defaults: EvolveSafeguards = {
  deadlinesTeamOnly: true,
  workPackagesTeamOnly: true,
  involvedMayChange: true,
  noTeamProjects: "open",
  limitsApplyToAdmins: true,
  refuseDuplicateDeadlines: true,
  maxDeadlinesPerProject: 300,
  limits,
};
const state: EvolveSafeguardsState = {
  settings: defaults,
  defaults,
  updatedAt: null,
  updatedBy: null,
  recent: [
    {
      id: "1",
      person: "Ian Crehan",
      tool: "delete_work_package",
      action: "delete",
      project: "K527 · Loughmacask",
      label: "Stage 2 drawings",
      at: "2026-11-11T15:00:00Z",
    },
  ],
};

const { rpc } = vi.hoisted(() => ({
  rpc: { companyAdmin: { evolveSafeguards: { get: vi.fn(), set: vi.fn() } } },
}));
vi.mock("../lib/rpc", () => ({ rpc }));
vi.mock("../lib/query", () => ({
  useSpaceQueries: () => ({
    companyAdmin: {
      evolveSafeguards: {
        get: {
          queryKey: () => ["safeguards"],
          queryOptions: () => ({
            queryKey: ["safeguards"],
            queryFn: rpc.companyAdmin.evolveSafeguards.get,
          }),
        },
      },
    },
  }),
}));
vi.mock("@rakazo/ui-web", async (original) => ({
  ...(await original<typeof import("@rakazo/ui-web")>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { EvolveSafeguardsSection } from "./AdminEvolveSafeguards";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  rpc.companyAdmin.evolveSafeguards.get.mockResolvedValue(state);
  rpc.companyAdmin.evolveSafeguards.set.mockImplementation(async (settings: EvolveSafeguards) => ({
    ...state,
    settings,
    updatedBy: "Keith Knox",
    updatedAt: "2026-11-11T16:00:00Z",
  }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <EvolveSafeguardsSection />
      </QueryClientProvider>,
    ),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

const button = (name: string) =>
  [...host.querySelectorAll("button")].find((item) => item.textContent === name) as
    | HTMLButtonElement
    | undefined;

async function typeNumber(label: string, value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("shows the limits and recent AI changes, and saves only after an edit", async () => {
  await render();
  expect(host.querySelector('[data-testid="safeguard-recent"]')?.textContent).toContain(
    "Stage 2 drawings",
  );
  expect(button("Save safeguards")?.disabled).toBe(true);
  await typeNumber("Delete work packages: hour", "3");
  await act(async () => button("Save safeguards")!.click());
  expect(rpc.companyAdmin.evolveSafeguards.set).toHaveBeenCalledWith({
    ...defaults,
    limits: { ...limits, delete_work_package: { hour: 3, day: 25, projects: 3 } },
  });
  expect(host.textContent).toContain("Last changed by Keith Knox");
});

it("keeps limits inside what Evolve accepts", async () => {
  await render();
  await typeNumber("Delete work packages: projects", "0");
  await typeNumber("Add deadlines: hour", "99999");
  await act(async () => button("Save safeguards")!.click());
  const saved = rpc.companyAdmin.evolveSafeguards.set.mock.calls[0]![0] as EvolveSafeguards;
  expect(saved.limits.delete_work_package.projects).toBe(1);
  expect(saved.limits.add_project_deadline.hour).toBe(1000);
});

it("explains when Evolve refuses someone who is not an Evolve admin", async () => {
  rpc.companyAdmin.evolveSafeguards.get.mockRejectedValue(
    new Error("Only Evolve admins can see or change the AI change safeguards."),
  );
  await render();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Only Evolve admins");
});
