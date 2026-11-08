// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({ load: (_me: unknown) => {} }));

vi.mock("../lib/rpc", () => ({
  selectedSpaceId: () => null,
  rpc: {
    bots: { list: vi.fn(async () => []) },
    me: vi.fn(
      () =>
        new Promise((resolve) => {
          account.load = resolve;
        }),
    ),
    models: {
      list: vi.fn(async () => [
        {
          provider: "openai-compatible",
          providerName: "OpenAI-compatible",
          id: "",
          label: "Custom",
          billing: "API key",
        },
      ]),
      probeOpenAiCompatible: vi.fn(async () => ({
        models: Array.from({ length: 11 }, (_, index) => `found-${index}`),
      })),
    },
  },
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) => String.raw(parts, ...values);
  return {
    useLingui: () => ({ t }),
    Trans: ({ children }: { children?: ReactNode }) => children,
    Plural: ({ one, other, value }: { one: string; other: string; value: number }) =>
      value === 1 ? one : other,
  };
});

import { hasSeenTour, markTourSeen } from "../components/tour/ocsc-tour";
import { OnboardingPage } from "./Onboarding";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = () => {};
  markTourSeen("u1");
});
afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("marks onboarding as usable for the desktop only once a step shows", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  // The shell sends a new account to /onboarding, which loads before it picks a step.
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={["/onboarding"]}>
        <Routes>
          <Route path="/onboarding/:step?" element={<OnboardingPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
  const marked = () => host.querySelector('[data-rakazo-surface="onboarding"]');
  expect(marked()).toBeNull();

  await act(async () =>
    account.load({
      needsModel: true,
      userId: "u1",
      needsSignupSurvey: false,
      billingEnabled: false,
    }),
  );
  expect(host.querySelector("h1")?.textContent).toBe("Connect a model");
  expect(marked()).not.toBeNull();
  act(() => root.unmount());
});

it("finds and searches a long custom endpoint list during onboarding", async () => {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={["/onboarding"]}>
        <Routes>
          <Route path="/onboarding/:step?" element={<OnboardingPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
  await act(async () =>
    account.load({
      needsModel: true,
      userId: "u1",
      needsSignupSurvey: false,
      billingEnabled: false,
    }),
  );
  await act(async () => document.querySelector<HTMLElement>('[aria-label="Provider"]')!.click());
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((option) => option.textContent === "OpenAI-compatible")!
      .click(),
  );
  const change = async (label: string, value: string) => {
    const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  await change("OpenAI-compatible server URL", "https://models.example.test/v1");
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Find models")!
      .click(),
  );
  await act(async () =>
    document.querySelector<HTMLElement>('[aria-label="Models from server"]')!.click(),
  );
  await change("Search models", "found-10");
  expect([...document.querySelectorAll("[cmdk-item]")].map((row) => row.textContent)).toEqual([
    "found-10",
    "Other model…",
  ]);
  await act(async () => document.querySelector<HTMLElement>("[cmdk-item]")!.click());
  expect(document.querySelector('[aria-label="Models from server"]')?.textContent).toBe("found-10");
  await act(async () => root.unmount());
});

it("tells staff their administrator is setting up the model instead of asking for a key", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={["/onboarding"]}>
        <Routes>
          <Route path="/onboarding/:step?" element={<OnboardingPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
  await act(async () =>
    account.load({
      needsModel: true,
      userId: "u1",
      needsSignupSurvey: false,
      billingEnabled: false,
      isAdmin: false,
      features: { memberModels: false },
    }),
  );
  expect(host.querySelector("h1")?.textContent).toBe("Almost ready");
  expect(host.querySelector('[aria-label="Provider"]')).toBeNull();
  expect(host.querySelector('input[type="password"]')).toBeNull();
  act(() => root.unmount());
});

it("sends the admin to the company admin page to choose the model", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={["/onboarding"]}>
        <Routes>
          <Route path="/onboarding/:step?" element={<OnboardingPage />} />
          <Route path="/admin" element={<p>company admin</p>} />
        </Routes>
      </MemoryRouter>,
    ),
  );
  await act(async () =>
    account.load({
      needsModel: true,
      userId: "u1",
      needsSignupSurvey: false,
      billingEnabled: false,
      isAdmin: true,
      features: { memberModels: false },
    }),
  );
  expect(host.textContent).toBe("company admin");
  act(() => root.unmount());
});

it("shows the OCSC Intelligence tour before a new person's first step", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={["/onboarding"]}>
        <Routes>
          <Route path="/onboarding/:step?" element={<OnboardingPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
  await act(async () =>
    account.load({
      userId: "new",
      needsModel: true,
      needsSignupSurvey: false,
      billingEnabled: false,
    }),
  );
  expect(host.querySelector('[data-testid="ocsc-tour"]')).not.toBeNull();
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Skip to the end")!
      .click(),
  );
  await act(async () => host.querySelector<HTMLElement>('[data-testid="ocsc-tour-next"]')!.click());
  expect(host.querySelector('[data-testid="ocsc-tour"]')).toBeNull();
  expect(host.querySelector("h1")?.textContent).toBe("Connect a model");
  expect(hasSeenTour("new")).toBe(true);
  act(() => root.unmount());
});
