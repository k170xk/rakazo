#!/usr/bin/env node
/**
 * Writes src/templates/index.ts (every template, by name) and templates.json (their props and
 * descriptions, for `ocsc-video templates` and spec checks). Run by `npm run build`.
 */
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(HERE, "src", "templates");

const names = readdirSync(DIR)
  .filter((f) => f.endsWith(".tsx") && f !== "kit.tsx")
  .map((f) => f.slice(0, -4))
  .sort();

writeFileSync(
  join(DIR, "index.ts"),
  `// Written by scripts/templates.mjs. Do not edit.
import type { ComponentType } from "react";
import type { TemplateMeta } from "./kit";
${names.map((n, i) => `import T${i}, { meta as M${i} } from "./${n}";`).join("\n")}

type Entry = {
  Component: ComponentType<Record<string, unknown>>;
  meta: TemplateMeta;
};

export const templates: Record<string, Entry> = {
${names.map((n, i) => `  ${JSON.stringify(n)}: { Component: T${i} as ComponentType<Record<string, unknown>>, meta: M${i} },`).join("\n")}
};
`,
);

const { build } = await import("esbuild");
const out = join(HERE, ".work", "templates-meta.mjs");
await build({
  entryPoints: [join(DIR, "index.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react/*", "remotion", "react-dom", "@remotion/*"],
  loader: { ".png": "empty", ".jpg": "empty", ".svg": "empty" },
  outfile: out,
  logLevel: "error",
});
const { templates } = await import(pathToFileURL(out).href);
rmSync(out, { force: true });

const problems = [];
const catalogue = {};
for (const name of names) {
  const meta = templates[name]?.meta;
  if (!meta || meta.name !== name) problems.push(`${name}: meta.name must be "${name}"`);
  else catalogue[name] = meta;
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
writeFileSync(join(HERE, "templates.json"), `${JSON.stringify(catalogue, null, 2)}\n`);
console.log(`${names.length} templates`);
