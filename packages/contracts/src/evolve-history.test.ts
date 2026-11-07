import { describe, expect, it } from "vitest";
import { MessageBlock } from "./events.js";
import {
  EVOLVE_REFERENCE_CONTEXT_MAX_CHARS,
  EvolveConversationMessagesSchema,
  evolveConversationPromptText,
  evolveConversationTranscript,
  evolveHistoryMessageText,
} from "./evolve-history.js";

const message = (id: string, role: "user" | "assistant", content: string) =>
  EvolveConversationMessagesSchema.shape.messages.element.parse({
    id,
    role,
    type: "text",
    content,
    createdAt: "2026-10-03T10:00:00Z",
  });

describe("evolveHistoryMessageText", () => {
  it("names the speaker and lists references, files and images", () => {
    const text = evolveHistoryMessageText({
      ...message("1", "user", "Draft the methodology"),
      files: [{ name: "Brief.pdf" }],
      images: ["https://example.com/a.png"],
      references: {
        projects: [{ name: "Royal Wharf" }],
        people: [{ name: "Brian Heron", role: "Project Director" }],
        exemplars: [],
      },
    });
    expect(text).toBe(
      [
        "User: Draft the methodology",
        "[Reference projects: Royal Wharf]",
        "[Reference people: Brian Heron (Project Director)]",
        "[Attached files: Brief.pdf]",
        "[Images: https://example.com/a.png]",
      ].join("\n"),
    );
  });

  it("says when Evolve never saved a reply", () => {
    expect(evolveHistoryMessageText({ ...message("2", "assistant", ""), unsaved: true })).toBe(
      "Assistant: (No reply was saved in Evolve.)",
    );
  });

  it("trims the stored details of a message that added references", () => {
    const details = `Please use the following reference projects.\n${"x".repeat(EVOLVE_REFERENCE_CONTEXT_MAX_CHARS)}`;
    const text = evolveHistoryMessageText({
      ...message("3", "user", details),
      type: "references",
      references: { projects: [{ name: "Burton Street Sligo" }], people: [], exemplars: [] },
    });
    expect(text).toContain("User: Please use the following reference projects.");
    expect(text).toContain(
      "… (reference details trimmed)\n[Reference projects: Burton Street Sligo]",
    );
    expect(text.length).toBeLessThan(EVOLVE_REFERENCE_CONTEXT_MAX_CHARS + 120);
    expect(evolveHistoryMessageText(message("4", "user", details))).toContain(
      "x".repeat(EVOLVE_REFERENCE_CONTEXT_MAX_CHARS),
    );
  });
});

describe("evolveConversationTranscript", () => {
  const messages = [
    message("1", "user", "a".repeat(40)),
    message("2", "assistant", "b".repeat(40)),
    message("3", "user", "c".repeat(40)),
  ];

  it("keeps everything that fits, oldest first", () => {
    const { transcript, omittedMessages } = evolveConversationTranscript(messages);
    expect(omittedMessages).toBe(0);
    expect(transcript.indexOf("User: a")).toBeLessThan(transcript.indexOf("User: c"));
  });

  it("drops the earliest messages first and counts them", () => {
    const { transcript, omittedMessages } = evolveConversationTranscript(messages, 110);
    expect(omittedMessages).toBe(1);
    expect(transcript).not.toContain("aaaa");
    expect(transcript).toContain("bbbb");
    expect(transcript).toContain("cccc");
  });

  it("cuts a single message that is longer than the budget", () => {
    const { transcript, omittedMessages } = evolveConversationTranscript(messages, 30);
    expect(omittedMessages).toBe(2);
    expect(transcript).toMatch(/^User: c+… \(cut short\)$/);
  });
});

describe("evolve_conversation block", () => {
  it("parses as a message block and tells the model how to search its files", () => {
    const block = MessageBlock.parse({
      kind: "evolve_conversation",
      conversationId: "35db4d59-e75a-4696-b1e1-357a746108a1",
      title: "Structural reports",
      assistantName: "OCSC Civil Intelligence",
      lastMessageAt: "2026-10-03T10:06:52Z",
      messageCount: 2,
      files: ["Report.pdf"],
      searchable: true,
      transcript: "User: hello\n\nAssistant: hi",
    });
    if (block.kind !== "evolve_conversation") throw new Error("wrong kind");
    const prompt = evolveConversationPromptText(block);
    expect(prompt).toContain('"Structural reports" (last active 2026-10-03, 2 messages)');
    expect(prompt).toContain("Files uploaded to it: Report.pdf.");
    expect(prompt).toContain('conversationId "35db4d59-e75a-4696-b1e1-357a746108a1"');
    expect(prompt).not.toContain("left out for length");
    expect(prompt.endsWith("Transcript:\n\nUser: hello\n\nAssistant: hi")).toBe(true);
    expect(
      evolveConversationPromptText({ ...block, searchable: false, omittedMessages: 4 }),
    ).toContain("The 4 earliest messages are left out for length.");
  });
});
