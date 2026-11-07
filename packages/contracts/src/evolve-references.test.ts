import { describe, expect, it } from "vitest";
import { MessageBlock } from "./events.js";
import {
  EvolveReferencesSchema,
  evolveReferencesContextChars,
  evolveReferencesPromptText,
  hasEvolveReferences,
} from "./evolve-references.js";

const project = {
  id: "sb:1",
  name: "Primary Care Centre",
  client: "HSE",
  value: "2.5 Million",
  summary: "Design of a new centre.",
};
const person = { id: "205", name: "Aaron Kearney", role: "Project Engineer" };
const exemplar = { id: "ex-1", response_text: "Our approach…", title: "Sustainability Award" };

describe("evolveReferencesPromptText", () => {
  it("matches Evolve chat's template, adding each person's role", () => {
    expect(
      evolveReferencesPromptText({ projects: [project], people: [person], exemplars: [exemplar] }),
    ).toBe(
      "Please use the following reference projects as immediate context for this conversation.\n\n" +
        "• Primary Care Centre\n  - Client: HSE\n  - Value: 2.5 Million\n  - Summary: Design of a new centre." +
        "\n\nPlease use the following people as context for this conversation.\n\n• Aaron Kearney\n  - Role: Project Engineer" +
        "\n\nPlease use the following exemplar responses as context for this conversation.\n\n" +
        "• Sustainability Award\n  - Text: Our approach…",
    );
  });

  it("keeps Evolve's leading break when there are no projects, and its Exemplar fallback", () => {
    expect(
      evolveReferencesPromptText({
        projects: [],
        people: [],
        exemplars: [{ id: "ex-2", response_text: "Text", title: null, response_title: null }],
      }),
    ).toBe(
      "\n\nPlease use the following exemplar responses as context for this conversation.\n\n• Exemplar\n  - Text: Text",
    );
  });
});

describe("evolve references schemas", () => {
  it("parses a stored message block and counts context like Evolve's meter", () => {
    const block = MessageBlock.parse({ kind: "evolve_references", projects: [project] });
    expect(block).toMatchObject({ kind: "evolve_references", people: [], exemplars: [] });
    const references = EvolveReferencesSchema.parse({ projects: [project], people: [person] });
    expect(hasEvolveReferences(references)).toBe(true);
    expect(hasEvolveReferences(EvolveReferencesSchema.parse({}))).toBe(false);
    expect(evolveReferencesContextChars(references)).toBe(
      "Primary Care Centre".length +
        "HSE".length +
        "2.5 Million".length +
        "Design of a new centre.".length +
        "Aaron Kearney".length +
        "Project Engineer".length,
    );
  });
});
