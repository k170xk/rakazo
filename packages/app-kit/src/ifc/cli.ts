import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { IFC_RUNTIME, ifcRuntimePin } from "./runtime.js";

/**
 * Puts the pinned IFC engine where the web server serves it.
 *
 *   tsx cli.ts install [--version <v>] [--out <dir>]
 */

const WEB_PUBLIC = path.resolve(import.meta.dirname, "../../../../apps/web/public/ifc");
const releaseUrl = (version: string, name: string) =>
  `https://cdn.jsdelivr.net/npm/web-ifc@${version}/${name}`;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function install(version: string, out: string) {
  const pin = ifcRuntimePin(version);
  if (!pin) throw new Error(`${version} is not a pinned IFC engine.`);
  const dir = path.join(out, version);
  await mkdir(dir, { recursive: true });
  for (const name of Object.keys(pin.files)) {
    const expected = pin.files[name]!;
    const target = path.join(dir, name);
    const existing = await readFile(target).catch(() => null);
    if (existing && existing.byteLength === expected.bytes && sha256(existing) === expected.sha256) continue;
    const response = await fetch(releaseUrl(version, name));
    if (!response.ok) throw new Error(`${name}: ${response.status} ${response.statusText}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== expected.bytes || sha256(bytes) !== expected.sha256) {
      throw new Error(`${name} does not match the pinned IFC engine.`);
    }
    await writeFile(target, bytes);
  }
}

function option(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
}

async function main(args: string[]) {
  if (args[0] !== "install") {
    process.stderr.write("Usage: tsx cli.ts install [--version <v>] [--out <dir>]\n");
    process.exitCode = 2;
    return;
  }
  await install(option(args, "--version") ?? IFC_RUNTIME.version, option(args, "--out") ?? WEB_PUBLIC);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
