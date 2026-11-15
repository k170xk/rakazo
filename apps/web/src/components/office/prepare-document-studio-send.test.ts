import { describe, expect, it, vi } from "vitest";
import { prepareDocumentStudioSend } from "./prepare-document-studio-send";
import type { SaveQueueState } from "./word/save-queue";

const idle = (over: Partial<SaveQueueState> = {}): SaveQueueState => ({
  status: "idle",
  dirty: false,
  baseVersion: 3,
  detail: null,
  ...over,
});

describe("prepareDocumentStudioSend", () => {
  it("flushes, publishes the note, and returns the newest artifact for this chat", async () => {
    const publishNote = vi.fn();
    const attachment = await prepareDocumentStudioSend({
      flush: async () => idle({ status: "saved", baseVersion: 4 }),
      getLatest: () => ({
        artifactId: "a4",
        version: 4,
        versions: [{ artifactId: "a3" }, { artifactId: "a4" }],
      }),
      publishNote,
      owner: async () => ({ botId: "bot-1", groupId: null }),
    });
    expect(publishNote).toHaveBeenCalledOnce();
    expect(attachment).toEqual({
      artifactId: "a4",
      familyArtifactIds: ["a3", "a4"],
      botId: "bot-1",
      groupId: null,
    });
  });

  it("reloads on conflict then returns the reloaded version", async () => {
    const states = [
      idle({ status: "conflict", dirty: true }),
      idle({ status: "saved", baseVersion: 9 }),
    ];
    let latest = {
      artifactId: "a3",
      version: 3,
      versions: [{ artifactId: "a3" }],
    };
    const resolveConflict = vi.fn(async () => {
      latest = {
        artifactId: "a9",
        version: 9,
        versions: [{ artifactId: "a3" }, { artifactId: "a9" }],
      };
    });
    const attachment = await prepareDocumentStudioSend({
      flush: async () => states.shift() ?? idle({ status: "saved", baseVersion: 9 }),
      getLatest: () => latest,
      publishNote: () => {},
      owner: async () => ({ botId: "bot-1", groupId: null }),
      resolveConflict,
      budgetMs: 2_000,
    });
    expect(resolveConflict).toHaveBeenCalledOnce();
    expect(attachment?.artifactId).toBe("a9");
  });

  it("returns null when nothing is open", async () => {
    expect(
      await prepareDocumentStudioSend({
        flush: async () => idle(),
        getLatest: () => null,
        publishNote: () => {},
        owner: async () => ({ botId: "bot-1", groupId: null }),
      }),
    ).toBeNull();
  });
});
