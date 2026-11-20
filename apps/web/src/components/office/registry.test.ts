import { DOCUMENT_MIME_TYPES } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { OFFICE_FORMATS, OFFICE_STUDIOS, officeStudioReady } from "./registry";

describe("office registry", () => {
  it("lists Project Planner after Excel and wires jantt MIME and studio", () => {
    expect(OFFICE_FORMATS).toEqual(["docx", "pptx", "pdf", "xlsx", "jantt"]);
    expect(OFFICE_STUDIOS.jantt.extension).toBe(".jantt");
    expect(OFFICE_STUDIOS.jantt.mimeType).toBe(DOCUMENT_MIME_TYPES.jantt);
    expect(OFFICE_STUDIOS.jantt.accept).toContain(".jantt");
    expect(OFFICE_STUDIOS.jantt.accept).toContain(".xml");
    expect(OFFICE_STUDIOS.jantt.accept).toContain(".csv");
    expect(OFFICE_STUDIOS.jantt.icon).toBe("/icons/studios/project.png");
    expect(officeStudioReady("jantt")).toBe(true);
  });
});
