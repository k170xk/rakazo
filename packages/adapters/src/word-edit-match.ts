import path from "node:path";
import { inflateRawSync } from "node:zlib";
import type { AdapterContext } from "@rakazo/adapter-kit";
import type { ToolRunnerWorkspace, WorkspaceFiles } from "./tool-runner.js";
import { TOOL_RUNNER_COMPUTER } from "./tool-runner.js";

/**
 * People's Word documents use typographic apostrophes, quotes and dashes and Word's own clause
 * numbering, while the bot quotes them with plain characters and the visible numbers, so `ocsc
 * word edit` finds nothing. Before an edit runs, each quoted phrase that is not in the document as
 * written is matched to the document's own characters, and the edit runs with those. A phrase is
 * changed only when it means one wording in the document; anything else is left for the editor to
 * report.
 */

const MAX_DOCX_BYTES = 60 * 1024 ** 2;
const MAX_XML_BYTES = 80 * 1024 ** 2;
const MAX_SPEC_BYTES = 2 * 1024 ** 2;

// Mirrors ocsc-word: paragraphs (including those in tables) and the text it reads from each.
const PARA_RE = /<w:p(?=[\s>])[^>]*(?<!\/)>[\s\S]*?<\/w:p>/g;
const TEXT_RE = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g;

function unesc(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Each paragraph's text as ocsc-word reads it: inserted text kept, deleted text left out. */
export function paragraphTexts(documentXml: string): string[] {
  return [...documentXml.matchAll(PARA_RE)].map((p) =>
    [...p[0].matchAll(TEXT_RE)]
      .map((m) => (m[1] !== undefined ? unesc(m[1]) : m[0] === "<w:tab/>" ? "\t" : "\n"))
      .join(""),
  );
}

const QUOTE_1 = /[\u2018\u2019\u201a\u201b\u2032\u0060\u00b4]/;
const QUOTE_2 = /[\u201c\u201d\u201e\u201f\u2033\u00ab\u00bb]/;
const DASH = /[\u2010-\u2015\u2212]/;
const INVISIBLE = /[\u200b-\u200d\u2060\ufeff\u00ad]/;

/** Text with quotes, dashes and spacing made plain, and where each plain character came from. */
function plain(text: string): { text: string; from: number[] } {
  let out = "";
  const from: number[] = [];
  let spaced = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (INVISIBLE.test(ch)) continue;
    if (/\s/.test(ch)) {
      if (!spaced && out) {
        out += " ";
        from.push(i);
      }
      spaced = true;
      continue;
    }
    spaced = false;
    out += QUOTE_1.test(ch) ? "'" : QUOTE_2.test(ch) ? '"' : DASH.test(ch) ? "-" : ch;
    from.push(i);
  }
  if (out.endsWith(" ")) {
    out = out.slice(0, -1);
    from.pop();
  }
  return { text: out, from };
}

/** A clause or list number the bot copied from the screen; Word draws those, they are not text. */
const CLAUSE_NUMBER =
  /^\s*(?:(?:clause|section|article)\s+)?(?:\d+(?:\.\d+)*\.?|\(?[a-z]\)|\([ivxlc]+\)|[ivxlc]+\.)\s+/i;

/**
 * The document's own wording for a quoted phrase, or null when it is not there or means more
 * than one wording.
 */
export function documentWording(phrase: string, paragraphs: readonly string[]): string | null {
  const wanted = [phrase, phrase.replace(CLAUSE_NUMBER, "")]
    .map((variant) => plain(variant).text)
    .filter((variant, i, all) => variant.length >= 3 && all.indexOf(variant) === i);
  const plains = paragraphs.map((p) => ({ source: p, ...plain(p) }));
  for (const caseless of [false, true]) {
    for (const needle of wanted) {
      const target = caseless ? needle.toLowerCase() : needle;
      const found = new Set<string>();
      for (const p of plains) {
        const hay = caseless ? p.text.toLowerCase() : p.text;
        for (let at = hay.indexOf(target); at >= 0; at = hay.indexOf(target, at + 1)) {
          const start = p.from[at]!;
          const end = p.from[at + target.length - 1]! + 1;
          found.add(p.source.slice(start, end));
        }
      }
      if (found.size === 1) return [...found][0]!;
      if (found.size > 1) return null;
    }
  }
  return null;
}

const loose = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** The phrases an edit quotes, and how ocsc-word looks each one up. */
const QUOTED: Record<string, ReadonlyArray<readonly [field: string, exact: boolean]>> = {
  replace_text: [["find", true]],
  add_comment: [["find", true]],
  format_text: [["find", false]],
  replace_paragraphs: [
    ["from", false],
    ["to", false],
  ],
  replace_section: [["heading", false]],
  delete_section: [["heading", false]],
  add_to_section: [["heading", false]],
  insert_after_heading: [["heading", false]],
};

export type MatchedPhrase = { op: string; field: string; quoted: string; wording: string };

/** The edit spec with quoted phrases set to the document's wording, and what changed. */
export function matchEditPhrases(
  spec: unknown,
  paragraphs: readonly string[],
): { spec: unknown; matched: MatchedPhrase[] } {
  const list = Array.isArray(spec)
    ? spec
    : spec && typeof spec === "object" && Array.isArray((spec as { edits?: unknown }).edits)
      ? (spec as { edits: unknown[] }).edits
      : null;
  if (!list) return { spec, matched: [] };
  const matched: MatchedPhrase[] = [];
  const joined = paragraphs.map(loose);
  const edits = list.map((edit) => {
    if (!edit || typeof edit !== "object") return edit;
    const op = String((edit as { op?: unknown }).op ?? "");
    const fields = QUOTED[op];
    if (!fields) return edit;
    let next = edit as Record<string, unknown>;
    for (const [field, exact] of fields) {
      const quoted = next[field];
      if (typeof quoted !== "string" || !quoted.trim()) continue;
      const present = exact
        ? paragraphs.some((p) => p.includes(quoted))
        : joined.some((p) => p.includes(loose(quoted)));
      if (present) continue;
      const wording = documentWording(quoted, paragraphs);
      if (!wording || wording === quoted) continue;
      next = { ...next, [field]: wording };
      matched.push({ op, field, quoted, wording });
    }
    return next;
  });
  return {
    spec: Array.isArray(spec) ? edits : { ...(spec as object), edits },
    matched,
  };
}

/** One file from a zip, or null when it is missing, too large or stored in a way this cannot read. */
export function zipEntry(zip: Uint8Array, name: string, maxBytes: number): Uint8Array | null {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const wanted = new TextEncoder().encode(name);
  for (let n = 0; n < count && at + 46 <= zip.length; n += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) return null;
    const method = view.getUint16(at + 10, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const skip = nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const entryName = zip.subarray(at + 46, at + 46 + nameLength);
    at += 46 + skip;
    if (entryName.length !== wanted.length || entryName.some((b, i) => b !== wanted[i])) continue;
    if (size > maxBytes || packed === 0xffffffff || local + 30 > zip.length) return null;
    if (view.getUint32(local, true) !== 0x04034b50) return null;
    const dataAt = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = zip.subarray(dataAt, dataAt + packed);
    if (method === 0) return data;
    if (method !== 8) return null;
    return new Uint8Array(inflateRawSync(data, { maxOutputLength: maxBytes }));
  }
  return null;
}

function flagValue(args: readonly string[], flag: string): { index: number; value: string } | null {
  for (const [index, arg] of args.entries()) {
    if (arg === flag && args[index + 1] !== undefined) return { index, value: args[index + 1]! };
    if (arg.startsWith(`${flag}=`)) return { index, value: arg.slice(flag.length + 1) };
  }
  return null;
}

/** Where a command's path argument is for the folder's file tools, or null outside the folder. */
function storedPath(workspace: ToolRunnerWorkspace, value: string): string | null {
  const folder = path.resolve(workspace.root, workspace.cwd);
  const full = path.resolve(folder, value);
  if (!full.startsWith(`${folder}${path.sep}`)) return null;
  const stored = path.relative(path.resolve(workspace.base), full);
  if (!stored || stored.startsWith("..") || path.isAbsolute(stored)) return null;
  return stored.split(path.sep).join("/");
}

/**
 * For `ocsc word edit` on the document runner: the arguments to run, pointing at a spec whose
 * quoted phrases use the document's wording, and the phrases that changed. Null leaves the command
 * as the bot wrote it.
 */
export async function matchWordEditOnRunner(
  files: WorkspaceFiles,
  workspace: ToolRunnerWorkspace,
  args: readonly string[],
  context: AdapterContext,
): Promise<{ args: string[]; matched: MatchedPhrase[] } | null> {
  if (args[0] !== "edit") return null;
  const input = flagValue(args, "--in");
  const specFlag = flagValue(args, "--spec");
  if (!input || !specFlag) return null;
  const docPath = storedPath(workspace, input.value);
  const specPath = storedPath(workspace, specFlag.value);
  if (!docPath || !specPath?.toLowerCase().endsWith(".json")) return null;
  let spec: unknown;
  try {
    const raw = await files.readFile(TOOL_RUNNER_COMPUTER, specPath, context, {
      maxBytes: MAX_SPEC_BYTES,
    });
    spec = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  const docx = await files.readFile(TOOL_RUNNER_COMPUTER, docPath, context, {
    maxBytes: MAX_DOCX_BYTES,
  });
  const xml = zipEntry(docx, "word/document.xml", MAX_XML_BYTES);
  if (!xml) return null;
  const result = matchEditPhrases(spec, paragraphTexts(new TextDecoder().decode(xml)));
  if (!result.matched.length) return null;
  const matchedSpec = specFlag.value.replace(/(\.matched)?\.json$/i, ".matched.json");
  const matchedPath = storedPath(workspace, matchedSpec);
  if (!matchedPath) return null;
  await files.writeFile(
    TOOL_RUNNER_COMPUTER,
    { path: matchedPath, content: new TextEncoder().encode(JSON.stringify(result.spec, null, 1)) },
    context,
  );
  const next = [...args];
  if (next[specFlag.index] === "--spec") next[specFlag.index + 1] = matchedSpec;
  else next[specFlag.index] = `--spec=${matchedSpec}`;
  return { args: next, matched: result.matched };
}
