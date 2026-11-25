import { describe, expect, it } from "vitest";
import {
  buildClauseLibraryMarkdown,
  buildContractAgentInstructions,
  EvolveContractBundleSchema,
} from "./evolve-contracts.js";

describe("evolve-contracts", () => {
  it("renders Ireland & UK jurisdiction guidance, office metadata, and past-issue Clause Library framing", () => {
    const bundle = EvolveContractBundleSchema.parse({
      contract: {
        id: "11111111-1111-4111-8111-111111111111",
        title: "Development at Fold Housing Association Ireland",
        jobNumber: "F445",
        clientName: "Fold Housing Association Ireland",
        officeName: "Dublin",
        officeCountry: "Ireland",
        currency: "EUR",
        status: "comments_sent",
      },
      documents: [],
      clauseLibrary: [
        {
          id: "c1",
          title: "Fitness for purpose obligation",
          category: "Standard of Care",
          jurisdiction: "both",
          pattern: "fit for purpose",
          severity: "critical",
          recommendedResponse: "Past issue: PI insurers exclude fitness for purpose.",
          exampleRedline: "The Consultant shall exercise reasonable skill, care and diligence.",
        },
        {
          id: "c2",
          title: "Construction Contracts Act 2013 payment notices",
          category: "Payment & Suspension",
          jurisdiction: "ireland",
          severity: "high",
          recommendedResponse: "Ensure compliance with the Irish Construction Contracts Act 2013.",
        },
      ],
      existingFindings: [],
    });

    const instructions = buildContractAgentInstructions(bundle);
    expect(instructions).toContain("OCSC Office / Country: Dublin — Ireland");
    expect(instructions).toContain("JURISDICTION & LEGAL FRAMEWORK (IRELAND & UK)");
    expect(instructions).toContain("Construction Contracts Act 2013");
    expect(instructions).toContain("Housing Grants, Construction and Regeneration Act 1996");
    expect(instructions).toContain("Building Safety Act 2022");
    expect(instructions).toContain(
      "real contract clauses and issues OCSC has encountered on past projects",
    );
    expect(instructions).toContain("[CRITICAL | Ireland & UK] Fitness for purpose obligation");
    expect(instructions).toContain(
      "[HIGH | Ireland] Construction Contracts Act 2013 payment notices",
    );

    const md = buildClauseLibraryMarkdown(bundle.clauseLibrary);
    expect(md).toContain("- **Jurisdiction:** Ireland & UK");
    expect(md).toContain("- **Jurisdiction:** Ireland");
    expect(md).toContain("- **Past Issue & OCSC Position:**");
    expect(md).toContain("- **Proposed Replacement Wording:**");
  });
});
