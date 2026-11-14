// @vitest-environment jsdom
import type { MyStorageItem, MyStorageState } from "@rakazo/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import {
  itemsForTab,
  markStoragePromptSeen,
  shouldPromptStorage,
  storagePromptReason,
} from "./storage-prompt";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-11T12:00:00Z");
const GB = 1024 ** 3;

function item(name: string, size: number, modifiedDaysAgo: number, deletesInDays: number | null) {
  return {
    ref: { kind: "computer", botId: "bot", path: name },
    name,
    botName: "Agent",
    kind: "file",
    size,
    modifiedAt: new Date(NOW - modifiedDaysAgo * DAY).toISOString(),
    pinnable: true,
    pinned: deletesInDays === null,
    deletesAt: deletesInDays === null ? null : new Date(NOW + deletesInDays * DAY).toISOString(),
  } satisfies MyStorageItem;
}

function state(usedBytes: number, items: MyStorageItem[] = []): MyStorageState {
  return {
    usedBytes,
    limitBytes: 2 * GB,
    computerBytes: usedBytes,
    chatBytes: 0,
    computerRetentionDays: 30,
    chatRetentionDays: 60,
    items,
  };
}

describe("when Manage storage opens by itself", () => {
  it("says full at the limit, nearly full from 80%, and otherwise only about files deleted this week", () => {
    expect(storagePromptReason(state(2 * GB), NOW)).toBe("full");
    expect(storagePromptReason(state(1.7 * GB), NOW)).toBe("nearly-full");
    expect(storagePromptReason(state(1.5 * GB), NOW)).toBeNull();
    expect(storagePromptReason(state(GB, [item("a.docx", 1, 25, 5)]), NOW)).toBe("expiring");
    expect(storagePromptReason(state(GB, [item("a.docx", 1, 5, 25)]), NOW)).toBeNull();
    expect(storagePromptReason(state(GB, [item("kept.docx", 1, 90, null)]), NOW)).toBeNull();
  });

  beforeEach(() => localStorage.clear());

  it("opens once a day for each reason", () => {
    expect(shouldPromptStorage("u1", "nearly-full", NOW)).toBe(true);
    markStoragePromptSeen("u1", "nearly-full", NOW);
    expect(shouldPromptStorage("u1", "nearly-full", NOW + 60_000)).toBe(false);
    expect(shouldPromptStorage("u1", "full", NOW + 60_000)).toBe(true);
    expect(shouldPromptStorage("u1", "nearly-full", NOW + DAY)).toBe(true);
    expect(shouldPromptStorage("u2", "nearly-full", NOW)).toBe(true);
  });
});

describe("Manage storage tabs", () => {
  const items = [
    item("big.mp4", 900, 3, 27),
    item("soon.docx", 10, 26, 4),
    item("new.pptx", 50, 0, 30),
  ];

  it("lists newest first, largest first, or only what is deleted this week, soonest first", () => {
    expect(itemsForTab(items, "all", NOW).map((i) => i.name)).toEqual([
      "new.pptx",
      "big.mp4",
      "soon.docx",
    ]);
    expect(itemsForTab(items, "largest", NOW).map((i) => i.name)).toEqual([
      "big.mp4",
      "new.pptx",
      "soon.docx",
    ]);
    expect(itemsForTab(items, "expiring", NOW).map((i) => i.name)).toEqual(["soon.docx"]);
  });
});
