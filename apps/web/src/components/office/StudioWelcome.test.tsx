// @vitest-environment jsdom
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { DocumentFormat } from "@rakazo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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

import { StudioWelcome } from "./StudioWelcome";
import { readWelcomeOpens } from "./use-studio-welcome";

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

async function renderWelcome(format: DocumentFormat, documentId = "doc-1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nProvider i18n={i18n}>
          <StudioWelcome format={format} documentId={documentId} />
        </I18nProvider>
      </QueryClientProvider>,
    ),
  );
  await act(async () => dock.set({ node: composer }));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

const dialog = () => document.querySelector<HTMLElement>('[data-testid="studio-welcome"]');

it("opens over a Word document with its tips and counts the open", async () => {
  await renderWelcome("docx");
  const shown = dialog();
  expect(shown?.getAttribute("role")).toBe("dialog");
  expect(shown?.textContent).toContain("Let the assistant edit your document");
  expect(shown?.textContent).toContain("Highlight a paragraph, table or image");
  expect(shown?.querySelector("img")?.getAttribute("src")).toBe("/studios/word-welcome.png");
  expect(readWelcomeOpens("u1", "docx")).toBe(1);
});

it("shows the PowerPoint and Excel tips for those studios", async () => {
  await renderWelcome("pptx");
  expect(dialog()?.textContent).toContain("Select a text box, image or shape");
  await act(async () => root.unmount());
  root = createRoot(host);
  await renderWelcome("xlsx");
  expect(dialog()?.textContent).toContain("Select cells and ask for a change");
});

it("Get started closes it and puts the cursor in the chat composer", async () => {
  await renderWelcome("docx");
  const start = document.querySelector<HTMLButtonElement>('[data-testid="studio-welcome-start"]');
  await act(async () => start?.click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(composer.querySelector("textarea"));
});

it("Escape closes it", async () => {
  await renderWelcome("xlsx");
  await act(async () => {
    dialog()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(dialog()).toBeNull();
});

it("Don't show again keeps it closed on later opens", async () => {
  await renderWelcome("pptx");
  const off = document.querySelector<HTMLButtonElement>('[data-testid="studio-welcome-off"]');
  await act(async () => off?.click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(dialog()).toBeNull();
  await renderWelcome("pptx", "doc-2");
  expect(dialog()).toBeNull();
});

it("stays away while the assistant is working on the document", async () => {
  dock.set({ running: true });
  await renderWelcome("docx");
  expect(dialog()).toBeNull();
  expect(readWelcomeOpens("u1", "docx")).toBe(0);
});
