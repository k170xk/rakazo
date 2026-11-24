import type { AdapterContext, ComputerRef } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { inlineOcscSpec, OCSC_PROGRAMS } from "./ocsc-tool.js";
import { computerAccessRefusal, selectBuiltinToolsForRun } from "./run-tool-selection.js";
import { RUNNER_PROGRAMS } from "./tool-runner.js";
import { type RunWorkspace, readFileFromTool } from "./workspace-file-tools.js";

const TINY_PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR4nGP4z8DAwMAAAA8AAf4i7J8AAAAASUVORK5CYII=",
    "base64",
  ),
);

describe("ocsc extract and offline python on tool runners (no full computer required)", () => {
  it("registers extract and python in both OCSC_PROGRAMS and RUNNER_PROGRAMS", () => {
    expect(OCSC_PROGRAMS.has("extract")).toBe(true);
    expect(OCSC_PROGRAMS.has("python")).toBe(true);
    expect(RUNNER_PROGRAMS.has("extract")).toBe(true);
    expect(RUNNER_PROGRAMS.has("python")).toBe(true);
  });

  it("allows ocsc (extract/python) for tools-only staff while still blocking shell", () => {
    expect(computerAccessRefusal("ocsc", "tools")).toBeUndefined();
    expect(computerAccessRefusal("shell", "tools")).toBeDefined();

    const tools = selectBuiltinToolsForRun({
      graphicalToolsAllowed: false,
      groupId: null,
      trigger: "user",
      semanticMemoryEnabled: false,
      messagingChannelRun: false,
      computerAccess: "tools",
    });
    const names = tools.map((t) => t.name);
    expect(names).toContain("ocsc");
    expect(names).toContain("read_file");
    expect(names).not.toContain("shell");
    const ocsc = tools.find((t) => t.name === "ocsc");
    const enumValues = (
      ocsc?.inputSchema as { properties?: { program?: { enum?: string[] } } } | undefined
    )?.properties?.program?.enum;
    expect(enumValues).toContain("extract");
    expect(enumValues).toContain("python");
  });

  it("saves raw Python code from inline spec for ocsc python run without JSON parsing", () => {
    const res = inlineOcscSpec("python", ["run"], "import pandas as pd\nprint(1 + 1)\n", "call-1");
    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      expect(res.path).toBe("work/call-1.py");
      expect(res.args).toEqual(["run", "--script", "work/call-1.py"]);
      expect(res.content).toContain("import pandas as pd");
    }
  });

  it("returns extracted PNG images as inline vision blocks from read_file when acceptsImages is true", async () => {
    const sandbox = {
      listFiles: vi.fn(),
      readFile: vi.fn(async () => TINY_PNG),
      writeFile: vi.fn(),
    };
    const baseWorkspace: RunWorkspace = {
      botId: "b1",
      computerMode: "team",
      computer: async () =>
        ({
          id: "runner",
          botId: "b1",
          kind: "computer",
          provider: "docker",
          providerRef: "runner",
        }) as unknown as ComputerRef,
      files: sandbox,
      markDirty: vi.fn(),
      context: { spaceId: "s1", userId: "u1" } as unknown as AdapterContext,
      runSecrets: [],
    };

    const withVision = await readFileFromTool(
      sandbox,
      { ...baseWorkspace, acceptsImages: true },
      { path: "work/extracted/report/images/img-01.png" },
    );
    expect(withVision).toMatchObject({
      kind: "agent_tool_result",
      content: [
        { type: "text" },
        { type: "image", mimeType: "image/png", data: Buffer.from(TINY_PNG).toString("base64") },
      ],
    });

    const withoutVision = await readFileFromTool(
      sandbox,
      { ...baseWorkspace, acceptsImages: false },
      { path: "work/extracted/report/images/img-01.png" },
    );
    expect(withoutVision).toMatchObject({
      path: "work/extracted/report/images/img-01.png",
      mimeType: "image/png",
    });
  });
});
