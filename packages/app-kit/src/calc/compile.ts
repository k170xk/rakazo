import * as XLSX from "xlsx";
import { Engine } from "./engine.js";
import { BUILTIN_FORMATS } from "./format.js";
import type {
  CalcModel,
  CellSpec,
  CellStyle,
  CellValueJson,
  InputSpec,
  NameSpec,
  SheetSpec,
  TableSpec,
} from "./model.js";
import { parseFormula } from "./parse.js";
import type { ErrorCode } from "./values.js";
import { ERRORS, serialFromDate } from "./values.js";
import type { XmlNode } from "./xml.js";
import { child, childrenNamed, decodeExcelEscapes, descendants, parseXml, textOf } from "./xml.js";

/**
 * Compiles an Excel workbook file into a CalcModel: every cell value Excel saved, every formula
 * (shared and array formulas included), number formats, the styles an app needs to draw the
 * sheet, names, tables, cached external-workbook values, and the cells a person types into. The
 * workbook's own XML is read directly so nothing is lost to a library's simplifications; files
 * that are not Office Open XML (.xls, .ods, .csv) go through SheetJS's cell data instead.
 */

export type CompileResult = { model: CalcModel; warnings: string[] };

export async function compileWorkbook(bytes: Uint8Array, fileName: string): Promise<CompileResult> {
  const sha256 = await digest(bytes);
  const zip = isZip(bytes) ? XLSX.CFB.read(bytes, { type: "array" }) : null;
  const workbookXml = zip ? readText(zip, "xl/workbook.xml") : null;
  if (!zip || workbookXml === null) return compileWithSheetJs(bytes, fileName, sha256);
  return new OoxmlCompiler(zip, fileName, sha256).compile(workbookXml);
}

// -----------------------------------------------------------------------------------------------
// Zip parts

type Zip = ReturnType<typeof XLSX.CFB.read>;

const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b;
/** The container legacy .xls files use. */
const isCompoundFile = (bytes: Uint8Array) =>
  bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;

function readBytes(zip: Zip, path: string): Uint8Array | null {
  const entry = XLSX.CFB.find(zip, `/${path.replace(/^\/+/, "")}`);
  const content = entry?.content as Uint8Array | number[] | undefined;
  if (!content) return null;
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

function readText(zip: Zip, path: string): string | null {
  const content = readBytes(zip, path);
  return content ? new TextDecoder("utf-8").decode(content) : null;
}

function readXml(zip: Zip, path: string): XmlNode | null {
  const text = readText(zip, path);
  return text === null ? null : parseXml(text);
}

function partsIn(zip: Zip, prefix: string): string[] {
  return zip.FullPaths.map((p: string) => p.replace(/^Root Entry\//, "")).filter(
    (p: string) => p.startsWith(prefix) && !p.endsWith("/"),
  );
}

/** Relationship targets of a part, by id, as zip paths. */
function relationships(zip: Zip, part: string): Map<string, { target: string; type: string }> {
  const slash = part.lastIndexOf("/");
  const dir = part.slice(0, slash);
  const rels = readXml(zip, `${dir}/_rels/${part.slice(slash + 1)}.rels`);
  const out = new Map<string, { target: string; type: string }>();
  if (!rels) return out;
  for (const rel of descendants(rels, "Relationship")) {
    if (rel.attrs.TargetMode === "External") {
      out.set(rel.attrs.Id!, { target: rel.attrs.Target ?? "", type: rel.attrs.Type ?? "" });
      continue;
    }
    out.set(rel.attrs.Id!, {
      target: resolvePath(dir, rel.attrs.Target ?? ""),
      type: rel.attrs.Type ?? "",
    });
  }
  return out;
}

function resolvePath(dir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = dir ? dir.split("/") : [];
  for (const piece of target.split("/")) {
    if (piece === "..") parts.pop();
    else if (piece !== ".") parts.push(piece);
  }
  return parts.join("/");
}

// -----------------------------------------------------------------------------------------------
// Addresses

function decodeCell(ref: string): { row: number; col: number } | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(ref);
  if (!m) return null;
  const col =
    m[1]!
      .toUpperCase()
      .split("")
      .reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return { row: Number(m[2]) - 1, col };
}

function decodeRange(ref: string): { r1: number; c1: number; r2: number; c2: number } | null {
  const [a, b] = ref.split(":");
  const start = decodeCell(a ?? "");
  const end = b ? decodeCell(b) : start;
  if (!start || !end) return null;
  return {
    r1: Math.min(start.row, end.row),
    c1: Math.min(start.col, end.col),
    r2: Math.max(start.row, end.row),
    c2: Math.max(start.col, end.col),
  };
}

// -----------------------------------------------------------------------------------------------
// Colours

const INDEXED = [
  "000000",
  "FFFFFF",
  "FF0000",
  "00FF00",
  "0000FF",
  "FFFF00",
  "FF00FF",
  "00FFFF",
  "000000",
  "FFFFFF",
  "FF0000",
  "00FF00",
  "0000FF",
  "FFFF00",
  "FF00FF",
  "00FFFF",
  "800000",
  "008000",
  "000080",
  "808000",
  "800080",
  "008080",
  "C0C0C0",
  "808080",
  "9999FF",
  "993366",
  "FFFFCC",
  "CCFFFF",
  "660066",
  "FF8080",
  "0066CC",
  "CCCCFF",
  "000080",
  "FF00FF",
  "FFFF00",
  "00FFFF",
  "800080",
  "800000",
  "008080",
  "0000FF",
  "00CCFF",
  "CCFFFF",
  "CCFFCC",
  "FFFF99",
  "99CCFF",
  "FF99CC",
  "CC99FF",
  "FFCC99",
  "3366FF",
  "33CCCC",
  "99CC00",
  "FFCC00",
  "FF9900",
  "FF6600",
  "666699",
  "969696",
  "003366",
  "339966",
  "003300",
  "333300",
  "993300",
  "993366",
  "333399",
  "333333",
];

function applyTint(hex: string, tint: number): string {
  if (!tint) return hex;
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue = (p: number, q: number, t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  let rr = l;
  let gg = l;
  let bb = l;
  if (s) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    rr = hue(p, q, h + 1 / 3);
    gg = hue(p, q, h);
    bb = hue(p, q, h - 1 / 3);
  }
  const out = (x: number) =>
    Math.round(Math.min(1, Math.max(0, x)) * 255)
      .toString(16)
      .padStart(2, "0");
  return (out(rr) + out(gg) + out(bb)).toUpperCase();
}

// -----------------------------------------------------------------------------------------------

const EMPTY_STYLE = "{}";

class OoxmlCompiler {
  private readonly warnings: string[] = [];
  private readonly unsupported = new Set<string>();
  private sharedStrings: string[] = [];
  private richErrors: Array<ErrorCode | undefined> = [];
  private theme: string[] = [];
  private xfs: Array<{ format: number; style: CellStyle }> = [];
  private readonly formats: string[] = [];
  private readonly formatIndex = new Map<string, number>();
  private readonly styles: CellStyle[] = [];
  private readonly styleIndex = new Map<string, number>();
  private readonly formulas: CalcModel["formulas"] = [];
  private readonly formulaIndex = new Map<string, number>();
  private sheetNames: string[] = [];

  constructor(
    private readonly zip: Zip,
    private readonly fileName: string,
    private readonly sha256: string,
  ) {}

  compile(workbookXml: string): CompileResult {
    const workbook = parseXml(workbookXml);
    const wb = child(workbook, "workbook")!;
    const rels = relationships(this.zip, "xl/workbook.xml");
    this.readTheme(rels);
    this.readSharedStrings(rels);
    this.readRichErrors(rels);
    this.readStyles(rels);

    const sheetNodes = childrenNamed(child(wb, "sheets"), "sheet");
    this.sheetNames = sheetNodes.map((s) => s.attrs.name ?? "Sheet");
    const date1904 = ["1", "true"].includes(child(wb, "workbookPr")?.attrs.date1904 ?? "");
    const calcPr = child(wb, "calcPr");
    const iterate = ["1", "true"].includes(calcPr?.attrs.iterate ?? "")
      ? {
          count: Number(calcPr?.attrs.iterateCount ?? 100),
          delta: Number(calcPr?.attrs.iterateDelta ?? 0.001),
        }
      : undefined;
    if (["0", "false"].includes(calcPr?.attrs.fullPrecision ?? ""))
      this.unsupported.add(
        "Precision as displayed is switched on; results here keep full precision.",
      );
    if (date1904) this.unsupported.add("The workbook uses the 1904 date system.");

    const tables: TableSpec[] = [];
    const validations: Validation[] = [];
    const sheets: SheetSpec[] = [];
    sheetNodes.forEach((node, index) => {
      const rel = rels.get(node.attrs["r:id"] ?? "");
      const hidden = node.attrs.state === "hidden" || node.attrs.state === "veryHidden";
      const xml = rel ? readXml(this.zip, rel.target) : null;
      if (!rel || !xml || !child(xml, "worksheet")) {
        sheets.push({
          name: this.sheetNames[index]!,
          rows: 0,
          cols: 0,
          cells: [],
          ...(hidden ? { hidden } : {}),
        });
        if (rel?.type.endsWith("/chartsheet"))
          this.unsupported.add(`"${this.sheetNames[index]}" is a chart sheet.`);
        return;
      }
      sheets.push(this.readSheet(index, rel.target, xml, hidden, tables, validations));
    });

    const externals = this.readExternals(rels, sheets);
    const app = readXml(this.zip, "docProps/app.xml");
    const application = app ? textOf(descendants(app, "Application")[0]).trim() : "";
    const appVersion = app ? textOf(descendants(app, "AppVersion")[0]).trim() : "";
    const names = this.readNames(wb);
    if (readBytes(this.zip, "xl/vbaProject.bin"))
      this.unsupported.add(
        "The workbook has VBA macros; they do not run here (worksheet formulas do).",
      );
    if (partsIn(this.zip, "xl/pivotTables/").length)
      this.unsupported.add("Pivot tables keep the values Excel saved.");
    if (partsIn(this.zip, "xl/connections.xml").length)
      this.unsupported.add("Data connections are not refreshed.");

    const bookPath = this.savedBookPath(sheets);
    const model: CalcModel = {
      version: 1,
      source: {
        fileName: this.fileName,
        sha256: this.sha256,
        ...(application ? { application } : {}),
        ...(appVersion ? { appVersion } : {}),
        ...(bookPath ? { bookPath } : {}),
        excelCalculated:
          /excel/i.test(application) &&
          !/compatible/i.test(application) &&
          readBytes(this.zip, "xl/calcChain.xml") !== null,
      },
      date1904,
      ...(iterate ? { iterate } : { iterationOff: true }),
      sheets,
      formulas: this.formulas,
      formats: this.formats,
      styles: this.styles,
      names,
      tables,
      externals,
      inputs: [],
      unsupported: [],
    };
    const engine = new Engine(model);
    for (const name of [...engine.missingFunctions].sort())
      this.unsupported.add(
        name === "(unreadable formula)"
          ? "Some formulas could not be read."
          : `${name} is not an Excel function this engine calculates (it may be a VBA function).`,
      );
    model.inputs = detectInputs(model, engine, validations, this.commentsBySheet);
    model.unsupported = [...this.unsupported];
    return { model, warnings: this.warnings };
  }

  // ---- shared parts

  private readTheme(rels: Map<string, { target: string; type: string }>) {
    const rel = [...rels.values()].find((r) => r.type.endsWith("/theme"));
    const xml = rel ? readXml(this.zip, rel.target) : null;
    const scheme = xml ? descendants(xml, "clrScheme")[0] : undefined;
    if (!scheme) return;
    const colors = scheme.children.map((c) => {
      const value = c.children[0];
      if (!value) return "000000";
      return (value.attrs.lastClr ?? value.attrs.val ?? "000000").toUpperCase();
    });
    // Excel's theme indices swap the first two pairs: 0 light 1, 1 dark 1, 2 light 2, 3 dark 2.
    this.theme = [colors[1]!, colors[0]!, colors[3]!, colors[2]!, ...colors.slice(4)];
  }

  private color(node: XmlNode | undefined): string | undefined {
    if (!node) return undefined;
    const tint = Number(node.attrs.tint ?? 0);
    let hex: string | undefined;
    if (node.attrs.rgb) hex = node.attrs.rgb.slice(-6).toUpperCase();
    else if (node.attrs.theme !== undefined) hex = this.theme[Number(node.attrs.theme)];
    else if (node.attrs.indexed !== undefined) {
      const i = Number(node.attrs.indexed);
      if (i === 64 || i === 65) return undefined;
      hex = INDEXED[i];
    }
    return hex ? `#${applyTint(hex, tint)}` : undefined;
  }

  /**
   * Errors newer than the file format (#SPILL!, #CALC!) are saved as #VALUE! with a cell value
   * metadata index (vm) whose rich value names the real error; `errorType` counts Excel's
   * errors in order, #NULL! being 0.
   */
  private readRichErrors(rels: Map<string, { target: string; type: string }>) {
    const part = (suffix: string) => {
      const rel = [...rels.values()].find((r) => r.type.endsWith(suffix));
      return rel ? readXml(this.zip, rel.target) : null;
    };
    const metadata = part("/sheetMetadata");
    const values = part("/rdRichValue");
    const structures = part("/rdRichValueStructure");
    if (!metadata || !values || !structures) return;
    const typeAt = descendants(structures, "s").map((s) =>
      childrenNamed(s, "k").findIndex((k) => k.attrs.n === "errorType"),
    );
    const errorOf = descendants(values, "rv").map((rv) => {
      const at = typeAt[Number(rv.attrs.s ?? -1)] ?? -1;
      const type = at < 0 ? Number.NaN : Number(childrenNamed(rv, "v")[at]?.text);
      return type === 8 ? "#SPILL!" : type === 13 ? "#CALC!" : undefined;
    });
    const typeNames = descendants(metadata, "metadataType").map((t) => t.attrs.name);
    const future = descendants(metadata, "futureMetadata").find(
      (f) => f.attrs.name === "XLRICHVALUE",
    );
    const blocks = future ? childrenNamed(future, "bk") : [];
    const valueMetadata = descendants(metadata, "valueMetadata")[0];
    this.richErrors = childrenNamed(valueMetadata, "bk").map((bk) => {
      const rc = child(bk, "rc");
      if (!rc || typeNames[Number(rc.attrs.t) - 1] !== "XLRICHVALUE") return undefined;
      const block = blocks[Number(rc.attrs.v)];
      const rvb = block ? descendants(block, "rvb")[0] : undefined;
      return rvb ? errorOf[Number(rvb.attrs.i)] : undefined;
    });
  }

  private readSharedStrings(rels: Map<string, { target: string; type: string }>) {
    const rel = [...rels.values()].find((r) => r.type.endsWith("/sharedStrings"));
    const xml = rel ? readXml(this.zip, rel.target) : null;
    if (!xml) return;
    this.sharedStrings = descendants(xml, "si").map((si) => stringItem(si));
  }

  private readStyles(rels: Map<string, { target: string; type: string }>) {
    const rel = [...rels.values()].find((r) => r.type.endsWith("/styles"));
    const xml = rel ? readXml(this.zip, rel.target) : null;
    const sheet = xml ? child(xml, "styleSheet") : undefined;
    if (!sheet) return;
    const custom = new Map<number, string>();
    for (const fmt of childrenNamed(child(sheet, "numFmts"), "numFmt"))
      custom.set(Number(fmt.attrs.numFmtId), fmt.attrs.formatCode ?? "General");
    const fonts = childrenNamed(child(sheet, "fonts"), "font").map((font) => {
      const style: CellStyle = {};
      if (child(font, "b") && child(font, "b")!.attrs.val !== "0") style.bold = true;
      if (child(font, "i") && child(font, "i")!.attrs.val !== "0") style.italic = true;
      if (child(font, "u") && child(font, "u")!.attrs.val !== "none") style.underline = true;
      if (child(font, "strike") && child(font, "strike")!.attrs.val !== "0") style.strike = true;
      const size = Number(child(font, "sz")?.attrs.val);
      if (size && size !== 11) style.size = size;
      const color = this.color(child(font, "color"));
      if (color && color !== "#000000") style.color = color;
      return style;
    });
    const fills = childrenNamed(child(sheet, "fills"), "fill").map((fill) => {
      const pattern = child(fill, "patternFill");
      if (pattern?.attrs.patternType && pattern.attrs.patternType !== "none")
        return this.color(child(pattern, "fgColor")) ?? this.color(child(pattern, "bgColor"));
      const gradient = child(fill, "gradientFill");
      if (gradient) return this.color(child(childrenNamed(gradient, "stop")[0], "color"));
      return undefined;
    });
    const borders = childrenNamed(child(sheet, "borders"), "border").map((border) => {
      const out: NonNullable<CellStyle["border"]> = {};
      for (const [side, key] of [
        ["top", "t"],
        ["right", "r"],
        ["bottom", "b"],
        ["left", "l"],
      ] as const) {
        const edge = child(border, side);
        if (edge?.attrs.style && edge.attrs.style !== "none")
          out[key] = `${edge.attrs.style} ${this.color(child(edge, "color")) ?? "#000000"}`;
      }
      return Object.keys(out).length ? out : undefined;
    });
    this.xfs = childrenNamed(child(sheet, "cellXfs"), "xf").map((xf) => {
      const numFmtId = Number(xf.attrs.numFmtId ?? 0);
      const code = custom.get(numFmtId) ?? BUILTIN_FORMATS[numFmtId] ?? "General";
      const style: CellStyle = { ...(fonts[Number(xf.attrs.fontId ?? 0)] ?? {}) };
      const fill = fills[Number(xf.attrs.fillId ?? 0)];
      if (fill) style.fill = fill;
      const border = borders[Number(xf.attrs.borderId ?? 0)];
      if (border) style.border = border;
      const align = child(xf, "alignment");
      if (align) {
        const h = align.attrs.horizontal;
        if (h === "left" || h === "right" || h === "justify") style.align = h;
        else if (h === "center" || h === "centerContinuous") style.align = "center";
        const v = align.attrs.vertical;
        if (v === "top") style.valign = "top";
        else if (v === "center") style.valign = "middle";
        if (align.attrs.wrapText === "1") style.wrap = true;
        if (align.attrs.indent) style.indent = Number(align.attrs.indent);
        if (align.attrs.textRotation) style.rotate = Number(align.attrs.textRotation);
      }
      const protection = child(xf, "protection");
      if (protection?.attrs.locked === "0" || protection?.attrs.locked === "false")
        style.unlocked = true;
      if (protection?.attrs.hidden === "1" || protection?.attrs.hidden === "true")
        style.hidden = true;
      return { format: this.format(code), style };
    });
  }

  private format(code: string): number {
    if (code === "General") return -1;
    let index = this.formatIndex.get(code);
    if (index === undefined) {
      index = this.formats.length;
      this.formats.push(code);
      this.formatIndex.set(code, index);
    }
    return index;
  }

  private style(style: CellStyle): number {
    const json = JSON.stringify(style);
    if (json === EMPTY_STYLE) return -1;
    let index = this.styleIndex.get(json);
    if (index === undefined) {
      index = this.styles.length;
      this.styles.push(style);
      this.styleIndex.set(json, index);
    }
    return index;
  }

  /** One entry per distinct formula: copies that shift the same way share an entry. */
  private formula(text: string, row: number, col: number): number {
    let signature: string;
    try {
      signature = JSON.stringify(
        parseFormula(text, {
          row,
          col,
          sheetIndex: (name) =>
            this.sheetNames.findIndex((n) => n.toLowerCase() === name.toLowerCase()),
        }),
      );
    } catch {
      signature = `!${row}:${col}:${text}`;
    }
    let index = this.formulaIndex.get(signature);
    if (index === undefined) {
      index = this.formulas.length;
      this.formulas.push({ text, row, col });
      this.formulaIndex.set(signature, index);
    }
    return index;
  }

  // ---- sheets

  readonly commentsBySheet = new Map<number, Map<string, string>>();

  private readSheet(
    index: number,
    path: string,
    xml: XmlNode,
    hidden: boolean,
    tables: TableSpec[],
    validations: Validation[],
  ): SheetSpec {
    const ws = child(xml, "worksheet")!;
    const name = this.sheetNames[index]!;
    const rels = relationships(this.zip, path);
    const cells: Array<[number, number, CellSpec]> = [];
    const shared = new Map<string, { formula: number; row: number; col: number }>();
    const colWidths: Array<number | null> = [];
    const hiddenCols: number[] = [];
    const rowHeights: Array<number | null> = [];
    const hiddenRows: number[] = [];
    const columnStyles = new Map<number, number>();
    let maxRow = 0;
    let maxCol = 0;

    for (const col of childrenNamed(child(ws, "cols"), "col")) {
      const min = Number(col.attrs.min) - 1;
      const max = Math.min(Number(col.attrs.max) - 1, 16383);
      for (let c = min; c <= max && c < 1024; c++) {
        if (col.attrs.width && col.attrs.customWidth !== "0")
          colWidths[c] = Number(col.attrs.width);
        if (col.attrs.hidden === "1" || col.attrs.hidden === "true") hiddenCols.push(c);
        if (col.attrs.style) columnStyles.set(c, Number(col.attrs.style));
      }
    }

    let nextRow = 0;
    for (const rowNode of childrenNamed(child(ws, "sheetData"), "row")) {
      const row = rowNode.attrs.r ? Number(rowNode.attrs.r) - 1 : nextRow;
      nextRow = row + 1;
      if (rowNode.attrs.ht && rowNode.attrs.customHeight === "1")
        rowHeights[row] = Number(rowNode.attrs.ht);
      if (rowNode.attrs.hidden === "1" || rowNode.attrs.hidden === "true") hiddenRows.push(row);
      let nextCol = 0;
      for (const c of childrenNamed(rowNode, "c")) {
        const at = c.attrs.r ? decodeCell(c.attrs.r) : { row, col: nextCol };
        if (!at) continue;
        nextCol = at.col + 1;
        const spec = this.readCell(c, at.row, at.col, shared);
        if (!spec) continue;
        cells.push([at.row, at.col, spec]);
        if (spec.v !== undefined || spec.f !== undefined) {
          maxRow = Math.max(maxRow, at.row, spec.a?.[0] ?? 0);
          maxCol = Math.max(maxCol, at.col, spec.a?.[1] ?? 0);
        }
      }
    }

    const merges: Array<[number, number, number, number]> = [];
    for (const merge of childrenNamed(child(ws, "mergeCells"), "mergeCell")) {
      const r = decodeRange(merge.attrs.ref ?? "");
      if (r) merges.push([r.r1, r.c1, r.r2, r.c2]);
    }

    const protection = child(ws, "sheetProtection");
    const isProtected = !!protection && ["1", "true"].includes(protection.attrs.sheet ?? "");

    const dv = child(ws, "dataValidations");
    for (const node of childrenNamed(dv, "dataValidation"))
      validations.push(validationFromXml(index, node));
    // Newer files put validations whose lists live on other sheets in the extension list.
    for (const node of descendants(ws, "dataValidation"))
      if (!childrenNamed(dv, "dataValidation").includes(node))
        validations.push(validationFromXml(index, node));

    for (const part of childrenNamed(child(ws, "tableParts"), "tablePart")) {
      const rel = rels.get(part.attrs["r:id"] ?? "");
      const table = rel ? readXml(this.zip, rel.target) : null;
      const t = table ? child(table, "table") : undefined;
      const r = t ? decodeRange(t.attrs.ref ?? "") : null;
      if (!t || !r) continue;
      tables.push({
        name: t.attrs.displayName ?? t.attrs.name ?? `Table${tables.length + 1}`,
        sheet: index,
        ...r,
        header: t.attrs.headerRowCount !== "0",
        totals:
          Number(t.attrs.totalsRowCount ?? 0) > 0 ||
          (t.attrs.totalsRowShown === "1" && Number(t.attrs.totalsRowCount ?? 0) > 0),
        columns: childrenNamed(child(t, "tableColumns"), "tableColumn").map(
          (col) => col.attrs.name ?? "",
        ),
      });
    }

    let drawings = 0;
    for (const rel of rels.values()) {
      if (rel.type.endsWith("/drawing")) {
        const drawing = readXml(this.zip, rel.target);
        if (!drawing) continue;
        const charts = descendants(drawing, "chart").length;
        const pictures = descendants(drawing, "pic").length;
        drawings += charts + pictures;
        if (charts)
          this.unsupported.add(
            `"${name}" has ${charts} chart${charts === 1 ? "" : "s"}, which are not redrawn.`,
          );
      }
      if (rel.type.endsWith("/comments")) {
        const comments = readXml(this.zip, rel.target);
        if (!comments) continue;
        const map = new Map<string, string>();
        for (const comment of descendants(comments, "comment"))
          map.set(
            (comment.attrs.ref ?? "").toUpperCase(),
            stringItem(child(comment, "text") ?? comment).trim(),
          );
        this.commentsBySheet.set(index, map);
      }
      if (rel.type.endsWith("/ctrlProp")) {
        const ctrl = readXml(this.zip, rel.target);
        const props = ctrl ? child(ctrl, "formControlPr") : undefined;
        if (props?.attrs.fmlaLink)
          this.unsupported.add(
            `"${name}" has a form control linked to ${props.attrs.fmlaLink}; it shows as a plain input.`,
          );
      }
    }
    if (descendants(ws, "conditionalFormatting").length)
      this.warnings.push(`"${name}" has conditional formatting, which is not shown.`);

    return {
      name,
      ...(hidden ? { hidden: true } : {}),
      rows: maxRow,
      cols: maxCol,
      ...(colWidths.length ? { colWidths: Array.from(colWidths, (w) => w ?? null) } : {}),
      ...(rowHeights.length ? { rowHeights: Array.from(rowHeights, (h) => h ?? null) } : {}),
      ...(hiddenCols.length ? { hiddenCols } : {}),
      ...(hiddenRows.length ? { hiddenRows } : {}),
      ...(merges.length ? { merges } : {}),
      ...(isProtected ? { protected: true } : {}),
      ...(drawings ? { drawings } : {}),
      cells,
    };
  }

  private readCell(
    c: XmlNode,
    row: number,
    col: number,
    shared: Map<string, { formula: number; row: number; col: number }>,
  ): CellSpec | null {
    const spec: CellSpec = {};
    const xf = this.xfs[Number(c.attrs.s ?? 0)];
    if (xf) {
      if (xf.format >= 0) spec.z = xf.format;
      const s = this.style(xf.style);
      if (s >= 0) spec.s = s;
    }
    const v = child(c, "v");
    const type = c.attrs.t ?? "n";
    let value: CellValueJson | undefined;
    if (type === "inlineStr") value = stringItem(child(c, "is") ?? c);
    else if (v) {
      const raw = v.text;
      switch (type) {
        case "s":
          value = this.sharedStrings[Number(raw)] ?? "";
          break;
        case "str":
          value = decodeExcelEscapes(raw);
          break;
        case "b":
          value = raw === "1" || raw === "true";
          break;
        case "e":
          value = {
            e:
              (c.attrs.vm && this.richErrors[Number(c.attrs.vm) - 1]) ||
              ((ERRORS as readonly string[]).includes(raw) ? (raw as ErrorCode) : "#VALUE!"),
          };
          break;
        case "d": {
          const date = new Date(raw.endsWith("Z") || raw.length <= 10 ? raw : `${raw}Z`);
          value = Number.isNaN(date.getTime()) ? raw : dateSerial(date);
          break;
        }
        default:
          value = raw === "" ? null : Number(raw);
      }
    }
    if (value !== undefined && value !== null) spec.v = value;

    const f = child(c, "f");
    if (f) {
      const kind = f.attrs.t ?? "normal";
      const text = decodeExcelEscapes(f.text);
      if (kind === "dataTable") {
        const range = decodeRange(f.attrs.ref ?? "");
        const input = (ref: string | undefined, deleted: string | undefined) =>
          deleted === "1" || !ref ? "#REF!" : absolute(ref);
        const first = input(f.attrs.r1, f.attrs.del1);
        const args =
          f.attrs.dt2D === "1"
            ? `${first},${input(f.attrs.r2, f.attrs.del2)}`
            : f.attrs.dtr === "1"
              ? `${first},`
              : `,${first}`;
        if (range && range.r1 === row && range.c1 === col) {
          spec.f = this.formula(`TABLE(${args})`, row, col);
          spec.a = [range.r2, range.c2];
        }
      } else if (kind === "shared") {
        const si = f.attrs.si ?? "";
        const master = shared.get(si);
        if (text) {
          const index = this.formula(text, row, col);
          shared.set(si, { formula: index, row, col });
          spec.f = index;
        } else if (master) spec.f = master.formula;
      } else if (text) {
        spec.f = this.formula(text, row, col);
        if (kind === "array") {
          const range = decodeRange(f.attrs.ref ?? "") ?? { r1: row, c1: col, r2: row, c2: col };
          spec.a = [range.r2, range.c2];
          if (c.attrs.cm) spec.d = true;
        }
      }
    }
    if (
      spec.v === undefined &&
      spec.f === undefined &&
      spec.s === undefined &&
      spec.z === undefined
    )
      return null;
    return spec;
  }

  // ---- names and external workbooks

  private readNames(wb: XmlNode): NameSpec[] {
    const names: NameSpec[] = [];
    for (const node of childrenNamed(child(wb, "definedNames"), "definedName")) {
      const name = node.attrs.name ?? "";
      if (!name || name.startsWith("_xlnm.")) continue;
      const formula = decodeExcelEscapes(node.text).trim();
      names.push({
        name,
        ...(node.attrs.localSheetId !== undefined
          ? { sheet: Number(node.attrs.localSheetId) }
          : {}),
        formula,
        ...(node.attrs.hidden === "1" ? { hidden: true as const } : {}),
      });
    }
    return names;
  }

  /**
   * Values Excel cached for other workbooks, as hidden sheets named "[n]Sheet", so references to
   * them read exactly what Excel last read.
   */
  /** The path part of a saved CELL("filename") result, which Excel writes with the folder it was saved in. */
  private savedBookPath(sheets: SheetSpec[]): string | undefined {
    for (const sheet of sheets)
      for (const [, , cell] of sheet.cells) {
        if (cell.f === undefined || typeof cell.v !== "string") continue;
        if (!/CELL\(\s*"filename"/i.test(this.formulas[cell.f]!.text)) continue;
        const end = cell.v.lastIndexOf("]");
        if (end > 0 && cell.v.includes("[")) return cell.v.slice(0, end + 1);
        // Only the folder was kept (LEFT(CELL("filename"), FIND("[", …) - 1)).
        if (/[\\/]$/.test(cell.v)) return `${cell.v}[${this.fileName}]`;
      }
    return undefined;
  }

  private readExternals(
    rels: Map<string, { target: string; type: string }>,
    sheets: SheetSpec[],
  ): Record<string, CellValueJson> {
    const links = [...rels.values()].filter((r) => r.type.endsWith("/externalLink"));
    links.sort(
      (a, b) =>
        Number(/(\d+)\.xml$/.exec(a.target)?.[1] ?? 0) -
        Number(/(\d+)\.xml$/.exec(b.target)?.[1] ?? 0),
    );
    links.forEach((rel, i) => {
      const xml = readXml(this.zip, rel.target);
      const book = xml ? descendants(xml, "externalBook")[0] : undefined;
      if (!book) return;
      const bookNumber = String(Number(/(\d+)\.xml$/.exec(rel.target)?.[1] ?? i + 1));
      const names = childrenNamed(child(book, "sheetNames"), "sheetName").map(
        (n) => n.attrs.val ?? "",
      );
      const data = childrenNamed(child(book, "sheetDataSet"), "sheetData");
      names.forEach((sheetName, sheetId) => {
        const sheetData = data.find((d) => Number(d.attrs.sheetId) === sheetId);
        // Excel could not read this sheet when it last refreshed, so references to it are #REF!.
        if (sheetData?.attrs.refreshError === "1" && !childrenNamed(sheetData, "row").length)
          return;
        const cells: Array<[number, number, CellSpec]> = [];
        let rows = 0;
        let cols = 0;
        for (const rowNode of childrenNamed(sheetData, "row")) {
          for (const c of childrenNamed(rowNode, "cell")) {
            const at = decodeCell(c.attrs.r ?? "");
            const v = child(c, "v");
            if (!at || !v) continue;
            const type = c.attrs.t ?? "n";
            const value: CellValueJson =
              type === "s" || type === "str"
                ? v.text
                : type === "b"
                  ? v.text === "1"
                  : type === "e"
                    ? {
                        e: ((ERRORS as readonly string[]).includes(v.text)
                          ? v.text
                          : "#REF!") as ErrorCode,
                      }
                    : Number(v.text);
            cells.push([at.row, at.col, { v: value }]);
            rows = Math.max(rows, at.row);
            cols = Math.max(cols, at.col);
          }
        }
        sheets.push({
          name: `[${bookNumber}]${sheetName}`,
          hidden: true,
          external: true,
          rows,
          cols,
          cells,
        });
      });
      this.unsupported.add(`Links to another workbook keep the values Excel last read from it.`);
    });
    return {};
  }
}

/** A shared or inline string: its runs joined, phonetic guides left out. */
function stringItem(node: XmlNode): string {
  let out = "";
  for (const c of node.children) {
    if (c.name === "t") out += c.text;
    else if (c.name === "r") out += textOf(child(c, "t"));
  }
  return decodeExcelEscapes(out);
}

// -----------------------------------------------------------------------------------------------
// Inputs

const MAX_LABEL_DISTANCE = 6;

/** A data validation rule as either file format stores it, with its formulas as text. */
type Validation = {
  sheet: number;
  type: string;
  operator: string;
  sqref: string;
  formula1: string;
  formula2: string;
  prompt?: string;
};

function validationFromXml(sheet: number, node: XmlNode): Validation {
  return {
    sheet,
    type: node.attrs.type ?? "any",
    operator: node.attrs.operator ?? "between",
    sqref: node.attrs.sqref ?? textOf(child(node, "sqref")),
    formula1: textOf(child(node, "formula1")).trim(),
    formula2: textOf(child(node, "formula2")).trim(),
    ...(node.attrs.prompt ? { prompt: node.attrs.prompt } : {}),
  };
}

function detectInputs(
  model: CalcModel,
  engine: Engine,
  validations: Validation[],
  comments: Map<number, Map<string, string>>,
): InputSpec[] {
  const referenced = engine.referencedAreas();
  const isReferenced = (sheet: number, row: number, col: number) =>
    (referenced.get(sheet) ?? []).some(
      (a) => row >= a.r1 && row <= a.r2 && col >= a.c1 && col <= a.c2,
    );
  const singleRefs = engine.singleCellReferences();
  const cellAt = new Map<string, CellSpec>();
  model.sheets.forEach((sheet, s) => {
    for (const [row, col, cell] of sheet.cells) cellAt.set(`${s}:${row}:${col}`, cell);
  });
  const found = new Map<string, InputSpec>();
  const add = (input: InputSpec) => {
    const key = `${input.sheet}:${input.row}:${input.col}`;
    const existing = found.get(key);
    found.set(key, existing ? { ...existing, ...input, why: existing.why } : input);
  };

  // Unlocked cells on protected sheets: the workbook's own statement of what people fill in.
  model.sheets.forEach((sheet, s) => {
    if (!sheet.protected) return;
    for (const [row, col, cell] of sheet.cells) {
      if (cell.f !== undefined || cell.s === undefined || !model.styles[cell.s]?.unlocked) continue;
      if (cell.v === undefined && !isReferenced(s, row, col)) continue;
      if (typeof cell.v === "string" && !isReferenced(s, row, col)) continue;
      add({ sheet: s, row, col, kind: kindOf(cell, model), why: "unlocked" });
    }
  });

  // Data validation: lists become choices, number and date rules become limits.
  for (const { sheet: s, type, operator: op, sqref, formula1, formula2, prompt } of validations) {
    for (const part of sqref.split(/\s+/).filter(Boolean)) {
      const range = decodeRange(part);
      if (!range || (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1) > 2000) continue;
      for (let row = range.r1; row <= range.r2; row++) {
        for (let col = range.c1; col <= range.c2; col++) {
          const cell = cellAt.get(`${s}:${row}:${col}`);
          if (cell?.f !== undefined) continue;
          if (!cell?.v && !isReferenced(s, row, col)) continue;
          const input: InputSpec = { sheet: s, row, col, kind: "number", why: "validation" };
          if (type === "list") {
            input.kind = "choice";
            if (/^".*"$/.test(formula1)) input.options = splitList(formula1.slice(1, -1));
            else {
              input.optionsFormula = formula1;
              input.options = listOptions(engine, formula1, s, row, col);
            }
          } else if (type === "whole" || type === "decimal" || type === "date" || type === "time") {
            input.kind = type === "date" ? "date" : "number";
            if (type === "whole") input.integer = true;
            const a = constant(formula1);
            const b = constant(formula2);
            if (op === "between") {
              if (a !== null) input.min = a;
              if (b !== null) input.max = b;
            } else if (op === "greaterThanOrEqual" || op === "greaterThan") {
              if (a !== null) input.min = a;
            } else if (op === "lessThanOrEqual" || op === "lessThan") {
              if (a !== null) input.max = a;
            }
          } else if (type === "textLength") input.kind = "text";
          else input.kind = kindOf(cell, model);
          if (prompt) input.help = prompt;
          add(input);
        }
      }
    }
  }

  // Workbooks with no protection or validation: constants that formulas read one cell at a time.
  if (!found.size) {
    for (const [key] of singleRefs) {
      const [s, row, col] = key.split(":").map(Number) as [number, number, number];
      const cell = cellAt.get(key);
      if (!cell || cell.f !== undefined || cell.v === undefined || model.sheets[s]?.external)
        continue;
      if (typeof cell.v === "object" && cell.v !== null) continue;
      add({ sheet: s, row, col, kind: kindOf(cell, model), why: "constant" });
    }
  }

  const inputs = [...found.values()].sort(
    (a, b) => a.sheet - b.sheet || a.row - b.row || a.col - b.col,
  );
  const isInput = (sheet: number, row: number, col: number) => found.has(`${sheet}:${row}:${col}`);
  for (const input of inputs) {
    const label = labelFor(cellAt, input, isInput);
    if (label) input.label = label;
    const unit = unitFor(cellAt, input, isInput);
    if (unit) input.unit = unit;
    const note = comments.get(input.sheet)?.get(`${columnLetters(input.col)}${input.row + 1}`);
    if (note && !input.help) input.help = note;
  }
  return inputs;
}

function kindOf(cell: CellSpec | undefined, model: CalcModel): InputSpec["kind"] {
  if (!cell || cell.v === undefined) return "number";
  if (typeof cell.v === "boolean") return "boolean";
  if (typeof cell.v === "string") return "text";
  const format = cell.z !== undefined ? (model.formats[cell.z] ?? "") : "";
  if (
    typeof cell.v === "number" &&
    /(^|[^\\"])[dy]/i.test(format.replace(/"[^"]*"/g, "")) &&
    !/\[h\]/i.test(format)
  )
    return "date";
  return "number";
}

function constant(formula: string): number | null {
  if (!formula) return null;
  const n = Number(formula);
  return Number.isFinite(n) ? n : null;
}

function splitList(text: string): Array<string | number> {
  return text.split(",").map((item) => {
    const trimmed = item.trim();
    const n = Number(trimmed);
    return trimmed !== "" && Number.isFinite(n) ? n : trimmed;
  });
}

function listOptions(
  engine: Engine,
  formula: string,
  sheet: number,
  row: number,
  col: number,
): Array<string | number> {
  try {
    const values = engine.evaluateFormula(formula, sheet, row, col);
    return values.filter(
      (v): v is string | number => (typeof v === "string" && v !== "") || typeof v === "number",
    );
  } catch {
    return [];
  }
}

type IsInput = (sheet: number, row: number, col: number) => boolean;

/** The nearest text to the left, or above, that is not itself another input's value. */
function labelFor(
  cellAt: Map<string, CellSpec>,
  input: InputSpec,
  isInput: IsInput,
): string | undefined {
  for (let c = input.col - 1; c >= Math.max(0, input.col - MAX_LABEL_DISTANCE); c--) {
    if (isInput(input.sheet, input.row, c)) break;
    const cell = cellAt.get(`${input.sheet}:${input.row}:${c}`);
    if (typeof cell?.v === "string" && cell.v.trim() && !/^[=:]+$/.test(cell.v.trim()))
      return cell.v.trim().replace(/\s*[:=]$/, "");
    if (cell?.v !== undefined && typeof cell.v !== "string") break;
  }
  for (let r = input.row - 1; r >= Math.max(0, input.row - 2); r--) {
    if (isInput(input.sheet, r, input.col)) break;
    const cell = cellAt.get(`${input.sheet}:${r}:${input.col}`);
    if (typeof cell?.v === "string" && cell.v.trim()) return cell.v.trim();
  }
  return undefined;
}

/** Short text just right of the input (mm, kN/m²), unless it labels the next cell ("h ="). */
function unitFor(
  cellAt: Map<string, CellSpec>,
  input: InputSpec,
  isInput: IsInput,
): string | undefined {
  if (isInput(input.sheet, input.row, input.col + 1)) return undefined;
  const cell = cellAt.get(`${input.sheet}:${input.row}:${input.col + 1}`);
  const text = typeof cell?.v === "string" && cell.f === undefined ? cell.v.trim() : "";
  if (text && text.length <= 12 && !/[=:]$/.test(text)) return text;
  return undefined;
}

function columnLetters(col: number): string {
  let name = "";
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

// -----------------------------------------------------------------------------------------------
// Other formats

function compileWithSheetJs(bytes: Uint8Array, fileName: string, sha256: string): CompileResult {
  const wb = XLSX.read(bytes, { type: "array", cellFormula: true, cellNF: true, cellDates: false });
  const names = wb.SheetNames;
  const legacy = isCompoundFile(bytes) ? readLegacy(bytes) : new Map<string, LegacySheet>();
  const renamed = legacyNameClashes((wb.Workbook?.Names ?? []).map((n) => n.Name));
  const unsupported = new Set<string>();
  const formulas: CalcModel["formulas"] = [];
  const formats: string[] = [];
  const formatIndex = new Map<string, number>();
  const sheets: SheetSpec[] = names.map((name, index) => {
    const ws = wb.Sheets[name]!;
    const extra = legacy.get(name);
    const tables = extra?.tables ?? [];
    const cells: Array<[number, number, CellSpec]> = [];
    let rows = 0;
    let cols = 0;
    for (const [ref, raw] of Object.entries(ws)) {
      if (ref.startsWith("!")) continue;
      const at = decodeCell(ref);
      if (!at) continue;
      const cell = raw as XLSX.CellObject & { F?: string; D?: boolean };
      const spec: CellSpec = {};
      if (cell.t === "n") spec.v = cell.v as number;
      else if (cell.t === "s") spec.v = String(cell.v ?? "");
      else if (cell.t === "b") spec.v = !!cell.v;
      else if (cell.t === "e")
        spec.v = {
          e: ((ERRORS as readonly string[]).includes(cell.w ?? "")
            ? cell.w
            : "#VALUE!") as ErrorCode,
        };
      else if (cell.t === "d" && cell.v instanceof Date) spec.v = dateSerial(cell.v);
      const table = tables.find((t) => t.r1 === at.row && t.c1 === at.col);
      if (table) {
        spec.f = formulas.length;
        formulas.push({ text: `TABLE(${table.args})`, row: at.row, col: at.col });
        spec.a = [table.r2, table.c2];
      } else if (cell.f === "undefined") {
        if (
          !tables.some((t) => at.row >= t.r1 && at.row <= t.r2 && at.col >= t.c1 && at.col <= t.c2)
        )
          unsupported.add(
            `"${name}" has formulas this file type does not let the importer read; they keep the values Excel saved.`,
          );
      } else if (cell.f) {
        spec.f = formulas.length;
        formulas.push({ text: renameIn(cell.f, renamed), row: at.row, col: at.col });
        if (cell.F) {
          const range = decodeRange(cell.F);
          if (range && range.r1 === at.row && range.c1 === at.col) spec.a = [range.r2, range.c2];
          if (cell.D) spec.d = true;
        }
      }
      if (cell.z && cell.z !== "General") {
        const code = String(cell.z);
        let i = formatIndex.get(code);
        if (i === undefined) {
          i = formats.length;
          formats.push(code);
          formatIndex.set(code, i);
        }
        spec.z = i;
      }
      if (extra?.unlocked.has(`${at.row}:${at.col}`)) spec.s = 0;
      if (spec.v === undefined && spec.f === undefined && spec.s === undefined) continue;
      cells.push([at.row, at.col, spec]);
      rows = Math.max(rows, at.row);
      cols = Math.max(cols, at.col);
    }
    // Unlocked cells left empty are still the places to type into.
    const present = new Set(cells.map(([r, c]) => `${r}:${c}`));
    for (const at of extra?.unlocked ?? []) {
      if (present.has(at)) continue;
      const [row, col] = at.split(":").map(Number) as [number, number];
      cells.push([row, col, { s: 0 }]);
    }
    void index;
    return { name, rows, cols, cells, ...(extra?.protected ? { protected: true } : {}) };
  });
  const application = wb.Props?.Application?.trim();
  const appVersion = wb.Props?.AppVersion?.trim();
  // A legacy .xls holds the results the program that saved it calculated; there is no calculation chain to check.
  const excelCalculated =
    isCompoundFile(bytes) && !!application && /^Microsoft (Macintosh )?Excel$/.test(application);
  const iteration = [...legacy.values()][0]?.iterate;
  const model: CalcModel = {
    version: 1,
    source: {
      fileName,
      sha256,
      ...(application ? { application } : {}),
      ...(appVersion ? { appVersion } : {}),
      ...(excelCalculated ? { excelCalculated } : {}),
    },
    date1904: !!wb.Workbook?.WBProps?.date1904,
    ...(iteration?.on
      ? { iterate: { count: iteration.count, delta: iteration.delta } }
      : iteration
        ? { iterationOff: true as const }
        : {}),
    sheets,
    formulas,
    formats,
    styles: [{ unlocked: true }],
    names: (wb.Workbook?.Names ?? [])
      .filter((n) => n.Name && !n.Name.startsWith("_xlnm."))
      .map((n) => ({
        name: renamed.get(n.Name.toLowerCase()) ?? n.Name,
        ...(n.Sheet !== undefined && n.Sheet !== null ? { sheet: n.Sheet } : {}),
        formula: renameIn(n.Ref, renamed),
      })),
    tables: [],
    externals: {},
    inputs: [],
    unsupported: [
      ...(legacy.size && [...legacy.values()].some((sheet) => sheet.protected)
        ? []
        : ["This file type carries no protection here, so inputs are guessed from the formulas."]),
      ...unsupported,
    ],
  };
  const engine = new Engine(model);
  for (const name of engine.missingFunctions)
    model.unsupported.push(`${name} is not an Excel function this engine calculates.`);
  const validations = names.flatMap((name, sheet) =>
    (legacy.get(name)?.validations ?? []).map((rule) => ({ ...rule, sheet })),
  );
  model.inputs = detectInputs(model, engine, validations, new Map());
  return { model, warnings: [] };
}

type LegacyTable = { r1: number; c1: number; r2: number; c2: number; args: string };

const absolute = (ref: string) =>
  ref.replace(
    /^\$?([A-Za-z]{1,3})\$?(\d+)$/,
    (_, c: string, r: string) => `$${c.toUpperCase()}$${r}`,
  );

type LegacySheet = {
  tables: LegacyTable[];
  protected: boolean;
  unlocked: Set<string>;
  validations: Array<Omit<Validation, "sheet">>;
  /** The workbook's iteration settings, which BIFF8 repeats in every sheet's calculation records. */
  iterate: { on: boolean; count: number; delta: number };
};

const LEGACY_VALIDATION_TYPES = [
  "any",
  "whole",
  "decimal",
  "list",
  "date",
  "time",
  "textLength",
  "custom",
];
const LEGACY_OPERATORS = [
  "between",
  "notBetween",
  "equal",
  "notEqual",
  "greaterThan",
  "lessThan",
  "greaterThanOrEqual",
  "lessThanOrEqual",
];
/** Built-in function numbers (BIFF8 FTAB) that list validations commonly use, with fixed argument counts where fixed. */
const LEGACY_FUNCTIONS: Record<number, [string, number]> = {
  1: ["IF", -1],
  8: ["ROW", -1],
  9: ["COLUMN", -1],
  29: ["INDEX", -1],
  64: ["MATCH", -1],
  76: ["ROWS", 1],
  77: ["COLUMNS", 1],
  78: ["OFFSET", -1],
  100: ["CHOOSE", -1],
  148: ["INDIRECT", -1],
  169: ["COUNTA", -1],
  219: ["ADDRESS", -1],
  346: ["COUNTIF", 2],
};
const LEGACY_BINARY = [
  "",
  "",
  "",
  "+",
  "-",
  "*",
  "/",
  "^",
  "&",
  "<",
  "<=",
  "=",
  ">=",
  ">",
  "<>",
  " ",
  ",",
  ":",
];

/**
 * What the reader leaves out of a legacy .xls (BIFF8), by sheet name: what-if data tables (the cell
 * formulas only point at a TABLE record holding the range and input cells), sheet protection and
 * which cells are unlocked, the workbook's own statement of what people fill in, and data validations.
 */
function readLegacy(bytes: Uint8Array): Map<string, LegacySheet> {
  const out = new Map<string, LegacySheet>();
  const cfb = XLSX.CFB.read(bytes, { type: "array" });
  const entry = XLSX.CFB.find(cfb, "Workbook");
  const content = entry?.content;
  if (!content) return out;
  const data =
    content instanceof Uint8Array ? content : new Uint8Array(content as ArrayLike<number>);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const sheetAt = new Map<number, string>();
  const sheetNames: string[] = [];
  const names: string[] = [];
  const books: boolean[] = [];
  const externSheets: Array<[number, number]> = [];
  const records: Array<[number, number, number, number]> = [];
  const unicode = (at: number, length: number): [string, number] => {
    const wide = (data[at]! & 1) === 1;
    let text = "";
    for (let n = 0; n < length; n++)
      text += String.fromCharCode(wide ? view.getUint16(at + 1 + n * 2, true) : data[at + 1 + n]!);
    return [text, at + 1 + length * (wide ? 2 : 1)];
  };
  let globals = true;
  for (let i = 0; i + 4 <= data.length; ) {
    const type = view.getUint16(i, true);
    const size = view.getUint16(i + 2, true);
    const body = i + 4;
    records.push([i, type, body, size]);
    if (type === 0x000a) globals = false;
    if (type === 0x0085 && size >= 8) {
      const name = unicode(i + 11, data[i + 10]!)[0];
      sheetAt.set(view.getUint32(i + 4, true), name);
      sheetNames.push(name);
    } else if (globals && type === 0x0018 && size >= 14) {
      const builtIn = (view.getUint16(body, true) & 0x20) !== 0;
      const name = unicode(body + 14, data[body + 3]!)[0];
      names.push(builtIn ? `_xlnm.${name}` : name);
    } else if (globals && type === 0x01ae && size >= 4)
      books.push(view.getUint16(body + 2, true) === 0x0401);
    else if (globals && type === 0x0017 && size >= 2) {
      const count = view.getUint16(body, true);
      for (let n = 0; n < count && 2 + n * 6 + 6 <= size; n++) {
        const at = body + 2 + n * 6;
        externSheets.push(
          books[view.getUint16(at, true)]
            ? [view.getInt16(at + 2, true), view.getInt16(at + 4, true)]
            : [-1, -1],
        );
      }
    }
    i += 4 + size;
  }
  const quoted = (name: string) =>
    /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name)
      ? name
      : `'${name.replace(/'/g, "''")}'`;
  const cellRef = (row: number, colField: number) =>
    `${colField & 0x4000 ? "" : "$"}${columnLetters(colField & 0x3fff)}${colField & 0x8000 ? "" : "$"}${row + 1}`;
  const sheetPrefix = (ixti: number) => {
    const [first, last] = externSheets[ixti] ?? [-1, -1];
    const a = sheetNames[first];
    const b = sheetNames[last];
    if (a === undefined || b === undefined) return null;
    return `${a === b ? quoted(a) : `${quoted(a)}:${quoted(b)}`}!`;
  };
  /** A validation formula's parsed tokens (Rgce) back to text; null for tokens it does not know. */
  const formula = (at: number, length: number): string | null => {
    const stack: string[] = [];
    const end = at + length;
    for (let p = at; p < end; ) {
      const token = data[p++]!;
      const base = token < 0x20 ? token : (token & 0x3f) | 0x20;
      if (token >= 0x03 && token <= 0x11) {
        const b = stack.pop();
        const a = stack.pop();
        if (a === undefined || b === undefined) return null;
        stack.push(`${a}${LEGACY_BINARY[token]}${b}`);
      } else if (token === 0x12 || token === 0x13) {
        const a = stack.pop();
        if (a === undefined) return null;
        stack.push(`${token === 0x12 ? "+" : "-"}${a}`);
      } else if (token === 0x14) {
        const a = stack.pop();
        if (a === undefined) return null;
        stack.push(`${a}%`);
      } else if (token === 0x15) {
        const a = stack.pop();
        if (a === undefined) return null;
        stack.push(`(${a})`);
      } else if (token === 0x16) stack.push("");
      else if (token === 0x17) {
        const [text, next] = unicode(p + 1, data[p]!);
        stack.push(`"${text.replace(/"/g, '""')}"`);
        p = next;
      } else if (token === 0x19) {
        const kind = data[p]!;
        if (kind & 0x10) {
          const a = stack.pop();
          if (a === undefined) return null;
          stack.push(`SUM(${a})`);
        }
        p += kind & 0x04 ? 3 + 2 * (view.getUint16(p + 1, true) + 1) : 3;
      } else if (token === 0x1d) stack.push(data[p++] ? "TRUE" : "FALSE");
      else if (token === 0x1e) {
        stack.push(String(view.getUint16(p, true)));
        p += 2;
      } else if (token === 0x1f) {
        stack.push(String(view.getFloat64(p, true)));
        p += 8;
      } else if (base === 0x21 || base === 0x22) {
        const count = base === 0x22 ? data[p++]! & 0x7f : -1;
        const fn = LEGACY_FUNCTIONS[view.getUint16(p, true) & 0x7fff];
        p += 2;
        const n = count >= 0 ? count : (fn?.[1] ?? -1);
        if (!fn || n < 0 || stack.length < n) return null;
        stack.push(`${fn[0]}(${stack.splice(stack.length - n, n).join(",")})`);
      } else if (base === 0x23) {
        const name = names[view.getUint16(p, true) - 1];
        if (name === undefined) return null;
        stack.push(name);
        p += 4;
      } else if (base === 0x24) {
        stack.push(cellRef(view.getUint16(p, true), view.getUint16(p + 2, true)));
        p += 4;
      } else if (base === 0x25) {
        stack.push(
          `${cellRef(view.getUint16(p, true), view.getUint16(p + 4, true))}:${cellRef(view.getUint16(p + 2, true), view.getUint16(p + 6, true))}`,
        );
        p += 8;
      } else if (base === 0x3a || base === 0x3b) {
        const prefix = sheetPrefix(view.getUint16(p, true));
        if (prefix === null) return null;
        const q = p + 2;
        stack.push(
          base === 0x3a
            ? `${prefix}${cellRef(view.getUint16(q, true), view.getUint16(q + 2, true))}`
            : `${prefix}${cellRef(view.getUint16(q, true), view.getUint16(q + 4, true))}:${cellRef(view.getUint16(q + 2, true), view.getUint16(q + 6, true))}`,
        );
        p = q + (base === 0x3a ? 4 : 8);
      } else return null;
    }
    return stack.length === 1 ? stack[0]! : null;
  };
  const validation = (body: number, size: number): Omit<Validation, "sheet"> | null => {
    const flags = view.getUint32(body, true);
    let p = body + 4;
    const strings: string[] = [];
    for (let n = 0; n < 4; n++) {
      const [text, next] = unicode(p + 2, view.getUint16(p, true));
      strings.push(text === "\0" ? "" : text);
      p = next;
    }
    const formulas: string[] = [];
    for (let n = 0; n < 2; n++) {
      const length = view.getUint16(p, true);
      const text = length ? formula(p + 4, length) : "";
      if (text === null) return null;
      formulas.push(text);
      p += 4 + length;
    }
    const ranges: string[] = [];
    const count = view.getUint16(p, true);
    for (let n = 0, q = p + 2; n < count && q + 8 <= body + size; n++, q += 8) {
      const r1 = view.getUint16(q, true);
      const r2 = view.getUint16(q + 2, true);
      const c1 = view.getUint16(q + 4, true);
      const c2 = view.getUint16(q + 6, true);
      const a = `${columnLetters(c1)}${r1 + 1}`;
      const b = `${columnLetters(c2)}${r2 + 1}`;
      ranges.push(a === b ? a : `${a}:${b}`);
    }
    const type = LEGACY_VALIDATION_TYPES[flags & 0x0f] ?? "any";
    // A literal list is one string token whose items are separated by NUL characters.
    const formula1 =
      type === "list" && flags & 0x80 ? formulas[0]!.replace(/\0/g, ",") : formulas[0]!;
    return {
      type,
      operator: LEGACY_OPERATORS[(flags >>> 20) & 0x0f] ?? "between",
      sqref: ranges.join(" "),
      formula1,
      formula2: formulas[1]!,
      ...(flags & 0x40000 && strings[2] ? { prompt: strings[2] } : {}),
    };
  };
  const locked: boolean[] = [];
  let sheet: LegacySheet | undefined;
  // Embedded charts are substreams of their own, BOF to EOF, inside a sheet's records.
  let nested = 0;
  const unlock = (row: number, col: number, xf: number) => {
    if (sheet && locked[xf] === false) sheet.unlocked.add(`${row}:${col}`);
  };
  for (const [offset, type, body, size] of records) {
    if (type === 0x0809) {
      const name = sheetAt.get(offset);
      if (name === undefined) {
        if (sheet) nested++;
        continue;
      }
      sheet = {
        tables: [],
        protected: false,
        unlocked: new Set(),
        validations: [],
        iterate: { on: false, count: 100, delta: 0.001 },
      };
      out.set(name, sheet);
      continue;
    }
    if (nested) {
      if (type === 0x000a) nested--;
      continue;
    }
    if (type === 0x000a) {
      sheet = undefined;
      continue;
    }
    if (type === 0x00e0 && size >= 6) locked.push((view.getUint16(body + 4, true) & 1) === 1);
    if (!sheet) continue;
    if (type === 0x0012 && size >= 2) sheet.protected = view.getUint16(body, true) === 1;
    else if (type === 0x0011 && size >= 2) sheet.iterate.on = view.getUint16(body, true) === 1;
    else if (type === 0x000c && size >= 2) sheet.iterate.count = view.getUint16(body, true);
    else if (type === 0x0010 && size >= 8) sheet.iterate.delta = view.getFloat64(body, true);
    else if ([0x0006, 0x0203, 0x027e, 0x00fd, 0x0204, 0x0201, 0x0205].includes(type) && size >= 6)
      unlock(
        view.getUint16(body, true),
        view.getUint16(body + 2, true),
        view.getUint16(body + 4, true),
      );
    else if ((type === 0x00bd || type === 0x00be) && size >= 6) {
      const row = view.getUint16(body, true);
      const first = view.getUint16(body + 2, true);
      const step = type === 0x00bd ? 6 : 2;
      const count = (size - 6) / step;
      for (let n = 0; n < count; n++)
        unlock(row, first + n, view.getUint16(body + 4 + n * step, true));
    } else if (type === 0x01be && size >= 20) {
      const rule = validation(body, size);
      if (rule) sheet.validations.push(rule);
    }
    if (type !== 0x0236 || size < 16) continue;
    const cell = (r: number, c: number) => `$${columnLetters(c)}$${r + 1}`;
    const flags = data[body + 6]!;
    const first =
      (flags & 0x10) !== 0
        ? "#REF!"
        : cell(view.getUint16(body + 8, true), view.getUint16(body + 10, true));
    const second =
      (flags & 0x20) !== 0
        ? "#REF!"
        : cell(view.getUint16(body + 12, true), view.getUint16(body + 14, true));
    const args = flags & 0x08 ? `${first},${second}` : flags & 0x04 ? `${first},` : `,${first}`;
    sheet.tables.push({
      r1: view.getUint16(body, true),
      r2: view.getUint16(body + 2, true),
      c1: data[body + 4]!,
      c2: data[body + 5]!,
      args,
    });
  }
  return out;
}

/**
 * Names a legacy workbook could use that are cell addresses in today's larger grid (DIA2 was a name
 * when the last column was IV). Excel renames them with a leading underscore when it opens the file.
 */
function legacyNameClashes(names: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of names) {
    const m = /^([A-Za-z]{1,3})(\d+)$/.exec(name);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 1048576) continue;
    const col = m[1]!
      .toUpperCase()
      .split("")
      .reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    if (col <= 16384) out.set(name.toLowerCase(), `_${name}`);
  }
  return out;
}

/** A formula with renamed names replaced, leaving text in quotes and sheet names alone. */
function renameIn(formula: string, renamed: Map<string, string>): string {
  if (!renamed.size) return formula;
  return formula
    .split(/("(?:[^"]|"")*"|'(?:[^']|'')*')/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(
            /(?<![A-Za-z0-9_.$!\\])([A-Za-z]{1,3}\d+)(?![A-Za-z0-9_.(!:])/g,
            (word: string) => renamed.get(word.toLowerCase()) ?? word,
          ),
    )
    .join("");
}

function dateSerial(date: Date): number {
  const day = serialFromDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  const time =
    (date.getUTCHours() * 3600 +
      date.getUTCMinutes() * 60 +
      date.getUTCSeconds() +
      date.getUTCMilliseconds() / 1000) /
    86400;
  return day + time;
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
