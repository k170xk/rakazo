#!/usr/bin/env node
/**
 * OCSC Extract: universal offline extractor for Word (.docx/.doc), PowerPoint (.pptx),
 * Excel (.xlsx/.xlsm/.xls), PDF (.pdf), CSV/TSV, HTML/RTF/ODT/TXT/JSON/XML, images, and ZIPs.
 *
 *   ocsc-extract inspect --in attachments/Report.docx [--in attachments/Data.xlsx ...]
 *   ocsc-extract run --in attachments/Report.docx [--in ...] [--out work/extracted] [--render-pages] [--pages 1-8] [--dpi 150]
 *   ocsc-extract all [--dir attachments] [--out work/extracted] [--render-pages]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPER = join(HERE, "extract_helper.py");
const WORKSPACE = resolve(process.env.WORKSPACE_DIR || process.env.HOME || process.cwd());

const USAGE = `ocsc-extract inspect --in <file> [--in <file2> ...] [--all]
ocsc-extract run --in <file> [--in <file2> ...] [--out work/extracted] [--render-pages] [--ocr] [--title-block] [--pages 1-10] [--max-pages 12] [--dpi 150] [--no-images] [--no-tables]
ocsc-extract all [--dir attachments] [--out work/extracted] [--render-pages] [--ocr] [--title-block] [--pages 1-10] [--dpi 150]`;

class UsageError extends Error {}

function parseArgs(argv) {
  const inputs = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--in" || a === "-i") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new UsageError("--in requires a file path.");
      inputs.push(next);
      i += 1;
      continue;
    }
    if (a.startsWith("--in=")) {
      inputs.push(a.slice(5));
      continue;
    }
    if (!a.startsWith("--")) {
      inputs.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    if (eq > 0) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return { inputs, flags };
}

function inWorkspace(p, label) {
  if (typeof p !== "string" || !p.trim()) throw new UsageError(`${label} is required.`);
  const full = isAbsolute(p) ? resolve(p) : resolve(WORKSPACE, p);
  const rel = relative(WORKSPACE, full);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new UsageError(`${label} must stay inside the workspace (${WORKSPACE}).`);
  }
  return { full, rel: rel.split("\\").join("/") };
}

function collectFilesInDir(dirPath) {
  const { full } = inWorkspace(dirPath, "--dir");
  if (!existsSync(full)) return [];
  const entries = readdirSync(full).sort();
  const out = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const p = join(full, name);
    try {
      if (statSync(p).isFile()) out.push(p);
    } catch {}
  }
  return out;
}

function findPython() {
  for (const bin of [process.env.OCSC_PYTHON_BIN, "/usr/bin/python3", "python3"]) {
    if (!bin) continue;
    const probe = spawnSync(bin, ["--version"], { stdio: "ignore" });
    if (probe.status === 0) return bin;
  }
  throw new Error("python3 is not available on this runner.");
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${JSON.stringify({ ok: true, usage: USAGE }, null, 2)}\n`);
    return;
  }
  try {
    if (!["inspect", "run", "all"].includes(command)) {
      throw new UsageError(`Unknown subcommand "${command}".\n${USAGE}`);
    }
    const { inputs, flags } = parseArgs(rest);
    const inspectOnly = command === "inspect";
    let resolvedInputs = [];

    if (command === "all" || flags.all === true) {
      const dir = typeof flags.dir === "string" ? flags.dir : "attachments";
      resolvedInputs = collectFilesInDir(dir);
      if (resolvedInputs.length === 0) {
        throw new UsageError(
          `No files found in ${dir}/. Call fetch_file first for each uploaded file, or pass --in <path>.`,
        );
      }
    } else {
      if (inputs.length === 0) {
        throw new UsageError(`At least one --in <path> is required.\n${USAGE}`);
      }
      for (const raw of inputs) {
        const { full } = inWorkspace(raw, "--in");
        if (!existsSync(full)) {
          throw new UsageError(`File not found: ${raw}`);
        }
        if (statSync(full).isDirectory()) {
          resolvedInputs.push(...collectFilesInDir(raw));
        } else {
          resolvedInputs.push(full);
        }
      }
    }

    const outArg = typeof flags.out === "string" ? flags.out : "work/extracted";
    const { full: outDir } = inWorkspace(outArg, "--out");
    const dpi = Math.min(Math.max(Number.parseInt(String(flags.dpi ?? "150"), 10) || 150, 72), 300);
    const maxPages = Math.min(Math.max(Number.parseInt(String(flags["max-pages"] ?? "12"), 10) || 12, 1), 50);

    const payload = {
      workspace: WORKSPACE,
      outDir,
      inputs: resolvedInputs,
      options: {
        inspectOnly,
        extractImages: flags["no-images"] !== true,
        extractTables: flags["no-tables"] !== true,
        renderPages: flags["render-pages"] === true,
        ocr: flags.ocr === true,
        titleBlock: flags["title-block"] === true,
        pages: typeof flags.pages === "string" ? flags.pages : null,
        maxPages,
        dpi,
        recursive: flags["no-recursive"] !== true,
      },
    };

    const python = findPython();
    const res = spawnSync(python, [HELPER], {
      cwd: WORKSPACE,
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 20 * 1024 * 1024,
      env: {
        PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        HOME: process.env.HOME || "/tmp",
        LANG: "C.UTF-8",
        PYTHONDONTWRITEBYTECODE: "1",
        WORKSPACE_DIR: WORKSPACE,
      },
    });
    if (res.error) throw res.error;
    if (res.status !== 0) {
      throw new Error((res.stderr || res.stdout || `Extractor exited with status ${res.status}`).trim());
    }
    process.stdout.write(res.stdout.endsWith("\n") ? res.stdout : `${res.stdout}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: error instanceof UsageError ? error.message : String(error?.message || error) }, null, 2)}\n`,
    );
    process.exit(1);
  }
}

main();
