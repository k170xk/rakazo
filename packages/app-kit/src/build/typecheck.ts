import { statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript6";

/**
 * Type-checks an app's files against the OCSC kit's own types, so a wrong prop or a missing export
 * is reported at save time with the real prop names instead of crashing in the preview. Only
 * misuse of the kit and of imports blocks a save; the app's own loose typing is a warning.
 *
 * Uses typescript@6 (installed as `typescript6`) because typescript@7 has no in-process compiler
 * API. Kit and library files are parsed once per process and reused by every later check.
 */

export type TypeProblem = { file: string; line: number; column: number; code: number; message: string };
export type TypecheckResult = { errors: TypeProblem[]; warnings: TypeProblem[]; ms: number };

const require = createRequire(import.meta.url);
const KIT_DIR = path.dirname(require.resolve("@rakazo/app-kit/package.json"));
const SRC = path.join(KIT_DIR, "src");

/** Same targets as the bundler's aliases in build/index.ts. */
const KIT_MODULES: Record<string, string> = {
  "@ocsc/ui": path.join(SRC, "ui/index.ts"),
  "@ocsc/app": path.join(SRC, "sdk/index.tsx"),
  "@ocsc/calc": path.join(SRC, "calc/kit.tsx"),
  "@ocsc/python": path.join(SRC, "python/index.ts"),
  "@ocsc/eng": path.join(SRC, "eng/index.ts"),
  "@ocsc/math": path.join(SRC, "math/index.tsx"),
  "@ocsc/plot": path.join(SRC, "plot/index.ts"),
  "@ocsc/dxf": path.join(SRC, "dxf/index.ts"),
  "@ocsc/sheets": path.join(SRC, "sheets/index.ts"),
  "@ocsc/ifc": path.join(SRC, "ifc/index.tsx"),
};

const PACKAGES = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "motion/react",
  "lucide-react",
  "recharts",
]);

const APP_ROOT = "/__ocsc_app__/";
const SHIMS = `${APP_ROOT}__ocsc_shims__.d.ts`;
const SHIMS_TEXT = [
  'declare module "*.py" { const source: string; export default source; }',
  'declare module "*.css" { const css: string; export default css; }',
  'declare module "*.md" { const text: string; export default text; }',
].join("\n");

const MAX_ERRORS = 12;
const MAX_WARNINGS = 20;
const MAX_MESSAGE = 300;
const TIMEOUT_MS = 15_000;
const CODE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".json"];

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  types: [],
  strict: false,
  noImplicitAny: false,
  strictNullChecks: false,
  skipLibCheck: true,
  allowJs: true,
  checkJs: false,
  resolveJsonModule: true,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  isolatedModules: false,
  noEmit: true,
};

/** Codes for a wrong prop or argument; they block a save only when the target is a kit component or function. */
const USAGE_CODES = new Set([
  2322, 2345, 2353, 2554, 2555, 2559, 2604, 2739, 2740, 2741, 2745, 2746, 2747, 2769, 2786,
]);
/** Codes for an import that does not exist; these always block. */
const IMPORT_CODES = new Set([1192, 2305, 2307, 2613, 2614, 2694, 2724]);

const isAppFile = (fileName: string) => fileName.startsWith(APP_ROOT) && fileName !== SHIMS;
const isKitFile = (fileName: string) => !isAppFile(fileName) && fileName.startsWith(SRC + path.sep);

type Cached = { file: ts.SourceFile; mtime: number };
/** Kit and library files are parsed once per process (re-read when a kit file changes on disk). */
const sourceCache = new Map<string, Cached>();
const appCache = new Map<string, ts.SourceFile>();
const resolutionCache = ts.createModuleResolutionCache(SRC, (name) => name, OPTIONS);
let oldProgram: ts.Program | undefined;
/** Without @types/react every import would look missing, so the check is skipped instead. */
let reactTypes: boolean | undefined;

const mtimeOf = (fileName: string) => {
  try {
    return statSync(fileName).mtimeMs;
  } catch {
    return -1;
  }
};

const scriptKindOf = (fileName: string) => {
  const ext = path.extname(fileName);
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  if (ext === ".js") return ts.ScriptKind.JS;
  if (ext === ".json") return ts.ScriptKind.JSON;
  return ts.ScriptKind.TS;
};

function resolveInApp(files: Record<string, string>, from: string, request: string): string | null {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), request));
  if (base.startsWith("..") || base.startsWith("/")) return null;
  const stripped = base.replace(/\.(js|jsx)$/, "");
  const candidates = [
    base,
    ...CODE_EXTENSIONS.map((ext) => `${stripped}${ext}`),
    ...CODE_EXTENSIONS.map((ext) => `${base}/index${ext}`),
  ];
  return candidates.find((candidate) => Object.hasOwn(files, candidate) && CODE_EXTENSIONS.includes(path.posix.extname(candidate))) ?? null;
}

function extensionOf(fileName: string): ts.Extension {
  if (fileName.endsWith(".d.ts")) return ts.Extension.Dts;
  const ext = path.extname(fileName);
  if (ext === ".tsx") return ts.Extension.Tsx;
  if (ext === ".jsx") return ts.Extension.Jsx;
  if (ext === ".js") return ts.Extension.Js;
  if (ext === ".json") return ts.Extension.Json;
  return ts.Extension.Ts;
}

function createHost(files: Record<string, string>): ts.CompilerHost {
  const base = ts.createCompilerHost(OPTIONS, true);
  const appText = (fileName: string) =>
    fileName === SHIMS ? SHIMS_TEXT : isAppFile(fileName) ? files[fileName.slice(APP_ROOT.length)] : undefined;

  const resolveOne = (name: string, containing: string): ts.ResolvedModuleFull | undefined => {
    if (KIT_MODULES[name]) return { resolvedFileName: KIT_MODULES[name], extension: extensionOf(KIT_MODULES[name]) };
    if (isAppFile(containing)) {
      const from = containing.slice(APP_ROOT.length);
      if (name.startsWith(".")) {
        const found = resolveInApp(files, from, name);
        // Unresolved .py/.css/.md fall through to the shims' wildcard modules.
        return found ? { resolvedFileName: APP_ROOT + found, extension: extensionOf(found) } : undefined;
      }
      const target = name === "framer-motion" ? "motion/react" : name;
      if (!PACKAGES.has(target)) return undefined;
      return ts.resolveModuleName(target, path.join(SRC, "index.ts"), OPTIONS, base, resolutionCache).resolvedModule;
    }
    return ts.resolveModuleName(name, containing, OPTIONS, base, resolutionCache).resolvedModule;
  };

  return {
    ...base,
    getCurrentDirectory: () => SRC,
    fileExists: (fileName) => (appText(fileName) !== undefined ? true : isAppFile(fileName) ? false : base.fileExists(fileName)),
    readFile: (fileName) => appText(fileName) ?? (isAppFile(fileName) ? undefined : base.readFile(fileName)),
    getSourceFile: (fileName, languageVersion) => {
      const text = appText(fileName);
      if (text !== undefined) {
        const key = `${fileName}\0${text}`;
        let file = appCache.get(key);
        if (!file) {
          file = ts.createSourceFile(fileName, text, languageVersion, true, scriptKindOf(fileName));
          appCache.set(key, file);
        }
        return file;
      }
      if (isAppFile(fileName)) return undefined;
      const mtime = mtimeOf(fileName);
      const cached = sourceCache.get(fileName);
      if (cached && cached.mtime === mtime) return cached.file;
      const source = base.readFile(fileName);
      if (source === undefined) return undefined;
      const file = ts.createSourceFile(fileName, source, languageVersion, true, scriptKindOf(fileName));
      sourceCache.set(fileName, { file, mtime });
      return file;
    },
    resolveModuleNameLiterals: (literals, containing) =>
      literals.map((literal) => ({ resolvedModule: resolveOne(literal.text, containing) })),
  };
}

/** The innermost node covering a position. */
function nodeAt(file: ts.SourceFile, position: number): ts.Node {
  let found: ts.Node = file;
  const visit = (node: ts.Node) => {
    if (position >= node.getStart(file) && position < node.getEnd()) {
      found = node;
      ts.forEachChild(node, visit);
    }
  };
  ts.forEachChild(file, visit);
  return found;
}

type Site =
  | { kind: "jsx"; element: ts.JsxOpeningLikeElement; attribute?: ts.JsxAttribute }
  | { kind: "call"; call: ts.CallExpression | ts.NewExpression }
  | { kind: "declaration"; declaration: ts.VariableDeclaration };

/**
 * The nearest place that gives the failing code its expected type: a JSX element (its tag or
 * attributes), a call's arguments, or a variable with a type annotation. Function bodies are a
 * boundary, so code inside a handler is judged on its own.
 */
function usageSite(node: ts.Node): Site | undefined {
  let child: ts.Node = node;
  let attribute: ts.JsxAttribute | undefined;
  for (let current = node.parent; current; child = current, current = current.parent) {
    if (ts.isJsxAttribute(current)) attribute = current;
    if (ts.isJsxOpeningElement(current) || ts.isJsxSelfClosingElement(current)) {
      return { kind: "jsx", element: current, attribute };
    }
    if (ts.isJsxElement(current) && child === current.openingElement) continue;
    if ((ts.isCallExpression(current) || ts.isNewExpression(current)) && child !== current.expression) {
      return { kind: "call", call: current };
    }
    if (ts.isVariableDeclaration(current) && current.type && child === current.initializer) {
      return { kind: "declaration", declaration: current };
    }
    if (ts.isFunctionLike(current) && ts.isBlock(child)) return undefined;
    if (ts.isSourceFile(current)) return undefined;
  }
  return undefined;
}

function declaredInKit(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): boolean {
  if (!symbol) return false;
  const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  return (target.declarations ?? []).some((declaration) => isKitFile(declaration.getSourceFile().fileName));
}

function siteTarget(checker: ts.TypeChecker, site: Site): ts.Symbol | undefined {
  if (site.kind === "jsx") return checker.getSymbolAtLocation(site.element.tagName);
  if (site.kind === "call") return checker.getSymbolAtLocation(site.call.expression);
  const type = site.declaration.type;
  if (type && ts.isTypeReferenceNode(type)) return checker.getSymbolAtLocation(type.typeName);
  if (type && ts.isArrayTypeNode(type) && ts.isTypeReferenceNode(type.elementType)) {
    return checker.getSymbolAtLocation(type.elementType.typeName);
  }
  return undefined;
}

/**
 * Whether a diagnostic blocks a save: imports that do not resolve, and wrong props or arguments
 * given to a kit component or function. A mismatch on a callback prop (onChange={setTab}) only
 * warns: the kit's generic handler types are stricter than what works at run time. Everything
 * else is the app's own typing and only warns.
 */
export function isBlocking(code: number, target: { kit: boolean; callback?: boolean }): boolean {
  if (IMPORT_CODES.has(code)) return true;
  return USAGE_CODES.has(code) && target.kit && !target.callback;
}

/** Whether the failing attribute expects a function (an event handler or render callback). */
function isCallbackProp(checker: ts.TypeChecker, site: Site | undefined): boolean {
  if (site?.kind !== "jsx" || !site.attribute?.initializer) return false;
  const value = ts.isJsxExpression(site.attribute.initializer) ? site.attribute.initializer.expression : undefined;
  const expected = value ? checker.getContextualType(value) : undefined;
  if (!expected) return false;
  const parts = expected.isUnion() ? expected.types : [expected];
  return parts.some((part) => part.getCallSignatures().length > 0);
}

function tagText(element: ts.JsxOpeningLikeElement) {
  return element.tagName.getText();
}

/** A component's own prop names and the required ones, from the type of its first parameter. */
function propNames(checker: ts.TypeChecker, element: ts.JsxOpeningLikeElement): { names: string[]; required: string[] } {
  const type = checker.getTypeAtLocation(element.tagName);
  const names = new Set<string>();
  const required = new Set<string>();
  for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
    const param = signature.getParameters()[0];
    if (!param) continue;
    const props = checker.getTypeOfSymbol(param);
    const parts = props.isUnion() ? props.types : [props];
    for (const part of parts) {
      for (const prop of checker.getPropertiesOfType(part)) {
        names.add(prop.getName());
        if (!(prop.flags & ts.SymbolFlags.Optional)) required.add(prop.getName());
      }
    }
  }
  for (const skip of ["key", "ref"]) {
    names.delete(skip);
    required.delete(skip);
  }
  return { names: [...names], required: [...required] };
}

const sentence = (text: string) => text.replace(/\.$/, "");
const clip = (text: string, max = MAX_MESSAGE) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The first and last lines of a message chain: what failed and the concrete reason. */
function chainText(messageText: string | ts.DiagnosticMessageChain): string {
  if (typeof messageText === "string") return messageText;
  const lines: string[] = [];
  const walk = (chain: ts.DiagnosticMessageChain) => {
    lines.push(chain.messageText);
    for (const next of chain.next ?? []) walk(next);
  };
  walk(messageText);
  const first = lines[0]!;
  const last = lines[lines.length - 1]!;
  const mean = lines.find((line) => /Did you mean/.test(line) && line !== first && line !== last);
  return [first, mean, last !== first ? last : undefined].filter(Boolean).join(" ");
}

function allLines(messageText: string | ts.DiagnosticMessageChain): string[] {
  if (typeof messageText === "string") return [messageText];
  return [messageText.messageText, ...(messageText.next ?? []).flatMap(allLines)];
}

const SCALAR =
  ts.TypeFlags.StringLike |
  ts.TypeFlags.NumberLike |
  ts.TypeFlags.BooleanLike |
  ts.TypeFlags.BigIntLike |
  ts.TypeFlags.ESSymbolLike |
  ts.TypeFlags.Null |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Void |
  ts.TypeFlags.Any |
  ts.TypeFlags.Unknown;

/** Field names of an object type (with the required ones), for "its fields are …" hints. */
function fieldsOf(checker: ts.TypeChecker, type: ts.Type | undefined): string | undefined {
  if (!type) return undefined;
  const element = checker.isArrayType(type) ? checker.getTypeArguments(type as ts.TypeReference)[0] : type;
  if (!element || element.flags & (SCALAR)) return undefined;
  if (element.getCallSignatures().length) return undefined;
  const props = checker.getPropertiesOfType(element);
  if (!props.length || props.length > 30) return undefined;
  const required = props.filter((prop) => !(prop.flags & ts.SymbolFlags.Optional)).map((prop) => prop.getName());
  const name = checker.typeToString(element);
  const label = /^[A-Za-z_]\w*$/.test(name) ? `${name} has` : "it has";
  return `${label} fields ${props.map((prop) => prop.getName()).join(", ")}${required.length && required.length < props.length ? ` (required: ${required.join(", ")})` : ""}`;
}

function describe(diagnostic: ts.Diagnostic, node: ts.Node, site: Site | undefined, checker: ts.TypeChecker): string {
  const lines = allLines(diagnostic.messageText);
  const text = lines.join(" ");
  if (site?.kind === "call") {
    const literal = diagnostic.code === 2353 && ts.isObjectLiteralExpression(node.parent?.parent) ? node.parent.parent : undefined;
    const fields = literal ? fieldsOf(checker, checker.getContextualType(literal)) : undefined;
    return `${site.call.expression.getText()}(): ${sentence(chainText(diagnostic.messageText))}${fields ? `; ${fields}` : ""}`;
  }
  if (site?.kind !== "jsx") return chainText(diagnostic.messageText);
  const tag = tagText(site.element);
  const { names: known, required } = propNames(checker, site.element);
  const props = () =>
    known.length
      ? `; its props are ${known.slice(0, 24).join(", ")}${required.length ? ` (required: ${required.join(", ")})` : ""}`
      : "";
  const meant = /Did you mean '([^']+)'\?/.exec(text)?.[1];
  const unknown =
    /Property '([^']+)' does not exist on type/.exec(text) ??
    /'([^']+)' does not exist in type/.exec(text);
  if (unknown && site.attribute?.name.getText() === unknown[1]) {
    const given = site.element.attributes.properties.filter(ts.isJsxAttribute).map((attr) => attr.name.getText());
    const extra = known.length ? given.filter((name) => !known.includes(name)) : [unknown[1]!];
    const list = (extra.length ? extra : [unknown[1]!]).map((name) => `"${name}"`).join(", ");
    const mean = meant && known.includes(meant) ? ` (did you mean "${meant}"?)` : "";
    return `<${tag}> has no ${extra.length > 1 ? "props" : "prop"} ${list}${mean}${props()}`;
  }
  if (diagnostic.code === 2353 && site.attribute) {
    const literal = ts.isObjectLiteralExpression(node.parent?.parent) ? node.parent.parent : undefined;
    const fields = literal ? fieldsOf(checker, checker.getContextualType(literal)) : undefined;
    const field = /'([^']+)' does not exist in type/.exec(text)?.[1] ?? node.getText();
    return `<${tag}> prop "${site.attribute.name.getText()}": unknown field "${field}"${fields ? `; ${fields}` : ""}`;
  }
  if (diagnostic.code === 2559 || (diagnostic.code === 2322 && /has no properties in common/.test(text))) {
    const given = site.element.attributes.properties.filter(ts.isJsxAttribute).map((a) => a.name.getText());
    const children = ts.isJsxOpeningElement(site.element) ? ["children"] : [];
    const list = [...given, ...children].map((name) => `"${name}"`).join(", ");
    return `<${tag}> takes none of the props given (${list})${props()}`;
  }
  const missing = [...text.matchAll(/Property '([^']+)' is missing in type/g)].map((match) => match[1]!);
  const missingList = /missing the following properties from type '[^']*': ([^.]+)/.exec(text)?.[1];
  if (missing.length || missingList) {
    const names = missing.length ? missing.map((name) => `"${name}"`).join(", ") : missingList!;
    const deeper = site.attribute ? ` in prop "${site.attribute.name.getText()}"` : "";
    return `<${tag}> is missing required ${deeper ? "field" : "prop"} ${names}${deeper}${props()}`;
  }
  if (site.attribute) {
    const expected = ts.isExpression(node) ? checker.getContextualType(node) : undefined;
    const fields = expected && node !== site.attribute.name ? fieldsOf(checker, expected) : undefined;
    return `<${tag}> prop "${site.attribute.name.getText()}": ${sentence(chainText(diagnostic.messageText))}${fields ? `; ${fields}` : ""}`;
  }
  return `<${tag}>: ${chainText(diagnostic.messageText)}`;
}

function toProblem(diagnostic: ts.Diagnostic, checker: ts.TypeChecker): { problem: TypeProblem; blocking: boolean } {
  const file = diagnostic.file!;
  const start = diagnostic.start ?? 0;
  const { line, character } = file.getLineAndCharacterOfPosition(start);
  const node = nodeAt(file, start);
  const site = usageSite(node);
  const blocking = isBlocking(diagnostic.code, {
    kit: !!site && declaredInKit(checker, siteTarget(checker, site)),
    callback: isCallbackProp(checker, site),
  });
  const name = file.fileName.slice(APP_ROOT.length);
  const where = `${name}:${line + 1}:${character + 1}`;
  const message = blocking && site ? describe(diagnostic, node, site, checker) : chainText(diagnostic.messageText);
  return {
    problem: { file: name, line: line + 1, column: character + 1, code: diagnostic.code, message: clip(`${where} ${message}`) },
    blocking,
  };
}

const problemKey = (problem: TypeProblem) =>
  `${problem.file}|${problem.code}|${problem.message.replace(/^\S+:\d+:\d+\s*/, "")}`;

/**
 * The errors a save adds: those the app's previous files did not already have, matched without
 * line numbers so moving code does not count as new. Earlier problems stay non-blocking.
 */
export function newTypeErrors(
  before: TypeProblem[],
  after: TypeProblem[],
): { added: TypeProblem[]; existing: TypeProblem[] } {
  const known = new Map<string, number>();
  for (const problem of before) known.set(problemKey(problem), (known.get(problemKey(problem)) ?? 0) + 1);
  const added: TypeProblem[] = [];
  const existing: TypeProblem[] = [];
  for (const problem of after) {
    const left = known.get(problemKey(problem)) ?? 0;
    if (left > 0) {
      known.set(problemKey(problem), left - 1);
      existing.push(problem);
    } else added.push(problem);
  }
  return { added, existing };
}

const skipped = (message: string, ms: number): TypecheckResult => ({
  errors: [],
  warnings: [{ file: "", line: 0, column: 0, code: 0, message }],
  ms,
});

class Timeout extends Error {}

/** Checks app files against the kit's types. Never throws; on trouble it returns a warning and no errors. */
export async function typecheckApp(
  files: Record<string, string>,
  options: { timeoutMs?: number; maxErrors?: number } = {},
): Promise<TypecheckResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    const names = Object.keys(files).filter((name) => /\.(tsx|ts|jsx|js|json)$/.test(name));
    const roots = [SHIMS, ...names.filter((name) => /\.(tsx|ts)$/.test(name)).map((name) => APP_ROOT + name)];
    const host = createHost(files);
    reactTypes ??= !!ts.resolveModuleName("react", path.join(SRC, "index.ts"), OPTIONS, host, resolutionCache).resolvedModule
      ?.resolvedFileName.endsWith(".d.ts");
    if (!reactTypes) return skipped("type check skipped (React types are not installed)", elapsed());
    const program = ts.createProgram({ rootNames: roots, options: OPTIONS, host, oldProgram });
    oldProgram = program;
    if (appCache.size > 400) appCache.clear();
    const checker = program.getTypeChecker();
    const deadline = started + (options.timeoutMs ?? TIMEOUT_MS);
    const token: ts.CancellationToken = {
      isCancellationRequested: () => performance.now() > deadline,
      throwIfCancellationRequested: () => {
        if (performance.now() > deadline) throw new Timeout();
      },
    };
    const errors: TypeProblem[] = [];
    const warnings: TypeProblem[] = [];
    for (const file of program.getSourceFiles()) {
      if (!isAppFile(file.fileName) || !/\.(tsx|ts)$/.test(file.fileName)) continue;
      const diagnostics = [...program.getSyntacticDiagnostics(file, token), ...program.getSemanticDiagnostics(file, token)];
      for (const diagnostic of diagnostics) {
        if (!diagnostic.file || diagnostic.category !== ts.DiagnosticCategory.Error) continue;
        const { problem, blocking } = toProblem(diagnostic, checker);
        (blocking ? errors : warnings).push(problem);
      }
      token.throwIfCancellationRequested();
    }
    return { errors: errors.slice(0, options.maxErrors ?? MAX_ERRORS), warnings: warnings.slice(0, MAX_WARNINGS), ms: elapsed() };
  } catch (error) {
    if (error instanceof Timeout || error instanceof ts.OperationCanceledException) {
      oldProgram = undefined;
      return skipped("type check skipped (slow)", elapsed());
    }
    oldProgram = undefined;
    return skipped(`type check skipped (${error instanceof Error ? error.message : String(error)})`.slice(0, MAX_MESSAGE), elapsed());
  }
}
