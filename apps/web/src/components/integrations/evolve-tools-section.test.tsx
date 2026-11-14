// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EvolveToolsSection } from "./evolve-tools-section";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => <>{children}</>,
  Plural: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const catalogue = vi.fn();

vi.mock("../../lib/query", () => ({
  useSpaceQueries: () => ({
    evolveTools: {
      catalogue: {
        queryOptions: () => ({
          queryKey: ["evolve-tools"],
          queryFn: catalogue,
        }),
      },
    },
  }),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: (_options: { queryFn: () => Promise<unknown> }) => {
      const data = (globalThis as { __evolveCatalogue?: unknown }).__evolveCatalogue;
      return {
        isPending: data === undefined,
        data,
        error: null,
      };
    },
  };
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  delete (globalThis as { __evolveCatalogue?: unknown }).__evolveCatalogue;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("shows a loading state while the catalogue is unread", async () => {
  await act(async () => root.render(<EvolveToolsSection />));
  expect(host.querySelector('[data-testid="evolve-tools"]')?.textContent).toContain(
    "Loading Evolve tools",
  );
});

it("explains when Evolve tools are unavailable instead of vanishing", async () => {
  (globalThis as { __evolveCatalogue?: unknown }).__evolveCatalogue = {
    status: "unavailable",
    tools: [],
  };
  await act(async () => root.render(<EvolveToolsSection />));
  const section = host.querySelector('[data-testid="evolve-tools"]')!;
  expect(section.textContent).toContain("Learning Centre clinics");
  expect(section.textContent).toContain("could not list its tools");
});

it("lists ready tools in groups with access and approval chips", async () => {
  (globalThis as { __evolveCatalogue?: unknown }).__evolveCatalogue = {
    status: "ready",
    tools: [
      {
        name: "find_learning_clinics",
        description: "Search Learning Centre clinics.",
        group: "Learning Centre",
        access: "read",
        approval: false,
        changes: null,
        page: { key: "tools.lms", label: "Learning Centre", open: true },
      },
      {
        name: "check_out_to_site",
        description: "Check out to a site.",
        group: "Site visits",
        access: "add",
        approval: true,
        changes: "Checks you out to a site and emails your buddy.",
        page: { key: "staff.checkin", label: "Staff Check-in", open: true },
      },
    ],
  };
  await act(async () => root.render(<EvolveToolsSection />));
  const section = host.querySelector('[data-testid="evolve-tools"]')!;
  expect(section.textContent).toContain("2 tools for company data");
  expect(section.textContent).toContain("Learning Centre");
  expect(section.textContent).toContain("Site visits");
  const siteGroup = [...section.querySelectorAll('[data-testid="evolve-tool-group"]')].find(
    (group) => group.textContent?.includes("Site visits"),
  )!;
  await act(async () => siteGroup.querySelector("button")!.click());
  expect(siteGroup.textContent).toContain("You approve every time");
  expect(siteGroup.textContent).toContain("Checks you out to a site");
  const learningGroup = [...section.querySelectorAll('[data-testid="evolve-tool-group"]')].find(
    (group) => group.textContent?.includes("Learning Centre"),
  )!;
  await act(async () => learningGroup.querySelector("button")!.click());
  expect(learningGroup.querySelector('[data-testid="evolve-tool-access-read"]')?.textContent).toContain(
    "Read only",
  );
});
