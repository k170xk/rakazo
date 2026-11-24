import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ToolRunnerClient } from "@rakazo/adapters";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppExtractError,
  extractFileForApp,
  readExtractBody,
  resetAppExtracts,
} from "./app-extract.js";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR4nGP4z8DAwMAAAA8AAf4i7J8AAAAASUVORK5CYII=",
  "base64",
);

describe("extractFileForApp", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetAppExtracts();
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "app-extract-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("runs ocsc-extract on the tool runner, returns text/tables/title-block/pages, and cleans up", async () => {
    let seenRoot = "";
    const run = vi.fn(async (req: Parameters<ToolRunnerClient["run"]>[0]) => {
      seenRoot = req.workspace.root;
      expect(req.program).toBe("extract");
      expect(req.args).toContain("--render-pages");
      expect(req.args).toContain("--ocr");
      expect(req.args).toContain("--title-block");
      expect(req.workspace.mount).toMatch(/^tool-work\/documents\/app-extract-/);

      const outDir = path.join(req.workspace.root, "work/extracted/drawing");
      await mkdir(path.join(outDir, "tables"), { recursive: true });
      await mkdir(path.join(outDir, "pages"), { recursive: true });
      await writeFile(path.join(outDir, "text.txt"), "Project: Athlone Bridge\nDWG: OCSC-001\n");
      await writeFile(path.join(outDir, "ocr.txt"), "REV P03 SCALE 1:100");
      await writeFile(
        path.join(outDir, "tables/page-01-table-01.csv"),
        "Rev,Date,Description\nP03,2026-11-24,Issued for Tender\n",
      );
      await writeFile(path.join(outDir, "pages/page-001.png"), TINY_PNG);
      await writeFile(path.join(outDir, "pages/page-001-titleblock.png"), TINY_PNG);

      const manifest = {
        ok: true,
        command: "run",
        filesProcessed: 1,
        files: [
          {
            source: "attachments/Drawing_001.pdf",
            type: "pdf",
            bytes: 1234,
            totalPages: 1,
            hasSelectableText: true,
            textFile: "work/extracted/drawing/text.txt",
            ocrFile: "work/extracted/drawing/ocr.txt",
            tables: [
              {
                page: 1,
                rows: 2,
                columns: 3,
                headers: ["Rev", "Date", "Description"],
                csv: "work/extracted/drawing/tables/page-01-table-01.csv",
              },
            ],
            renderedPages: [
              { page: 1, path: "work/extracted/drawing/pages/page-001.png", width: 2, height: 2 },
            ],
            titleBlockImages: [
              {
                page: 1,
                path: "work/extracted/drawing/pages/page-001-titleblock.png",
                width: 2,
                height: 2,
              },
            ],
            images: [],
          },
        ],
      };
      return { code: 0, stdout: JSON.stringify(manifest), stderr: "" };
    });

    const body = readExtractBody({
      name: "Drawing_001.pdf",
      mime: "application/pdf",
      base64: Buffer.from("%PDF-1.4 fake").toString("base64"),
      renderPages: true,
      ocr: true,
      titleBlock: true,
      maxPages: 2,
    });
    expect(body).not.toBeNull();

    const result = await extractFileForApp(
      { toolRunner: { run } as unknown as ToolRunnerClient, dataDir: tmpDir },
      { ...body!, userId: "u-donal" },
    );

    expect(result.ok).toBe(true);
    expect(result.kind).toBe("pdf");
    expect(result.text).toContain("Athlone Bridge");
    expect(result.ocrText).toBe("REV P03 SCALE 1:100");
    expect(result.tables).toEqual([
      {
        name: "Page 1",
        headers: ["Rev", "Date", "Description"],
        rows: [["P03", "2026-11-24", "Issued for Tender"]],
        totalRows: 1,
      },
    ]);
    expect(result.titleBlockImage?.dataUrl).toBe(
      `data:image/png;base64,${TINY_PNG.toString("base64")}`,
    );
    expect(result.pageImages).toHaveLength(1);
    // Ephemeral workspace is cleaned up immediately
    expect(seenRoot).not.toBe("");
    expect(existsSync(seenRoot)).toBe(false);
  });

  it("refuses when toolRunner is not configured", async () => {
    const body = readExtractBody({
      name: "test.pdf",
      base64: Buffer.from("abc").toString("base64"),
    })!;
    await expect(
      extractFileForApp({}, { ...body, userId: "u1" }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("rejects empty files and enforces rate limits", async () => {
    expect(readExtractBody({ name: "", base64: "abc" })).toBeNull();
    const run = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({ ok: true, files: [{ type: "txt", preview: "hi" }] }),
      stderr: "",
    }));
    const body = readExtractBody({
      name: "note.txt",
      base64: Buffer.from("hi").toString("base64"),
    })!;
    for (let i = 0; i < 30; i += 1) {
      await extractFileForApp(
        { toolRunner: { run } as unknown as ToolRunnerClient, dataDir: tmpDir },
        { ...body, userId: "rate-user" },
      );
    }
    await expect(
      extractFileForApp(
        { toolRunner: { run } as unknown as ToolRunnerClient, dataDir: tmpDir },
        { ...body, userId: "rate-user" },
      ),
    ).rejects.toBeInstanceOf(AppExtractError);
  });
});
