import { transform } from "sucrase";

/** Page JSX to a CommonJS body. The save check compiles once and keeps the viewer code. */
export function compilePageSource(source: string): string {
  return transform(source, {
    transforms: ["jsx", "imports"],
    jsxRuntime: "classic",
    production: true,
    filePath: "page.jsx",
  }).code;
}

const SOURCES_PRAGMA = /^\uFEFF?\s*\/\*(?!\*)[ \t]*page-sources[ \t]*\r?\n([\s\S]*?)\*\//;

/**
 * A page may open with a comment declaring data sources: `/* page-sources` then a JSON object
 * of snapshots keyed by id. useSource reads them back; a save with new data rewrites them.
 */
export function declaredSources(source: string): string {
  const match = SOURCES_PRAGMA.exec(source);
  if (!match) return "";
  let declared: unknown;
  try {
    declared = JSON.parse(match[1]!);
  } catch {
    throw new Error("The page-sources comment at the top of the page is not valid JSON.");
  }
  return declared && typeof declared === "object" && !Array.isArray(declared)
    ? `globalThis.__rakazoPageSources=${JSON.stringify(declared)};`
    : "";
}

/**
 * The page as the viewer runs it, compiled here so the viewer ships without the compiler. Its
 * sources are declared on the first line, so error line numbers still match the source, and a
 * page that cannot compile becomes code that throws, which the viewer shows as the page's error.
 */
export function pageViewerCode(source: string, compiled?: string): string {
  try {
    return `"use strict";${declaredSources(source)}${compiled ?? compilePageSource(source)}`;
  } catch (error) {
    return `throw new Error(${JSON.stringify(error instanceof Error ? error.message : String(error))});`;
  }
}

/**
 * The page with new snapshots for some of its sources, each stamped `asOf`, and the rest of the
 * page untouched, so a routine can refresh a page's figures without rewriting its code. A page
 * without the comment gets one.
 */
export function withSourceData(
  source: string,
  data: Record<string, unknown>,
  asOf: string,
): { ok: true; source: string; unused: string[] } | { ok: false; error: string } {
  const match = SOURCES_PRAGMA.exec(source);
  let declared: Record<string, unknown> = {};
  if (match) {
    try {
      const parsed: unknown = JSON.parse(match[1]!);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        declared = parsed as Record<string, unknown>;
      }
    } catch {
      return {
        ok: false,
        error: "The page-sources comment at the top of the page is not valid JSON.",
      };
    }
  }
  for (const [id, value] of Object.entries(data)) declared[id] = { snapshot: value, asOf };
  // "*/" can only sit inside a JSON string, where "\/" reads back the same.
  const header = `/* page-sources\n${JSON.stringify(declared).replaceAll("*/", "*\\/")}\n*/`;
  const rest = match ? source.slice(match.index + match[0].length) : `\n${source}`;
  const unused = Object.keys(data).filter(
    (id) => !rest.includes(`useSource("${id}")`) && !rest.includes(`useSource('${id}')`),
  );
  return { ok: true, source: header + rest, unused };
}
