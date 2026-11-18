// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  version: 1,
  files: {} as Record<string, string>,
  saveFiles: vi.fn(),
}));

vi.mock("../../lib/query", () => ({
  useSpaceQueries: () => ({
    apps: {
      key: () => ["apps"],
      files: {
        queryOptions: ({ input }: { input: { pageId: string } }) => ({
          queryKey: ["apps", "files", input.pageId],
          queryFn: async () => ({ version: server.version, files: { ...server.files } }),
        }),
      },
      saveFiles: { call: server.saveFiles },
    },
    pages: { get: { key: () => ["pages", "get"] } },
  }),
}));
vi.mock("../../lib/user-error", () => ({
  errorCode: (error: unknown) => (error as { code?: string }).code,
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => `${text}${values[index - 1] ?? ""}${part}`),
  }),
}));
vi.mock("@rakazo/ui-web", () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => (
    <button type="button" {...props} />
  ),
  Spinner: () => <span />,
}));
vi.mock("./CodeEditor", () => ({
  default: ({ value, onChange }: { value: string; onChange: (text: string) => void }) => (
    <textarea aria-label="code" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

import { AppCodePanel } from "./AppCodePanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <AppCodePanel pageId="p1" version={1} />
      </QueryClientProvider>,
    );
  });
  await settle();
}

async function type(text: string) {
  const editor = container.querySelector("textarea")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(editor, text);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Someone else (the AI) saves a newer version, and the studio's poll refreshes the files. */
async function savedElsewhere(files: Record<string, string>) {
  server.version += 1;
  server.files = files;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["apps"] });
  });
  await settle();
}

function button(label: string) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
}

async function click(label: string) {
  await act(async () => button(label).click());
  await settle();
}

beforeEach(() => {
  server.version = 1;
  server.files = { "App.tsx": "app v1", "theme.css": "css v1" };
  server.saveFiles.mockReset();
  server.saveFiles.mockResolvedValue({ version: 9, problems: [] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

it("carries unsaved edits onto a version the AI saved, keeping the AI's other changes", async () => {
  await show();
  await type("app mine");
  await savedElsewhere({ "App.tsx": "app v1", "theme.css": "css ai" });
  expect(container.textContent).toContain("Version 2 was saved while you edited");
  await click("Save & build");
  expect(server.saveFiles).toHaveBeenCalledWith({
    pageId: "p1",
    files: { "App.tsx": "app mine", "theme.css": "css ai" },
    baseVersion: 2,
  });
});

it("asks which to keep when the AI changed the same file, then saves the choice", async () => {
  await show();
  await type("app mine");
  await savedElsewhere({ "App.tsx": "app ai", "theme.css": "css ai" });
  expect(container.textContent).toContain("changed the same files you edited: App.tsx");
  expect(button("Save & build").disabled).toBe(true);
  await click("Keep mine");
  await click("Save & build");
  expect(server.saveFiles).toHaveBeenCalledWith({
    pageId: "p1",
    files: { "App.tsx": "app mine", "theme.css": "css ai" },
    baseVersion: 2,
  });
});

it("takes the newer file when asked, keeping no stale copy", async () => {
  await show();
  await type("app mine");
  await savedElsewhere({ "App.tsx": "app ai", "theme.css": "css v1" });
  await click("Use newer version");
  expect(container.querySelector("textarea")!.value).toBe("app ai");
  expect(container.textContent).not.toContain("changed the same files");
});

it("keeps edits when the save is refused for a newer version, then merges them on the next save", async () => {
  await show();
  await type("app mine");
  server.saveFiles.mockRejectedValueOnce(
    Object.assign(new Error("conflict"), { code: "CONFLICT" }),
  );
  server.version = 2;
  server.files = { "App.tsx": "app v1", "theme.css": "css ai" };
  await click("Save & build");
  expect(container.querySelector("textarea")!.value).toBe("app mine");
  await click("Save & build");
  expect(server.saveFiles).toHaveBeenLastCalledWith({
    pageId: "p1",
    files: { "App.tsx": "app mine", "theme.css": "css ai" },
    baseVersion: 2,
  });
});
