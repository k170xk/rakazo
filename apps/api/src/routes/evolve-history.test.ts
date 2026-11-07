import type { EvolveHistoryMessage } from "@rakazo/contracts";
import { EVOLVE_REFERENCE_CONTEXT_MAX_CHARS } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { archivedMessageBlocks, assistantLook } from "./evolve-history.js";

function message(overrides: Partial<EvolveHistoryMessage>): EvolveHistoryMessage {
  return {
    id: "1",
    role: "assistant",
    type: "text",
    content: "",
    createdAt: "2026-10-21T10:00:00Z",
    images: [],
    files: [],
    references: { projects: [], people: [], exemplars: [] },
    ...overrides,
  };
}

describe("archivedMessageBlocks", () => {
  it("skips replies that were never saved", () => {
    expect(archivedMessageBlocks(message({ content: "  ", unsaved: true }))).toBeNull();
  });

  it("keeps the text with its images and attached file names", () => {
    expect(
      archivedMessageBlocks(
        message({
          role: "user",
          content: "Here is the brief",
          images: ["https://example.com/a.png"],
          files: [{ name: "brief.pdf" }, { name: "plan.dwg" }],
        }),
      ),
    ).toEqual([
      {
        kind: "text",
        text: "Here is the brief\n\n![image](https://example.com/a.png)\n\nAttached: brief.pdf, plan.dwg",
      },
    ]);
  });

  it("trims long reference details", () => {
    const blocks = archivedMessageBlocks(
      message({
        role: "user",
        type: "references",
        content: "x".repeat(EVOLVE_REFERENCE_CONTEXT_MAX_CHARS + 500),
      }),
    );
    const text = blocks?.[0]?.kind === "text" ? blocks[0].text : "";
    expect(text).toHaveLength(
      EVOLVE_REFERENCE_CONTEXT_MAX_CHARS + "\n… (reference details trimmed)".length,
    );
  });
});

describe("assistantLook", () => {
  const assistant = "5a3a70fb-af59-42f1-a974-a4d3227111d1";

  it("uses the assistant's own bot avatar", () => {
    expect(
      assistantLook(assistant, { id: "bot1", color: "#FF781C::shape_4", avatarSet: "organic" }),
    ).toEqual({
      color: "#FF781C::shape_4",
      avatarSet: "organic",
      identity: "bot1",
    });
  });

  it("gives an assistant without a bot the same look every time", () => {
    const look = assistantLook(assistant, undefined);
    expect(look).toEqual(assistantLook(assistant, undefined));
    expect(look.identity).toBe(assistant);
    expect(look.color).toMatch(/^#[0-9A-F]{6}$/i);
  });
});
