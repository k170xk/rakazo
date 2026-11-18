import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import type { AdapterContext } from "@rakazo/adapter-kit";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolRunnerWorkspace } from "./tool-runner.js";
import { folderFiles } from "./tool-runner.js";
import {
  documentWording,
  matchEditPhrases,
  matchWordEditOnRunner,
  paragraphTexts,
  zipEntry,
} from "./word-edit-match.js";

function zip(files: Record<string, string>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const raw = Buffer.from(text);
    const packed = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const paragraph = (...runs: string[]) =>
  `<w:p><w:pPr><w:numPr/></w:pPr>${runs.map((r) => `<w:r><w:t xml:space="preserve">${r}</w:t></w:r>`).join("")}</w:p>`;

const documentXml = `<w:document><w:body>${[
  paragraph("The Licensee", "\u2019s obligations under this clause survive termination."),
  `<w:p><w:r><w:delText>Old wording</w:delText></w:r><w:ins><w:r><w:t>Fees are due within 30 days \u2013 net.</w:t></w:r></w:ins></w:p>`,
  paragraph("Each party", "\u2019s rights are reserved."),
  paragraph("Each party", "'s rights are reserved."),
  paragraph("R&amp;D costs are shared."),
].join("")}</w:body></w:document>`;

describe("paragraphTexts", () => {
  it("reads current text across runs and leaves deleted text out", () => {
    const texts = paragraphTexts(documentXml);
    expect(texts[0]).toBe("The Licensee\u2019s obligations under this clause survive termination.");
    expect(texts[1]).toBe("Fees are due within 30 days \u2013 net.");
    expect(texts[4]).toBe("R&D costs are shared.");
  });
});

describe("documentWording", () => {
  const texts = paragraphTexts(documentXml);

  it("matches plain apostrophes and dashes to the document's characters", () => {
    expect(documentWording("The Licensee's obligations", texts)).toBe(
      "The Licensee\u2019s obligations",
    );
    expect(documentWording("30 days - net", texts)).toBe("30 days \u2013 net");
  });

  it("drops a clause number Word draws itself", () => {
    expect(documentWording("6.5 The Licensee's obligations", texts)).toBe(
      "The Licensee\u2019s obligations",
    );
    expect(documentWording("(a) Fees are due", texts)).toBe("Fees are due");
  });

  it("matches a different case only when nothing matches as typed", () => {
    expect(documentWording("the licensee's OBLIGATIONS", texts)).toBe(
      "The Licensee\u2019s obligations",
    );
  });

  it("leaves a phrase that means more than one wording", () => {
    expect(documentWording("Each party's rights", texts)).toBeNull();
  });

  it("leaves a phrase that is not in the document", () => {
    expect(documentWording("indemnity cap", texts)).toBeNull();
  });
});

describe("matchEditPhrases", () => {
  const texts = paragraphTexts(documentXml);

  it("fixes quoted phrases and leaves exact ones and replacements alone", () => {
    const spec = {
      edits: [
        { op: "replace_text", find: "Licensee's obligations", replace: "Licensee's duties" },
        { op: "replace_text", find: "R&D costs", replace: "Research costs" },
        {
          op: "replace_paragraphs",
          from: "6.5 The Licensee's obligations",
          to: "survive termination.",
          paragraphs: ["New"],
        },
      ],
    };
    const result = matchEditPhrases(spec, texts);
    expect(result.spec).toEqual({
      edits: [
        { op: "replace_text", find: "Licensee\u2019s obligations", replace: "Licensee's duties" },
        { op: "replace_text", find: "R&D costs", replace: "Research costs" },
        {
          op: "replace_paragraphs",
          from: "The Licensee\u2019s obligations",
          to: "survive termination.",
          paragraphs: ["New"],
        },
      ],
    });
    expect(result.matched.map((m) => m.field)).toEqual(["find", "from"]);
  });

  it("accepts a bare list of edits", () => {
    const result = matchEditPhrases([{ op: "format_text", find: "30 days - net" }], texts);
    expect(result.spec).toEqual([{ op: "format_text", find: "30 days \u2013 net" }]);
  });
});

describe("matchWordEditOnRunner", () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("writes a matched spec next to the original and points the edit at it", async () => {
    root = await mkdtemp(path.join(tmpdir(), "word-match-"));
    const folder = path.join(root, "chat");
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, "contract.docx"),
      zip({ "word/document.xml": documentXml, "[Content_Types].xml": "<Types/>" }),
    );
    await writeFile(
      path.join(folder, "edits.json"),
      JSON.stringify([{ op: "replace_text", find: "Licensee's obligations", replace: "x" }]),
    );
    const workspace: ToolRunnerWorkspace = {
      base: root,
      mount: "/workspace",
      cwd: "chat",
      root,
    } as ToolRunnerWorkspace;
    const args = ["edit", "--in", "contract.docx", "--spec", "edits.json", "--out", "v2.docx"];
    const result = await matchWordEditOnRunner(
      folderFiles(root),
      workspace,
      args,
      {} as AdapterContext,
    );
    expect(result?.args).toEqual([
      "edit",
      "--in",
      "contract.docx",
      "--spec",
      "edits.matched.json",
      "--out",
      "v2.docx",
    ]);
    const written = JSON.parse(await readFile(path.join(folder, "edits.matched.json"), "utf8"));
    expect(written[0].find).toBe("Licensee\u2019s obligations");
  });

  it("leaves the command alone when every phrase is already exact or a path leaves the folder", async () => {
    root = await mkdtemp(path.join(tmpdir(), "word-match-"));
    await writeFile(path.join(root, "contract.docx"), zip({ "word/document.xml": documentXml }));
    await writeFile(
      path.join(root, "edits.json"),
      JSON.stringify([{ op: "replace_text", find: "R&D costs", replace: "x" }]),
    );
    const workspace = { base: root, mount: "/w", cwd: ".", root } as ToolRunnerWorkspace;
    const files = folderFiles(root);
    const ctx = {} as AdapterContext;
    expect(
      await matchWordEditOnRunner(
        files,
        workspace,
        ["edit", "--in", "contract.docx", "--spec", "edits.json"],
        ctx,
      ),
    ).toBeNull();
    expect(
      await matchWordEditOnRunner(
        files,
        workspace,
        ["edit", "--in", "../x.docx", "--spec", "edits.json"],
        ctx,
      ),
    ).toBeNull();
  });
});

describe("zipEntry", () => {
  it("returns null for a missing entry", () => {
    expect(zipEntry(zip({ "a.xml": "<a/>" }), "word/document.xml", 1024)).toBeNull();
  });
});
