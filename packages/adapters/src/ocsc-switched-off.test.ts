import { DEFAULT_COMPANY_TOOLS } from "@rakazo/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { setCompanyPolicy } from "./company-policy.js";
import {
  ocscFileKinds,
  ocscProgramRefusal,
  ocscShellRefusal,
  switchedOffOcscPrograms,
  withOcscProgramsOffered,
} from "./ocsc-tool.js";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";

afterEach(() => {
  setCompanyPolicy({ tools: null });
});

function ownerRun() {
  return selectBuiltinToolsForRun({
    graphicalToolsAllowed: false,
    groupId: null,
    trigger: "user",
    semanticMemoryEnabled: false,
    messagingChannelRun: false,
  });
}

function offeredPrograms(): unknown {
  const ocsc = ownerRun().find((tool) => tool.name === "ocsc");
  return (ocsc?.inputSchema as { properties: { program: { enum: unknown } } } | undefined)
    ?.properties.program.enum;
}

describe("OCSC programs an admin switched off", () => {
  it("follows the switched-off built-in skills, whatever their case", () => {
    expect([
      ...switchedOffOcscPrograms(["OCSC-Video", "ocsc-pdf-markup", "evolve-plugin"]),
    ]).toEqual(["video"]);
    expect([...switchedOffOcscPrograms(["ocsc-slides", "ocsc-excel"])].sort()).toEqual([
      "pptx",
      "xlsx",
    ]);
    expect(switchedOffOcscPrograms([]).size).toBe(0);
  });

  it("refuses the program in the ocsc tool and in shell", () => {
    const off = new Set(["video"]);
    expect(ocscProgramRefusal("video", off)).toMatch(/switched off/);
    expect(ocscProgramRefusal("pptx", off)).toBeUndefined();
    expect(ocscShellRefusal("OCSC_AUTHOR='K' ocsc-video 'render'", off)).toMatch(/switched off/);
    expect(ocscShellRefusal("cd out && /usr/local/bin/ocsc-video --help", off)).toMatch(
      /switched off/,
    );
    expect(ocscShellRefusal("ocsc-pptx new --spec deck.json", off)).toBeUndefined();
    expect(ocscShellRefusal("ls ocsc-videos-archive", off)).toBeUndefined();
  });

  it("leaves the program out of the ocsc tool offered to a run", () => {
    expect(offeredPrograms()).toEqual(["word", "pptx", "xlsx", "pdf", "video"]);
    setCompanyPolicy({ tools: { ...DEFAULT_COMPANY_TOOLS, disabledSkills: ["ocsc-video"] } });
    expect(offeredPrograms()).toEqual(["word", "pptx", "xlsx", "pdf"]);
  });

  it("names only the files the ocsc tool still makes", () => {
    expect(ocscFileKinds(new Set())).toBe("Word, PowerPoint, Excel, PDF and video files");
    expect(ocscFileKinds(new Set(["video"]))).toBe("Word, PowerPoint, Excel and PDF files");
    expect(ocscFileKinds(new Set(["word", "pptx", "xlsx", "video"]))).toBe("PDF files");
  });

  it("drops the ocsc tool when every program is off", () => {
    const tools = [{ name: "ocsc" }, { name: "shell" }];
    const all = new Set(["word", "pptx", "xlsx", "pdf", "video"]);
    expect(withOcscProgramsOffered(tools, all).map((tool) => tool.name)).toEqual(["shell"]);
  });
});
