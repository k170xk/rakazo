// @vitest-environment jsdom
import type { StaffLimitsState } from "@rakazo/contracts";
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
    i18n: { locale: "en-GB" },
  }),
}));

const state: StaffLimitsState = {
  defaults: { routineRunsPerDay: 1, maxActiveRoutines: 5, monthlyBudgetUsd: 50 },
  memberModels: false,
  people: [
    {
      userId: "u1",
      name: "Ian Crehan",
      email: "ian@ocsc.ie",
      routineRunsPerDay: null,
      maxActiveRoutines: null,
      monthlyBudgetUsd: null,
      modelAccess: null,
      allowedModels: [],
      activeRoutines: 2,
      spentThisMonthUsd: 61.5,
    },
  ],
};

const { rpc } = vi.hoisted(() => ({
  rpc: {
    companyAdmin: { staffLimits: { get: vi.fn(), setDefaults: vi.fn(), setPerson: vi.fn() } },
    models: { list: vi.fn() },
  },
}));
vi.mock("../lib/rpc", () => ({ rpc }));
vi.mock("../lib/query", () => ({
  useSpaceQueries: () => ({
    me: { key: () => ["me"] },
    companyAdmin: {
      staffLimits: {
        get: {
          queryKey: () => ["staff-limits"],
          queryOptions: () => ({
            queryKey: ["staff-limits"],
            queryFn: rpc.companyAdmin.staffLimits.get,
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

import { StaffLimitsSection } from "./AdminStaffLimits";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  rpc.companyAdmin.staffLimits.get.mockResolvedValue(state);
  rpc.companyAdmin.staffLimits.setDefaults.mockResolvedValue(state);
  rpc.companyAdmin.staffLimits.setPerson.mockResolvedValue(state);
  rpc.models.list.mockResolvedValue([
    { provider: "openai", id: "gpt-5", label: "GPT-5", billing: "api" },
    { provider: "anthropic", id: "claude-sonnet", label: "Claude Sonnet", billing: "api" },
  ]);
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
        <StaffLimitsSection />
      </QueryClientProvider>,
    ),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

const button = (name: string) =>
  [...host.querySelectorAll("button")].find((item) => item.textContent === name) as
    | HTMLButtonElement
    | undefined;

async function setValue(selector: string, value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
    const proto =
      input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}

it("saves the company limits", async () => {
  await render();
  await setValue("#limit-runs", "2");
  await setValue("#limit-budget", "");
  await act(async () => button("Save company limits")!.click());
  expect(rpc.companyAdmin.staffLimits.setDefaults).toHaveBeenCalledWith({
    routineRunsPerDay: 2,
    maxActiveRoutines: 5,
    monthlyBudgetUsd: null,
  });
});

it("shows who is over budget and saves one person's overrides and models", async () => {
  await render();
  expect(host.textContent).toContain("2 / 5");
  expect(host.querySelector(".text-destructive")?.textContent).toContain("61.50");
  await act(async () => button("Edit")!.click());
  await setValue("#runs-u1", "3");
  await setValue("#budget-u1", "none");
  await setValue("#models-u1", "choose");
  await act(async () => {
    host.querySelector<HTMLButtonElement>('[id="allowed-openai/gpt-5"]')!.click();
  });
  await act(async () => button("Save")!.click());
  expect(rpc.companyAdmin.staffLimits.setPerson).toHaveBeenCalledWith({
    userId: "u1",
    routineRunsPerDay: 3,
    maxActiveRoutines: null,
    monthlyBudgetUsd: "none",
    modelAccess: "choose",
    allowedModels: ["openai/gpt-5"],
  });
});
