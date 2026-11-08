// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isOcscTool } from "../../lib/ocsc-tools";
import { OcscToolsSection } from "./ocsc-tools-section";

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
});

it("lists only the tools this account has and expands one to show what it can do", async () => {
  await act(async () =>
    root.render(<OcscToolsSection available={new Set(["ocsc-word", "ocsc-excel", "my-skill"])} />),
  );
  const cards = [...host.querySelectorAll('[data-testid="ocsc-tool"]')];
  expect(cards.map((card) => card.querySelector("button span span")?.textContent)).toEqual([
    "OCSC Word",
    "OCSC Excel",
  ]);
  const word = cards[0]!.querySelector("button")!;
  expect(word.getAttribute("aria-expanded")).toBe("false");
  await act(async () => word.click());
  expect(word.getAttribute("aria-expanded")).toBe("true");
  expect(cards[0]!.textContent).toContain("tracked change");
  expect(cards[1]!.textContent).not.toContain("formulas");
});

it("shows nothing when every tool is switched off", async () => {
  await act(async () => root.render(<OcscToolsSection available={new Set(["my-skill"])} />));
  expect(host.querySelector('[data-testid="ocsc-tools"]')).toBeNull();
});

it("tells OCSC Tools apart from skills", () => {
  expect(isOcscTool("ocsc-pdf-markup")).toBe(true);
  expect(isOcscTool("evolve-plugin")).toBe(true);
  expect(isOcscTool("interrogate")).toBe(false);
});
