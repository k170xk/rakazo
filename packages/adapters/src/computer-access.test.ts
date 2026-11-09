import { DEFAULT_COMPANY_FEATURES, DEFAULT_COMPANY_TOOLS } from "@rakazo/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { companyToolsWithDefaults, setCompanyPolicy } from "./company-policy.js";
import {
  effectiveComputerAccess,
  runComputerAccess,
  sharedConversationRun,
  toolRunnersShareHome,
} from "./computer-access.js";
import { conversationFolder, resolveRunFilePath } from "./computer-support.js";
import {
  isWordDocument,
  NEW_DOCUMENT_FLAG,
  ocscCommand,
  ocscProgramArgs,
  videoQueuePlace,
  wordRebuildRefusal,
} from "./ocsc-tool.js";
import { limitedComputerInstruction } from "./run-instructions.js";
import {
  COMPUTER_TOOL_NAMES,
  computerAccessRefusal,
  selectBuiltinToolsForRun,
  TOOLS_ONLY_COMPUTER_TOOLS,
} from "./run-tool-selection.js";

afterEach(() => {
  setCompanyPolicy({ features: null, tools: null });
});

describe("computer access levels", () => {
  it("follows the company default until an admin sets a person's own level", () => {
    setCompanyPolicy({ tools: DEFAULT_COMPANY_TOOLS });
    expect(effectiveComputerAccess(null)).toBe("tools");
    expect(effectiveComputerAccess("full")).toBe("full");
    expect(effectiveComputerAccess("unknown")).toBe("tools");
    setCompanyPolicy({ tools: { ...DEFAULT_COMPANY_TOOLS, defaultComputerAccess: "none" } });
    expect(effectiveComputerAccess(null)).toBe("none");
  });

  it("starts at Tools only unless the deployment or an admin chose another default", () => {
    expect(companyToolsWithDefaults({}, {}).defaultComputerAccess).toBe("tools");
    const deployment = { RAKAZO_COMPUTER_ACCESS_DEFAULT: "full" };
    expect(companyToolsWithDefaults({}, deployment).defaultComputerAccess).toBe("full");
    expect(
      companyToolsWithDefaults({ defaultComputerAccess: "none" }, deployment).defaultComputerAccess,
    ).toBe("none");
  });

  it("gives nobody a computer while the company switch is off", () => {
    setCompanyPolicy({ features: { ...DEFAULT_COMPANY_FEATURES, computers: false } });
    expect(effectiveComputerAccess("full")).toBe("none");
  });

  it("never gives a colleague's turn more than the OCSC tools on the owner's computer", () => {
    expect(runComputerAccess("full", true)).toBe("tools");
    expect(runComputerAccess("tools", true)).toBe("tools");
    expect(runComputerAccess("none", true)).toBe("none");
    expect(runComputerAccess("full", false)).toBe("full");
  });

  it("treats every chat other people can read as shared, the owner's own turns included", () => {
    const run = (input: Partial<Parameters<typeof sharedConversationRun>[0]>) =>
      sharedConversationRun({
        colleagueTurn: false,
        groupHasColleagues: false,
        externalConversation: false,
        ...input,
      });
    expect(run({})).toBe(false);
    expect(run({ colleagueTurn: true })).toBe(true);
    expect(run({ groupHasColleagues: true })).toBe(true);
    expect(run({ externalConversation: true })).toBe(true);
  });

  it("tells the owner in a shared chat why their own files are not there", () => {
    expect(limitedComputerInstruction("tools", "owner")).toContain(
      "files from the owner's private chats are not here",
    );
    expect(limitedComputerInstruction("tools", "colleague")).toContain("someone else's bot");
    expect(limitedComputerInstruction("tools", undefined)).not.toContain("shared");
  });

  it("keeps runners out of a home that the owner's computer keeps its own copy of", () => {
    expect(toolRunnersShareHome("full", true)).toBe(true);
    expect(toolRunnersShareHome("full", false)).toBe(false);
    expect(toolRunnersShareHome("tools", false)).toBe(true);
    expect(toolRunnersShareHome("none", false)).toBe(true);
  });
});

describe("tools for each level", () => {
  const base = {
    graphicalToolsAllowed: true,
    pageBrowserAllowed: true,
    groupId: null,
    trigger: "user",
    semanticMemoryEnabled: false,
    messagingChannelRun: false,
    conversationFiles: true,
  };
  const names = (computerAccess: "full" | "tools" | "none") =>
    new Set(
      selectBuiltinToolsForRun({ ...base, computerAccess, evolvePluginsEnabled: true }).map(
        (tool) => tool.name,
      ),
    );

  it("offers Tools only the OCSC tool and files, never the shell, screen or browser", () => {
    const tools = names("tools");
    for (const name of TOOLS_ONLY_COMPUTER_TOOLS) expect(tools.has(name)).toBe(true);
    for (const name of ["shell", "computer_act", "browser_navigate", "request_takeover"])
      expect(tools.has(name)).toBe(false);
    expect(tools.has("evolve_plugin_submit")).toBe(false);
  });

  it("offers no computer tools without access, and everything with Full", () => {
    const none = names("none");
    for (const name of COMPUTER_TOOL_NAMES) expect(none.has(name)).toBe(false);
    const full = names("full");
    expect(full.has("shell")).toBe(true);
    expect(full.has("ocsc")).toBe(true);
    expect(full.has("evolve_plugin_submit")).toBe(true);
  });

  it("refuses a computer tool above the level even when it is called anyway", () => {
    expect(computerAccessRefusal("shell", "tools")).toContain("OCSC");
    expect(computerAccessRefusal("user_computer_shell", "tools")).toBeDefined();
    expect(computerAccessRefusal("ocsc", "tools")).toBeUndefined();
    expect(computerAccessRefusal("write_file", "none")).toContain("no computer access");
    expect(computerAccessRefusal("web_search", "none")).toBeUndefined();
    expect(computerAccessRefusal("shell", "full")).toBeUndefined();
  });
});

describe("a colleague's turn stays in its conversation folder", () => {
  const folder = conversationFolder("thread-1");
  const resolve = (raw: string) => resolveRunFilePath({ mode: "team", botId: "b1", folder }, raw);

  it("puts relative, absolute and home paths inside the folder", () => {
    expect(resolve("outputs/Report.docx")).toBe("conversations/thread-1/outputs/Report.docx");
    expect(resolve("/home/rakazo/bots/b1/secret.txt")).toBe(
      "conversations/thread-1/home/rakazo/bots/b1/secret.txt",
    );
    expect(resolve("~/bots/b1/notes.md")).toBe("conversations/thread-1/bots/b1/notes.md");
    expect(resolve("bots/b1/notes.md")).toBe("conversations/thread-1/bots/b1/notes.md");
    expect(resolve("conversations/thread-2/x.pdf")).toBe(
      "conversations/thread-1/conversations/thread-2/x.pdf",
    );
  });

  it("accepts a path a command printed from inside the folder", () => {
    expect(resolve("/home/rakazo/conversations/thread-1/outputs/Deck.pptx")).toBe(
      "conversations/thread-1/outputs/Deck.pptx",
    );
  });

  it("refuses to climb out of it", () => {
    expect(() => resolve("../../bots/b1/secret.txt")).toThrow("escapes");
    expect(() => resolve("/home/rakazo/conversations/thread-1/../../bots/b1/x")).toThrow("escapes");
  });

  it("leaves the owner's own turns in the bot's folder", () => {
    expect(
      resolveRunFilePath({ mode: "team", botId: "b1", folder: undefined }, "outputs/a.docx"),
    ).toBe("bots/b1/outputs/a.docx");
  });
});

describe("ocsc command line", () => {
  it("quotes every argument so none can start another command", () => {
    expect(ocscCommand("word", ["create", "--spec", "a b.json", "x'; rm -rf ~; '"])).toBe(
      `ocsc-word 'create' '--spec' 'a b.json' 'x'\\''; rm -rf ~; '\\'''`,
    );
  });

  it("runs a colleague's command with its workspace set to the conversation folder", () => {
    expect(ocscCommand("pptx", ["create"], "conversations/t1")).toBe(
      `mkdir -p 'conversations/t1' && cd 'conversations/t1' && WORKSPACE_DIR="$PWD" ocsc-pptx 'create'`,
    );
  });

  it("names the person as the author, quoted so a name cannot run a command", () => {
    expect(ocscCommand("word", ["edit"], undefined, "Keith O'Neill; rm -rf ~")).toBe(
      `OCSC_AUTHOR='Keith O'\\''Neill; rm -rf ~' ocsc-word 'edit'`,
    );
    expect(ocscCommand("word", ["edit"], "conversations/t1", "Ann")).toBe(
      `mkdir -p 'conversations/t1' && cd 'conversations/t1' && WORKSPACE_DIR="$PWD" OCSC_AUTHOR='Ann' ocsc-word 'edit'`,
    );
  });
});

describe("editing rather than rebuilding Word documents", () => {
  const report = [{ name: "Report.docx", path: "attachments/a1.docx" }];

  it("refuses a new document in a conversation that already has one", () => {
    const refusal = wordRebuildRefusal(
      "word",
      ["new", "--spec", "s.json", "--out", "x.docx"],
      report,
    );
    expect(refusal).toContain('"Report.docx" (attachments/a1.docx)');
    expect(refusal).toContain("ocsc word edit --in");
    expect(refusal).toContain(NEW_DOCUMENT_FLAG);
  });

  it("refuses to overwrite an existing document even in a new conversation", () => {
    expect(
      wordRebuildRefusal("word", ["new", "--spec", "s.json", "--out", "x.docx", "--overwrite"], []),
    ).toContain("replace an existing Word document");
  });

  it("allows a first document, a brand-new one asked for, and every edit", () => {
    expect(wordRebuildRefusal("word", ["new", "--spec", "s.json", "--out", "x.docx"], [])).toBe(
      undefined,
    );
    expect(
      wordRebuildRefusal("word", ["new", "--spec", "s.json", NEW_DOCUMENT_FLAG], report),
    ).toBeUndefined();
    expect(wordRebuildRefusal("word", ["edit", "--in", "attachments/a1.docx"], report)).toBe(
      undefined,
    );
    expect(wordRebuildRefusal("pptx", ["new", "--spec", "s.json"], report)).toBeUndefined();
  });

  it("never passes the flag to the program", () => {
    expect(ocscProgramArgs(["new", NEW_DOCUMENT_FLAG, "--spec", "s.json"])).toEqual([
      "new",
      "--spec",
      "s.json",
    ]);
  });

  it("recognises Word documents by type or name", () => {
    expect(
      isWordDocument(
        "upload",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
    expect(isWordDocument("Spec.DOCX", "application/octet-stream")).toBe(true);
    expect(isWordDocument("deck.pptx", null)).toBe(false);
  });
});

describe("video render line", () => {
  const job = (key: string, userId: string, state: "running" | "queued") => ({
    key,
    userId,
    state,
  });

  it("starts at once while a slot is free", () => {
    expect(videoQueuePlace([], { key: "a:1", userId: "a" }, 3)).toBe(0);
    expect(videoQueuePlace([job("b:1", "b", "running")], { key: "a:1", userId: "a" }, 2)).toBe(0);
  });

  it("queues behind earlier renders when every slot is taken", () => {
    const rows = [job("b:1", "b", "running"), job("c:1", "c", "queued")];
    expect(videoQueuePlace(rows, { key: "d:1", userId: "d" }, 1)).toBe(2);
    expect(videoQueuePlace(rows, { key: "c:1", userId: "c" }, 1)).toBe(1);
  });

  it("puts someone with no render ahead of someone who already has one", () => {
    const rows = [job("b:1", "b", "running"), job("b:2", "b", "queued"), job("c:1", "c", "queued")];
    expect(videoQueuePlace(rows, { key: "c:1", userId: "c" }, 1)).toBe(1);
    expect(videoQueuePlace(rows, { key: "b:2", userId: "b" }, 1)).toBe(2);
    expect(videoQueuePlace(rows, { key: "c:1", userId: "c" }, 2)).toBe(0);
  });
});
