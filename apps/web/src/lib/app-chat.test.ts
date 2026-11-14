import { describe, expect, it } from "vitest";
import { chatForPage } from "./app-chat";

const bots = [
  { id: "builder", archivedAt: null },
  { id: "other", archivedAt: null },
  { id: "old", archivedAt: "2026-01-01T00:00:00.000Z" },
];

describe("chatForPage", () => {
  it("opens a group app in that group", () => {
    expect(chatForPage({ botId: "builder", groupId: "group-1" }, bots)).toBe("/app/g/group-1");
  });

  it("opens the person's app in the agent that built it", () => {
    expect(chatForPage({ botId: "builder", groupId: null }, bots)).toBe("/app/builder");
  });

  it("opens an app whose agent is gone in another live agent", () => {
    expect(chatForPage({ botId: null, groupId: null }, bots)).toBe("/app/builder");
    expect(chatForPage({ botId: "old", groupId: null }, bots)).toBe("/app/builder");
  });

  it("has nowhere to open an app when the person has no agent", () => {
    expect(chatForPage({ botId: null, groupId: null }, [])).toBeNull();
  });
});
