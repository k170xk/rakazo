// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StudioWelcomeState } from "./use-studio-welcome";
import {
  claimWelcomeOpen,
  readWelcomeOpens,
  STUDIO_WELCOME_LIMIT,
  studioWelcomeKey,
  turnOffWelcome,
  useStudioWelcome,
} from "./use-studio-welcome";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

it("shows for the first ten opens of each format, counted per person", () => {
  const storage = memoryStorage();
  for (let open = 0; open < STUDIO_WELCOME_LIMIT; open++) {
    expect(claimWelcomeOpen("u1", "docx", storage)).toBe(true);
  }
  expect(claimWelcomeOpen("u1", "docx", storage)).toBe(false);
  expect(readWelcomeOpens("u1", "docx", storage)).toBe(STUDIO_WELCOME_LIMIT);
  expect(claimWelcomeOpen("u1", "pptx", storage)).toBe(true);
  expect(claimWelcomeOpen("u2", "docx", storage)).toBe(true);
});

it("stays off once turned off", () => {
  const storage = memoryStorage();
  claimWelcomeOpen("u1", "xlsx", storage);
  turnOffWelcome("u1", "xlsx", storage);
  expect(readWelcomeOpens("u1", "xlsx", storage)).toBeNull();
  expect(claimWelcomeOpen("u1", "xlsx", storage)).toBe(false);
});

it("treats a garbled or blocked store as a fresh count", () => {
  const storage = memoryStorage();
  storage.values.set(studioWelcomeKey("u1", "docx"), "nonsense");
  expect(readWelcomeOpens("u1", "docx", storage)).toBe(0);
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  expect(claimWelcomeOpen("u1", "docx", blocked)).toBe(true);
  expect(readWelcomeOpens("u1", "docx", null)).toBe(0);
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let state: StudioWelcomeState;

type Props = Parameters<typeof useStudioWelcome>[0];

function Harness(props: Props) {
  state = useStudioWelcome(props);
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function render(props: Props) {
  await act(async () => root.render(<Harness {...props} />));
}

it("waits for the person and the studio, then counts one open per document", async () => {
  const storage = memoryStorage();
  const base: Props = {
    userId: undefined,
    format: "docx",
    documentId: "doc-1",
    ready: false,
    running: false,
    storage,
  };
  await render(base);
  expect(state.open).toBe(false);
  await render({ ...base, userId: "u1" });
  expect(state.open).toBe(false);
  await render({ ...base, userId: "u1", ready: true });
  expect(state.open).toBe(true);
  await render({ ...base, userId: "u1", ready: true });
  expect(readWelcomeOpens("u1", "docx", storage)).toBe(1);
  await act(async () => state.close());
  expect(state.open).toBe(false);
  await render({ ...base, userId: "u1", ready: true, documentId: "doc-2" });
  expect(state.open).toBe(true);
  expect(readWelcomeOpens("u1", "docx", storage)).toBe(2);
});

it("skips an open while the assistant is working, and hides when a run starts", async () => {
  const storage = memoryStorage();
  const base: Props = {
    userId: "u1",
    format: "pptx",
    documentId: "deck-1",
    ready: true,
    running: true,
    storage,
  };
  await render(base);
  expect(state.open).toBe(false);
  expect(readWelcomeOpens("u1", "pptx", storage)).toBe(0);

  await render({ ...base, documentId: "deck-2", running: false });
  expect(state.open).toBe(true);
  await render({ ...base, documentId: "deck-2", running: true });
  expect(state.open).toBe(false);
});

it("Don't show again turns it off for that format only", async () => {
  const storage = memoryStorage();
  await render({
    userId: "u1",
    format: "xlsx",
    documentId: "sheet-1",
    ready: true,
    running: false,
    storage,
  });
  await act(async () => state.dontShowAgain());
  expect(state.open).toBe(false);
  expect(readWelcomeOpens("u1", "xlsx", storage)).toBeNull();
  expect(readWelcomeOpens("u1", "docx", storage)).toBe(0);
});
