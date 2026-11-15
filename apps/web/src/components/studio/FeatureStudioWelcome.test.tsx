// @vitest-environment jsdom
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readWelcomeOpens } from "../office/use-studio-welcome";
import type { FeatureStudioKind } from "./FeatureStudioWelcome";

const lingui = vi.hoisted(() => ({
  t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw({ raw: parts }, ...values),
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => lingui,
  Trans: ({ children }: { children: ReactNode }) => children,
}));

const dock = vi.hoisted(() => {
  let state: { node: HTMLElement | null; running?: boolean } = { node: null };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next: Partial<typeof state>) => {
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset: () => {
      state = { node: null };
    },
  };
});
vi.mock("../../lib/pages", () => ({ usePageSession: () => ({ dock }) }));
vi.mock("../../lib/query", () => ({
  useSpaceQueries: () => ({
    me: { queryOptions: () => ({ queryKey: ["me"], queryFn: async () => ({ userId: "u1" }) }) },
  }),
}));

import { FeatureStudioWelcome } from "./FeatureStudioWelcome";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let composer: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  i18n.load("en", {});
  i18n.activate("en");
  localStorage.clear();
  dock.reset();
  composer = document.createElement("div");
  composer.innerHTML = "<textarea aria-label='Message'></textarea>";
  document.body.append(composer);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  composer.remove();
  vi.unstubAllGlobals();
});

async function renderWelcome(kind: FeatureStudioKind) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nProvider i18n={i18n}>
          <FeatureStudioWelcome kind={kind} />
        </I18nProvider>
      </QueryClientProvider>,
    ),
  );
  await act(async () => dock.set({ node: composer }));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

const dialog = () => document.querySelector<HTMLElement>('[data-testid="studio-welcome"]');

it("opens over To-do with concept tips and its illustration", async () => {
  await renderWelcome("todo");
  const shown = dialog();
  expect(shown?.getAttribute("role")).toBe("dialog");
  expect(shown?.getAttribute("data-format")).toBe("todo");
  expect(shown?.textContent).toContain("Keep work moving across a living list");
  expect(shown?.textContent).toContain("Principles that work well");
  expect(shown?.querySelector("img")?.getAttribute("src")).toBe("/studios/todo-welcome.png");
  expect(readWelcomeOpens("u1", "todo")).toBe(1);
});

it("shows Apps and Board copy with matching illustrations", async () => {
  await renderWelcome("apps");
  expect(dialog()?.textContent).toContain("Build working apps by describing them");
  expect(dialog()?.textContent).toContain("Personal apps");
  expect(dialog()?.textContent).toContain("Company apps");
  expect(dialog()?.querySelector("img")?.getAttribute("src")).toBe("/studios/apps-welcome.png");
  expect(readWelcomeOpens("u1", "apps")).toBe(1);

  await renderWelcome("board");
  expect(dialog()?.textContent).toContain("Think out loud on a shared board");
  expect(dialog()?.querySelector("img")?.getAttribute("src")).toBe("/studios/board-welcome.png");
  expect(readWelcomeOpens("u1", "board")).toBe(1);
});
