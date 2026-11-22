// @vitest-environment jsdom
import type { CompanyAdminState } from "@rakazo/contracts";
import { DEFAULT_COMPANY_FEATURES, DEFAULT_EMAIL_FILING_POLICY } from "@rakazo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw(parts, ...values),
    i18n: {
      locale: "en-GB",
      date: (value: Date) => value.toISOString(),
    },
  }),
}));

const { rpc } = vi.hoisted(() => ({
  rpc: {
    companyAdmin: {
      setTools: vi.fn(),
      setFeatures: vi.fn(),
      checkTools: vi.fn(),
    },
  },
}));
vi.mock("../lib/rpc", () => ({ rpc }));
vi.mock("@rakazo/ui-web", async (original) => ({
  ...(await original<typeof import("@rakazo/ui-web")>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { CompanyToolsSection } from "./AdminCompanyTools";

function baseState(): CompanyAdminState {
  return {
    model: null,
    thinkingLevel: null,
    assistantModels: {},
    companySkills: [],
    assistantConfigs: {},
    staffApps: null,
    catalogItems: {},
    access: { groups: [], featureAudiences: {}, appAudiences: {} },
    environmentModel: null,
    features: { ...DEFAULT_COMPANY_FEATURES },
    emailFiling: { ...DEFAULT_EMAIL_FILING_POLICY },
    tools: {
      skills: [
        { name: "ocsc-word", description: "Word deliverables", enabled: true, hidden: false },
        { name: "Interrogate", description: "Adversarial review", enabled: true, hidden: true },
        { name: "disabled-skill", description: "Turned off", enabled: false, hidden: false },
      ],
      evolve: { status: "ready", tools: [], checkedAt: null, error: null },
    },
    computers: {
      defaultAccess: "tools",
      people: [],
      capacity: { runningComputers: 0, videoSlots: 0, videoRendering: 0, videoQueued: 0 },
      storage: {
        fileRetentionDays: 30,
        defaultStorageLimitMb: 5120,
        chatFileRetentionDays: null,
        cleanup: {
          schedule: "daily",
          hour: 2,
          weekday: 0,
          lastRunAt: null,
          lastResult: null,
          nextRunAt: null,
          requested: false,
        },
        disk: null,
      },
    },
    admins: [],
    voice: { sharedBy: null, provider: null },
    staff: { accounts: 1, withOwnModels: 0 },
  };
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("toggles skill visibility independently of enabled state", async () => {
  const state = baseState();
  const onSaved = vi.fn(async () => {});
  rpc.companyAdmin.setTools.mockResolvedValue(state);

  await act(async () => {
    root.render(<CompanyToolsSection state={state} onSaved={onSaved} />);
  });

  expect(host.textContent).toContain("Hidden from staff");

  const interrogateBtn = host.querySelector<HTMLButtonElement>(
    '[data-testid="toggle-skill-visibility-Interrogate"]',
  );
  const wordBtn = host.querySelector<HTMLButtonElement>(
    '[data-testid="toggle-skill-visibility-ocsc-word"]',
  );
  const disabledBtn = host.querySelector<HTMLButtonElement>(
    '[data-testid="toggle-skill-visibility-disabled-skill"]',
  );
  expect(interrogateBtn?.getAttribute("aria-pressed")).toBe("true");
  expect(wordBtn?.getAttribute("aria-pressed")).toBe("false");
  expect(disabledBtn?.disabled).toBe(true);

  // Reveal Interrogate -> hiddenSkills becomes []
  await act(async () => {
    interrogateBtn?.click();
  });
  expect(rpc.companyAdmin.setTools).toHaveBeenLastCalledWith({ hiddenSkills: [] });

  // Hide ocsc-word -> hiddenSkills includes both Interrogate (still hidden in props) and ocsc-word
  await act(async () => {
    wordBtn?.click();
  });
  expect(rpc.companyAdmin.setTools).toHaveBeenLastCalledWith({
    hiddenSkills: ["ocsc-word", "Interrogate"],
  });
});
