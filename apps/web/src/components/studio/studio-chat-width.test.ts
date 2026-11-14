import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampStudioChatWidth,
  readStudioChatWidth,
  STUDIO_CHAT_DEFAULT_WIDTH,
  STUDIO_CHAT_MAX_WIDTH,
  STUDIO_CHAT_MIN_WIDTH,
  writeStudioChatWidth,
} from "./studio-chat-width";

const memory = new Map<string, string>();

describe("studio chat width", () => {
  afterEach(() => {
    memory.clear();
    vi.unstubAllGlobals();
  });

  it("opens at the agents sidebar default", () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
    });
    expect(STUDIO_CHAT_DEFAULT_WIDTH).toBe(316);
    expect(readStudioChatWidth()).toBe(316);
  });

  it("keeps a dragged width and stays inside the canvas", () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
    });
    writeStudioChatWidth(900);
    expect(readStudioChatWidth()).toBe(STUDIO_CHAT_MAX_WIDTH);
    expect(clampStudioChatWidth(100)).toBe(STUDIO_CHAT_MIN_WIDTH);
    expect(clampStudioChatWidth(500, 800)).toBe(800 - 360);
  });
});
