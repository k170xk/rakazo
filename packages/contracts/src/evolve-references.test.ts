import { describe, expect, it } from "vitest";
import { MessageBlock } from "./events.js";
import {
  EvolveReferencesSchema,
  evolvePersonCvText,
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
  it("matches Evolve chat's template, adding each person's overriding role", () => {
    expect(
      evolveReferencesPromptText({ projects: [project], people: [person], exemplars: [exemplar] }),
    ).toBe(
      "Please use the following reference projects as immediate context for this conversation.\n\n" +
        "• Primary Care Centre\n  - Client: HSE\n  - Value: 2.5 Million\n  - Summary: Design of a new centre." +
        "\n\nPlease use the following people as context for this conversation.\n\n• Aaron Kearney\n  - Role: Project Engineer (the role this person will hold here; it overrides any role or job title in their CV)" +
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

describe("evolvePersonCvText", () => {
  it("writes the whole CV and puts it under the person after their role", () => {
    const cv = evolvePersonCvText({
      id: "205",
      profile: {
        cvRole: "Senior Engineer",
        jobTitle: "Engineer",
        bio: "Bridges.",
        chartered: false,
      },
      qualifications: [
        { name: "BEng", institution: "UCD", graduation_date: "2015-06-01", type: "Degree" },
      ],
      otherQualifications: [],
      healthSafety: [{ name: "Safe Pass", expiry_date: "2027-01-31" }],
      employment: [
        {
          role: "Engineer",
          company: "OCSC",
          start_date: "2019-03-01",
          is_current: true,
          description: "Design.",
        },
      ],
      skills: [{ skill: "Revit", skill_level: "Expert" }, { skill: "Civil 3D" }],
      languages: [{ language: "Irish", proficiency: "Fluent" }],
      roleBios: [{ role_title: "Project Engineer", bio_content: "Led three schools." }],
    });
    expect(cv).toBe(
      [
        "CV role: Senior Engineer",
        "Job title: Engineer",
        "Bio: Bridges.",
        "Role bios:",
        "- Project Engineer: Led three schools.",
        "Employment history:",
        "- Engineer, OCSC (03/2019 to present): Design.",
        "Professional qualifications:",
        "- BEng (Degree, UCD, 06/2015)",
        "Health and safety:",
        "- Safe Pass (expires 01/2027)",
        "Skills: Revit (Expert), Civil 3D",
        "Languages: Irish (Fluent)",
      ].join("\n"),
    );
    expect(
      evolveReferencesPromptText({ projects: [], people: [{ ...person, cv }], exemplars: [] }),
    ).toContain(
      "• Aaron Kearney\n  - Role: Project Engineer (the role this person will hold here; it overrides any role or job title in their CV)\n  - CV:\n    CV role: Senior Engineer\n    Job title: Engineer",
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
