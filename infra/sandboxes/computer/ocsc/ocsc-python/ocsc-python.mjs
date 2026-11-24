#!/usr/bin/env node
/**
 * OCSC Python: locked-down offline Python runner for multi-file data merging,
 * calculations, table processing, charting, and image prep inside a conversation's
 * isolated workspace (no network, read-only rootfs, bounded timeout and output).
 *
 *   ocsc-python run --script work/analyze.py [--timeout 120]
 *   ocsc-python run --code "import pandas as pd; print(pd.__version__)"
 *   ocsc-python libs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

const WORKSPACE = resolve(process.env.WORKSPACE_DIR || process.env.HOME || process.cwd());
const DEFAULT_TIMEOUT_SEC = 120;
const MAX_TIMEOUT_SEC = 240;
const MAX_OUTPUT_CHARS = 24_000;

const USAGE = `ocsc-python run --script work/analyze.py [--timeout 120]
ocsc-python run --code "import pandas as pd; ..." [--timeout 120]
ocsc-python libs`;

class UsageError extends Error {}

function parseArgs(argv) {
  const flags = {};
  const scriptArgs = [];
  let afterDoubleDash = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (afterDoubleDash) {
      scriptArgs.push(a);
      continue;
    }
    if (a === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!a.startsWith("--")) {
      scriptArgs.push(a);
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
  return { flags, scriptArgs };
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

function findPython() {
  for (const bin of [process.env.OCSC_PYTHON_BIN, "/usr/bin/python3", "python3"]) {
    if (!bin) continue;
    const probe = spawnSync(bin, ["--version"], { stdio: "ignore" });
    if (probe.status === 0) return bin;
  }
  throw new Error("python3 is not available on this runner.");
}

function snapshotFiles(rootDirs) {
  const map = new Map();
  const walk = (dir, depth) => {
    if (depth > 5 || !existsSync(dir)) return;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".") || name === "__pycache__") continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full, depth + 1);
      } else if (st.isFile()) {
        const rel = relative(WORKSPACE, full).split("\\").join("/");
        map.set(rel, { bytes: st.size, mtimeMs: st.mtimeMs });
      }
    }
  };
  for (const d of rootDirs) walk(join(WORKSPACE, d), 0);
  return map;
}

function imageDims(fullPath) {
  const ext = extname(fullPath).toLowerCase();
  if (![".png", ".jpg", ".jpeg"].includes(ext)) return {};
  try {
    const buf = readFileSync(fullPath);
    if (ext === ".png" && buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if ((ext === ".jpg" || ext === ".jpeg") && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) break;
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
  } catch {}
  return {};
}

function clipOutput(text) {
  if (!text || text.length <= MAX_OUTPUT_CHARS) return text || "";
  const half = Math.floor(MAX_OUTPUT_CHARS / 2) - 80;
  return `${text.slice(0, half)}\n... [${text.length - half * 2} chars truncated] ...\n${text.slice(-half)}`;
}

function cmdLibs() {
  const python = findPython();
  const probe = `
import json, sys
mods = ["pandas", "openpyxl", "matplotlib", "PIL", "docx", "pptx", "pypdf", "pdfplumber", "fitz", "reportlab", "pytesseract", "ezdxf", "extract_msg", "pillow_heif", "xlrd", "bs4", "lxml", "numpy", "scipy"]
installed = {}
for m in mods:
    try:
        mod = __import__(m)
        installed[m] = getattr(mod, "__version__", "installed")
    except Exception:
        pass
print(json.dumps({"ok": True, "python": sys.version.split()[0], "libraries": installed}, indent=2))
`;
  const res = spawnSync(python, ["-c", probe], { encoding: "utf8", timeout: 20_000 });
  if (res.status !== 0) throw new Error((res.stderr || res.stdout || "Failed to inspect Python libraries").trim());
  process.stdout.write(res.stdout);
}

function cmdRun(flags, scriptArgs) {
  const python = findPython();
  const timeoutSec = Math.min(
    Math.max(Number.parseInt(String(flags.timeout ?? DEFAULT_TIMEOUT_SEC), 10) || DEFAULT_TIMEOUT_SEC, 5),
    MAX_TIMEOUT_SEC,
  );

  let scriptFull;
  let scriptRel;
  if (typeof flags.script === "string" && flags.script.trim()) {
    ({ full: scriptFull, rel: scriptRel } = inWorkspace(flags.script, "--script"));
    if (!existsSync(scriptFull)) throw new UsageError(`Script not found: ${flags.script}`);
  } else if (typeof flags.code === "string" && flags.code.trim()) {
    const workDir = join(WORKSPACE, "work");
    mkdirSync(workDir, { recursive: true });
    scriptRel = `work/inline-${Date.now()}.py`;
    scriptFull = join(WORKSPACE, scriptRel);
    writeFileSync(scriptFull, flags.code, "utf8");
  } else {
    throw new UsageError(`Pass --script <path> or --code "<python>".\n${USAGE}`);
  }

  const scanDirs = ["work", "outputs"];
  const before = snapshotFiles(scanDirs);
  const started = Date.now();
  const res = spawnSync(python, [scriptFull, ...scriptArgs], {
    cwd: WORKSPACE,
    encoding: "utf8",
    timeout: timeoutSec * 1000,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      HOME: process.env.HOME || "/tmp",
      TMPDIR: "/tmp",
      LANG: "C.UTF-8",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONUNBUFFERED: "1",
      MPLBACKEND: "Agg",
      MPLCONFIGDIR: "/tmp/matplotlib",
      WORKSPACE_DIR: WORKSPACE,
    },
  });
  const durationMs = Date.now() - started;
  const after = snapshotFiles(scanDirs);

  const filesCreated = [];
  const filesModified = [];
  for (const [rel, meta] of after.entries()) {
    if (rel === scriptRel) continue;
    const prev = before.get(rel);
    if (!prev) {
      filesCreated.push({ path: rel, bytes: meta.bytes, ...imageDims(join(WORKSPACE, rel)) });
    } else if (prev.mtimeMs !== meta.mtimeMs || prev.bytes !== meta.bytes) {
      filesModified.push({ path: rel, bytes: meta.bytes, ...imageDims(join(WORKSPACE, rel)) });
    }
  }

  const timedOut = res.error?.code === "ETIMEDOUT";
  const ok = !timedOut && !res.error && res.status === 0;
  const result = {
    ok,
    script: scriptRel,
    exitCode: timedOut ? 124 : (res.status ?? 1),
    durationMs,
    ...(timedOut ? { error: `Python script timed out after ${timeoutSec}s.` } : {}),
    ...(res.error && !timedOut ? { error: String(res.error.message || res.error) } : {}),
    stdout: clipOutput(res.stdout),
    stderr: clipOutput(res.stderr),
    ...(filesCreated.length ? { filesCreated: filesCreated.slice(0, 50) } : {}),
    ...(filesModified.length ? { filesModified: filesModified.slice(0, 50) } : {}),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!ok) process.exit(1);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${JSON.stringify({ ok: true, usage: USAGE }, null, 2)}\n`);
    return;
  }
  try {
    if (command === "libs") {
      cmdLibs();
      return;
    }
    if (command === "run") {
      const { flags, scriptArgs } = parseArgs(rest);
      cmdRun(flags, scriptArgs);
      return;
    }
    throw new UsageError(`Unknown subcommand "${command}".\n${USAGE}`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: error instanceof UsageError ? error.message : String(error?.message || error) }, null, 2)}\n`,
    );
    process.exit(1);
  }
}

main();
