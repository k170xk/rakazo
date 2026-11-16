import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PythonRuntimePin } from "./runtime.js";
import { PYTHON_PACKAGES, PYTHON_RUNTIMES, pythonFiles, pythonRuntimePin } from "./runtime.js";

/**
 * Puts every pinned Python runtime where the web server serves it, checking every file against the
 * hashes pinned in runtime.ts, so a deploy never serves a file the apps were not built against.
 *
 *   tsx cli.ts install [--version <v> [--from <url|dir>]] [--out <dir>]   download and check them
 *   tsx cli.ts pin <version> [--from <url|dir>]           print the manifest for runtime.ts
 *
 * --from defaults to the runtime's public release; a directory holds an unpacked release.
 */

const WEB_PUBLIC = path.resolve(import.meta.dirname, "../../../../apps/web/public/python");
const releaseUrl = (version: string) => `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;

type Lock = {
  info: { python: string };
  packages: Record<string, { file_name: string; sha256: string; depends: string[] }>;
};

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function fetchFile(from: string, name: string): Promise<Uint8Array> {
  if (!/^https?:\/\//.test(from)) return new Uint8Array(await readFile(path.join(from, name)));
  const response = await fetch(new URL(name, from.endsWith("/") ? from : `${from}/`));
  if (!response.ok) throw new Error(`${name}: ${response.status} ${response.statusText}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Every package a list needs, by name, dependencies first. */
export function packageClosure(lock: Lock, names: readonly string[]): string[] {
  const out: string[] = [];
  const visit = (name: string) => {
    if (out.includes(name)) return;
    const entry = lock.packages[name];
    if (!entry) throw new Error(`${name} is not in the runtime's lock file.`);
    for (const dependency of entry.depends) visit(dependency);
    out.push(name);
  };
  for (const name of names) visit(name);
  return out;
}

async function pin(version: string, from: string) {
  const files: Record<string, { sha256: string; bytes: number }> = {};
  const record = (name: string, bytes: Uint8Array) => {
    files[name] = { sha256: sha256(bytes), bytes: bytes.length };
  };
  for (const name of ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip"]) {
    record(name, await fetchFile(from, name));
  }
  const lockBytes = await fetchFile(from, "pyodide-lock.json");
  record("pyodide-lock.json", lockBytes);
  const lock = JSON.parse(new TextDecoder().decode(lockBytes)) as Lock;
  const packages: Record<string, string[]> = {};
  for (const name of PYTHON_PACKAGES) {
    packages[name] = packageClosure(lock, [name]).map((each) => lock.packages[each]!.file_name);
  }
  for (const name of new Set(Object.values(packages).flat())) {
    const bytes = await fetchFile(from, name);
    const entry = Object.values(lock.packages).find((each) => each.file_name === name)!;
    if (sha256(bytes) !== entry.sha256) throw new Error(`${name} does not match the lock file.`);
    record(name, bytes);
  }
  return { version, python: lock.info.python, files, packages };
}

/** Installs one pin's files into <out>/<version>, keeping any that already match. */
export async function install(pin: PythonRuntimePin, from: string, out: string) {
  const dir = path.join(out, pin.version);
  await mkdir(dir, { recursive: true });
  let total = 0;
  for (const name of pythonFiles(pin)) {
    const expected = pin.files[name]!;
    const target = path.join(dir, name);
    const existing = await readFile(target).catch(() => null);
    if (existing && sha256(existing) === expected.sha256) {
      total += existing.length;
      continue;
    }
    const bytes = await fetchFile(from, name);
    if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) {
      throw new Error(`${name} does not match the pinned hash; refusing to install it.`);
    }
    await writeFile(`${target}.partial`, bytes);
    await rename(`${target}.partial`, target);
    total += bytes.length;
  }
  process.stdout.write(
    `Python runtime ${pin.version} ready in ${dir} (${(total / 1e6).toFixed(1)} MB)\n`,
  );
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

async function main(args: string[]) {
  const [command, version] = args;
  if (command === "install") {
    const only = option(args, "--version");
    const pins = only ? [pythonRuntimePin(only)] : PYTHON_RUNTIMES;
    if (pins.some((pin) => !pin)) throw new Error(`${only} is not a pinned Python runtime.`);
    // --from names one release, so it only makes sense with a single pin.
    const from = option(args, "--from");
    if (from && pins.length > 1) throw new Error("--from needs --version.");
    for (const pin of pins as PythonRuntimePin[]) {
      await install(pin, from ?? releaseUrl(pin.version), option(args, "--out") ?? WEB_PUBLIC);
    }
  } else if (command === "pin" && version) {
    const manifest = await pin(version, option(args, "--from") ?? releaseUrl(version));
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } else {
    process.stderr.write(
      "Usage: tsx cli.ts install [--version <v> [--from <url|dir>]] [--out <dir>] | pin <version> [--from <url|dir>]\n",
    );
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
