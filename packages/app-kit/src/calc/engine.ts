import { exp, log, multiply } from "./exact.js";
import { ELEMENTWISE } from "./functions/helpers.js";
import type { Fn } from "./functions/index.js";
import { FUNCTIONS } from "./functions/index.js";
import type { CalcModel, CellValueJson } from "./model.js";
import { parseAddress } from "./model.js";
import type { Node, RefNode } from "./parse.js";
import { MAX_COL, MAX_ROW, parseFormula } from "./parse.js";
import { printFormula } from "./print.js";
import type { Area, Scalar, Value } from "./values.js";
import {
  addAdjusted,
  CALC,
  compare,
  DIV0,
  isError,
  Lambda,
  Matrix,
  NA,
  NAME,
  NUM,
  REF,
  Ref,
  SPILL,
  setDateOrder,
  settle,
  toNumber,
  toText,
  VALUE,
  XlError,
} from "./values.js";

/**
 * Calculates a compiled workbook the way Excel does: every formula in dependency order, ranges and
 * names resolved as Excel resolves them, array formulas over their ranges, dynamic arrays spilled,
 * circular references either iterated (when the workbook asks for it) or reported. Calculation is
 * a pure function of the model, the inputs and the `now` it is given, so the same inputs always
 * give the same results.
 */

type Cell = {
  value: Scalar;
  /** Parsed formula and the cell it was written in, for shifting relative references. */
  formula?: { node: Node; row: number; col: number; index: number };
  /** Top-left of the array formula this cell belongs to, and that formula's range. */
  array?: { row: number; col: number; r2: number; c2: number; dynamic: boolean };
  /** This cell holds a spilled value from another cell's dynamic array. */
  spilledFrom?: number;
  state?: "pending" | "busy" | "done";
  /** The value Excel saved, for formula and spilled cells; replay reads it instead of calculating. */
  saved?: Scalar;
};

const CURRENT_RULES = 16;

const isDataTable = (node: Node) => node.k === "fn" && node.name === "TABLE";

export type CalcOptions = {
  /** Excel serial date-time used by TODAY() and NOW(); defaults to the clock. */
  now?: number;
  /** Seed for RAND(), so a calculation can be repeated exactly. */
  seed?: number;
  /**
   * Calculate each formula from the results Excel saved for the cells it reads, instead of from
   * this engine's own results: checks every formula on its own, free of rounding passed down.
   */
  replay?: boolean;
  /**
   * The Excel version whose function rules to follow, for checking results an older version saved
   * (12 is Excel 2007). Left out, the current rules apply.
   */
  rules?: number;
};

export type Context = {
  engine: Engine;
  sheet: number;
  row: number;
  col: number;
  /** Evaluating as an array formula: ranges become arrays instead of intersecting. */
  array: boolean;
  /** Names bound by LET, which hide workbook names of the same spelling. */
  locals?: Map<string, Value>;
  /**
   * The size of the array formula range being filled. Element-wise steps index their arguments
   * across all of it, so cells beyond a shorter range see #N/A (ISNA of them is TRUE).
   */
  extent?: { rows: number; cols: number };
};

const key = (row: number, col: number) => row * 16384 + col;

const within = (area: Area, sheet: number, row: number, col: number) =>
  area.sheet === sheet && row >= area.r1 && row <= area.r2 && col >= area.c1 && col <= area.c2;
export function fromJson(value: CellValueJson | undefined): Scalar {
  if (value === undefined || value === null) return null;
  if (typeof value === "object") return XlError.of(value.e);
  return value;
}

export function toJson(value: Scalar): CellValueJson {
  if (value instanceof XlError) return { e: value.code };
  return value;
}

class Sheet {
  readonly cells = new Map<number, Cell>();
  /** Rows holding something, per column, sorted; rebuilt when a cell appears or empties. */
  private columns: Map<number, number[]> | null = null;
  private formulaColumns: Map<number, number[]> | null = null;
  maxRow = 0;
  maxCol = 0;
  constructor(readonly name: string) {}

  invalidate() {
    this.columns = null;
    this.formulaColumns = null;
  }

  private index(formulasOnly: boolean): Map<number, number[]> {
    const cached = formulasOnly ? this.formulaColumns : this.columns;
    if (cached) return cached;
    const map = new Map<number, number[]>();
    for (const [k, cell] of this.cells) {
      if (
        formulasOnly
          ? !cell.formula && !cell.array && cell.spilledFrom === undefined
          : cell.value === null && !cell.formula && cell.spilledFrom === undefined
      )
        continue;
      const col = k % 16384;
      const row = (k - col) / 16384;
      let rows = map.get(col);
      if (!rows) {
        rows = [];
        map.set(col, rows);
      }
      rows.push(row);
    }
    for (const rows of map.values()) rows.sort((a, b) => a - b);
    if (formulasOnly) this.formulaColumns = map;
    else this.columns = map;
    return map;
  }

  /** Cells inside an area that hold a value or formula, in column-then-row order. */
  *occupied(area: Area, formulasOnly = false): Generator<[number, number]> {
    const map = this.index(formulasOnly);
    const cols =
      area.c2 - area.c1 > map.size
        ? [...map.keys()].filter((c) => c >= area.c1 && c <= area.c2).sort((a, b) => a - b)
        : range(area.c1, area.c2).filter((c) => map.has(c));
    for (const col of cols) {
      const rows = map.get(col)!;
      let lo = 0;
      let hi = rows.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid]! < area.r1) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < rows.length && rows[i]! <= area.r2; i++) yield [rows[i]!, col];
    }
  }
}

const range = (from: number, to: number) => {
  const out: number[] = [];
  for (let n = from; n <= to; n++) out.push(n);
  return out;
};

export class Engine {
  readonly sheets: Sheet[];
  private readonly sheetByName = new Map<string, number>();
  private readonly names = new Map<string, { node: Node; sheet: number }>();
  private readonly externals: Map<string, Scalar>;
  private readonly formulaNodes: Node[];
  private order: Array<[number, number]> = [];
  private cyclic = new Set<string>();
  /** With iteration off: cells found in a loop during this calculation, the cells being calculated, and their values before it. */
  private loops: Set<string> | undefined;
  private walking: string[] = [];
  private prior = new Map<string, Scalar>();
  private random: () => number = Math.random;
  now = 0;
  /** See `CalcOptions.rules`. */
  rules = CURRENT_RULES;
  /** Functions the formulas call that the library does not have. */
  readonly missingFunctions = new Set<string>();
  /** Problems found while parsing, by cell. */
  readonly parseErrors: Array<{ sheet: number; row: number; col: number; message: string }> = [];
  depth = 0;
  private replaying = false;

  constructor(readonly model: CalcModel) {
    this.sheets = model.sheets.map((sheet) => new Sheet(sheet.name));
    model.sheets.forEach((sheet, index) => {
      this.sheetByName.set(sheet.name.toLowerCase(), index);
    });
    this.externals = new Map(
      Object.entries(model.externals ?? {}).map(([k, v]) => [k.toLowerCase(), fromJson(v)]),
    );
    this.formulaNodes = model.formulas.map((formula) => {
      try {
        return parseFormula(formula.text, {
          row: formula.row,
          col: formula.col,
          sheetIndex: (name) => this.sheetIndex(name),
        });
      } catch (error) {
        return { k: "err", v: "#NAME?", message: String(error) } as unknown as Node;
      }
    });
    for (const name of model.names) {
      try {
        const node = parseFormula(name.formula, {
          row: 0,
          col: 0,
          sheetIndex: (n) => this.sheetIndex(n),
        });
        this.names.set(nameKey(name.name, name.sheet ?? -1), { node, sheet: name.sheet ?? -1 });
      } catch {
        this.names.set(nameKey(name.name, name.sheet ?? -1), {
          node: { k: "err", v: "#NAME?" },
          sheet: name.sheet ?? -1,
        });
      }
    }
    model.sheets.forEach((spec, index) => {
      const sheet = this.sheets[index]!;
      sheet.maxRow = spec.rows;
      sheet.maxCol = spec.cols;
      for (const [row, col, cell] of spec.cells) {
        const entry: Cell = { value: fromJson(cell.v) };
        if (cell.f !== undefined) {
          entry.saved = entry.value;
          const formula = model.formulas[cell.f]!;
          entry.formula = {
            node: this.formulaNodes[cell.f]!,
            row: formula.row,
            col: formula.col,
            index: cell.f,
          };
          if (cell.a) {
            entry.array = { row, col, r2: cell.a[0], c2: cell.a[1], dynamic: !!cell.d };
          }
        }
        sheet.cells.set(key(row, col), entry);
      }
      // Cells inside an array formula's range belong to it.
      for (const [row, col, cell] of spec.cells) {
        if (!cell.a) continue;
        const master = sheet.cells.get(key(row, col))!;
        for (let r = row; r <= cell.a[0]; r++) {
          for (let c = col; c <= cell.a[1]; c++) {
            if (r === row && c === col) continue;
            const existing = sheet.cells.get(key(r, c));
            if (existing) {
              existing.spilledFrom = key(row, col);
              existing.saved = existing.value;
            } else
              sheet.cells.set(key(r, c), { value: null, spilledFrom: key(row, col), saved: null });
          }
        }
        void master;
      }
    });
    for (const node of this.formulaNodes) this.collectFunctions(node);
    this.buildOrder();
  }

  sheetIndex(name: string): number {
    return this.sheetByName.get(name.toLowerCase()) ?? -1;
  }

  private collectFunctions(node: Node, bound = new Set<string>()) {
    switch (node.k) {
      case "fn": {
        const name = node.name.toLowerCase();
        const local =
          bound.has(name) ||
          [...this.names.keys()].some((k) => k.slice(k.indexOf(":") + 1) === name);
        if (!FUNCTIONS[node.name] && !local) this.missingFunctions.add(node.name);
        // LET names and LAMBDA parameters may be called like functions in what follows them.
        const binds = node.name === "LET" || node.name === "LAMBDA";
        const inner = binds ? new Set(bound) : bound;
        node.args.forEach((arg, i) => {
          if (
            binds &&
            arg.k === "name" &&
            (node.name === "LAMBDA" ? i < node.args.length - 1 : i % 2 === 0)
          )
            inner.add(arg.name.toLowerCase());
          this.collectFunctions(arg, inner);
        });
        break;
      }
      case "bin":
        this.collectFunctions(node.a, bound);
        this.collectFunctions(node.b, bound);
        break;
      case "un":
      case "inarray":
        this.collectFunctions(node.a, bound);
        break;
      case "err":
        if ((node as { message?: string }).message)
          this.missingFunctions.add("(unreadable formula)");
        break;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Dependency order

  /** Formula cells a formula reads, as far as can be known without calculating. */
  private precedents(
    sheet: number,
    row: number,
    col: number,
    node: Node,
    out: Array<[number, number, number]>,
    seen = new Set<string>(),
  ) {
    switch (node.k) {
      case "ref": {
        const area = this.area(node, sheet, row, col);
        if (!area) return;
        const last = node.sheet2 ?? area.sheet;
        for (let s = area.sheet; s <= last; s++) {
          const target = this.sheets[s];
          if (!target) continue;
          for (const [r, c] of target.occupied({ ...area, sheet: s }, true)) out.push([s, r, c]);
        }
        return;
      }
      case "name": {
        const name = this.lookupName(node.name, node.sheet === -1 ? sheet : node.sheet);
        if (name && !seen.has(node.name.toLowerCase())) {
          seen.add(node.name.toLowerCase());
          this.precedents(name.sheet >= 0 ? name.sheet : sheet, row, col, name.node, out, seen);
        }
        return;
      }
      case "table": {
        const ref = this.tableRef(node, sheet, row);
        if (ref instanceof Ref) {
          for (const area of ref.areas)
            for (const [r, c] of this.sheets[area.sheet]!.occupied(area, true))
              out.push([area.sheet, r, c]);
        }
        return;
      }
      case "fn":
        for (const arg of node.args) this.precedents(sheet, row, col, arg, out, seen);
        return;
      case "bin":
        this.precedents(sheet, row, col, node.a, out, seen);
        this.precedents(sheet, row, col, node.b, out, seen);
        return;
      case "un":
      case "inarray":
        this.precedents(sheet, row, col, node.a, out, seen);
        return;
    }
  }

  /** Tarjan's algorithm without recursion: formula cells in an order where each follows what it reads. */
  private buildOrder() {
    const ids = new Map<string, number>();
    const cells: Array<[number, number, number]> = [];
    this.sheets.forEach((sheet, s) => {
      for (const [k, cell] of sheet.cells) {
        if (!cell.formula) continue;
        const col = k % 16384;
        const row = (k - col) / 16384;
        ids.set(`${s}:${k}`, cells.length);
        cells.push([s, row, col]);
      }
    });
    const edges: number[][] = cells.map(([s, row, col]) => {
      const cell = this.sheets[s]!.cells.get(key(row, col))!;
      const found: Array<[number, number, number]> = [];
      this.precedents(s, row, col, cell.formula!.node, found);
      if (cell.array && isDataTable(cell.formula!.node))
        found.push(...this.tableEdges(s, cell.array));
      const out = new Set<number>();
      for (const [ps, pr, pc] of found) {
        const target = this.sheets[ps]!.cells.get(key(pr, pc));
        const masterKey = target?.spilledFrom ?? key(pr, pc);
        const id = ids.get(`${ps}:${masterKey}`);
        if (id !== undefined) out.add(id);
      }
      return [...out];
    });
    this.graph = { ids, cells, edges };
    const index = new Array<number>(cells.length).fill(-1);
    const low = new Array<number>(cells.length).fill(0);
    const onStack = new Array<boolean>(cells.length).fill(false);
    const stack: number[] = [];
    const order: number[] = [];
    let counter = 0;
    for (let start = 0; start < cells.length; start++) {
      if (index[start] !== -1) continue;
      const work: Array<[number, number]> = [[start, 0]];
      while (work.length) {
        const frame = work[work.length - 1]!;
        const [v, i] = frame;
        if (i === 0) {
          index[v] = low[v] = counter++;
          stack.push(v);
          onStack[v] = true;
        }
        const next = edges[v]!;
        if (i < next.length) {
          frame[1] = i + 1;
          const w = next[i]!;
          if (index[w] === -1) work.push([w, 0]);
          else if (onStack[w]) low[v] = Math.min(low[v]!, index[w]!);
          continue;
        }
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1]![0];
          low[parent] = Math.min(low[parent]!, low[v]!);
        }
        if (low[v] === index[v]) {
          const component: number[] = [];
          let w: number;
          do {
            w = stack.pop()!;
            onStack[w] = false;
            component.push(w);
          } while (w !== v);
          const selfLoop = component.length === 1 && edges[v]!.includes(v);
          if (component.length > 1 || selfLoop) {
            for (const id of component) {
              const [s, r, c] = cells[id]!;
              this.cyclic.add(`${s}:${key(r, c)}`);
            }
          }
          component.sort((a, b) => a - b);
          order.push(...component);
        }
      }
    }
    this.order = order.map((id) => {
      const [s, r, c] = cells[id]!;
      return [s, key(r, c)];
    });
  }

  private graph: {
    ids: Map<string, number>;
    cells: Array<[number, number, number]>;
    edges: number[][];
  } = {
    ids: new Map(),
    cells: [],
    edges: [],
  };

  /** Formula cells whose result depends, directly or through others, on any of the given cells. */
  dependentsOf(seeds: Array<[number, number, number]>): Array<[number, number, number]> {
    const { ids, cells, edges } = this.graph;
    const reverse: number[][] = cells.map(() => []);
    edges.forEach((targets, from) => {
      for (const to of targets) reverse[to]!.push(from);
    });
    const seen = new Set<number>();
    const queue: number[] = [];
    for (const [s, r, c] of seeds) {
      const id = ids.get(`${s}:${key(r, c)}`);
      if (id !== undefined && !seen.has(id)) {
        seen.add(id);
        queue.push(id);
      }
    }
    while (queue.length) {
      const id = queue.pop()!;
      for (const next of reverse[id]!) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return [...seen].map((id) => cells[id]!);
  }

  /** Formula cells a formula cell reads directly (as far as is known without calculating). */
  directPrecedents(s: number, row: number, col: number): Array<[number, number, number]> {
    const id = this.graph.ids.get(`${s}:${key(row, col)}`);
    if (id === undefined) return [];
    return this.graph.edges[id]!.map((other) => this.graph.cells[other]!);
  }

  formulaNode(index: number): Node {
    return this.formulaNodes[index]!;
  }

  /** The formula held in a cell, if any. */
  formulaIn(sheet: number, row: number, col: number): Node | undefined {
    return this.sheets[sheet]?.cells.get(key(row, col))?.formula?.node;
  }

  /** Cells in circular references, as "Sheet!A1". */
  get circular(): string[] {
    return [...this.cyclic].map((id) => {
      const [s, k] = id.split(":").map(Number) as [number, number];
      const col = k % 16384;
      return `${this.sheets[s]!.name}!${colName(col)}${(k - col) / 16384 + 1}`;
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Inputs and calculation

  /** Changes a cell's constant value; formulas are calculated again on the next `calculate`. */
  set(sheet: number, row: number, col: number, value: Scalar) {
    const target = this.sheets[sheet];
    if (!target) throw new Error(`There is no sheet ${sheet}.`);
    const k = key(row, col);
    const cell = target.cells.get(k);
    if (cell?.formula) throw new Error(`${target.name}!${colName(col)}${row + 1} holds a formula.`);
    if (cell) {
      if ((cell.value === null) !== (value === null)) target.invalidate();
      cell.value = value;
    } else {
      target.cells.set(k, { value });
      target.invalidate();
      target.maxRow = Math.max(target.maxRow, row);
      target.maxCol = Math.max(target.maxCol, col);
    }
  }

  setByAddress(text: string, value: Scalar) {
    const at = parseAddress(text, (name) => this.sheetIndex(name));
    if (!at) throw new Error(`"${text}" is not a cell address.`);
    this.set(at.sheet, at.row, at.col, value);
  }

  calculate(options: CalcOptions = {}) {
    setDateOrder(this.model.dateOrder ?? "mdy");
    this.replaying = !!options.replay;
    this.rules = options.rules ?? CURRENT_RULES;
    this.now = options.now ?? currentSerial();
    this.random = seeded(options.seed ?? 1);
    for (const id of this.valueScopes) this.tableScopes.delete(id);
    this.valueScopes.clear();
    this.loops = this.model.iterationOff ? new Set() : undefined;
    this.walking = [];
    this.prior.clear();
    this.sheets.forEach((sheet, s) => {
      for (const [k, cell] of sheet.cells) {
        if (cell.formula) cell.state = "pending";
        if (cell.spilledFrom !== undefined && !cell.formula) {
          if (this.loops && cell.value !== null) this.prior.set(`${s}:${k}`, cell.value);
          cell.value = null;
        }
      }
    });
    const iterate = this.model.iterate;
    for (const [s, k] of this.order) {
      const cell = this.sheets[s]!.cells.get(k)!;
      if (cell.state !== "pending") continue;
      if (this.cyclic.has(`${s}:${k}`) && iterate) continue;
      this.evaluateCell(s, k, cell);
    }
    if (iterate && this.cyclic.size) this.iterateCycles(iterate);
    if (this.loops?.size) this.keepCircularValues(this.loops);
    this.loops = undefined;
    this.prior.clear();
  }

  /**
   * Excel without iteration does not calculate a circular reference that calculation actually
   * walks round, nor anything that reads it: those cells keep the values they had.
   */
  private keepCircularValues(loops: Set<string>) {
    for (const name of this.cyclesAndDependents(loops)) {
      const [s, k] = name.split(":").map(Number) as [number, number];
      const sheet = this.sheets[s]!;
      const cell = sheet.cells.get(k);
      if (!cell?.formula) continue;
      cell.value = this.prior.has(name) ? this.prior.get(name)! : 0;
      if (cell.value === null) cell.value = 0;
      if (!cell.array) continue;
      for (const [other, member] of sheet.cells)
        if (member.spilledFrom === k && !member.formula)
          member.value = this.prior.get(`${s}:${other}`) ?? null;
    }
  }

  /** A data table reads the row above it and the column to its left: substitution values and formulas. */
  private tableEdges(
    s: number,
    a: { row: number; col: number; r2: number; c2: number },
  ): Array<[number, number, number]> {
    const out: Array<[number, number, number]> = [];
    for (let c = a.col - 1; c <= a.c2; c++) if (a.row > 0 && c >= 0) out.push([s, a.row - 1, c]);
    for (let r = a.row; r <= a.r2; r++) if (a.col > 0) out.push([s, r, a.col - 1]);
    return out;
  }

  private tableScopes = new Map<string, Array<[number, number, Cell]>>();
  /** Data tables whose scope follows what INDIRECT or OFFSET read, so is redone each calculation. */
  private valueScopes = new Set<string>();

  /**
   * A what-if data table, {=TABLE(row_input, column_input)} over the result cells: each result is
   * a formula on the table's edge, calculated again with the input cell holding a value from the
   * other edge. Only the cells between the input and those formulas are recalculated, and they are
   * put back afterwards, so the rest of the workbook never sees the substituted values.
   */
  dataTable(ctx: Context, rowArg: Node | undefined, colArg: Node | undefined): Value {
    const s = ctx.sheet;
    const sheet = this.sheets[s]!;
    const master = sheet.cells.get(key(ctx.row, ctx.col));
    const a = master?.array;
    if (!a || a.row < 1 || a.col < 1) return REF;
    const inputOf = (arg: Node | undefined): [number, number, number] | null => {
      if (arg?.k !== "ref") return null;
      const area = this.area(arg, s, ctx.row, ctx.col);
      return area ? [area.sheet, area.r1, area.c1] : null;
    };
    const rowInput = inputOf(rowArg);
    const colInput = inputOf(colArg);
    if (!rowInput && !colInput) return REF;
    const rows = a.r2 - a.row + 1;
    const cols = a.c2 - a.col + 1;
    const two = !!rowInput && !!colInput;
    const formulaAt = (i: number, j: number): [number, number] =>
      two ? [a.row - 1, a.col - 1] : colInput ? [a.row - 1, a.col + j] : [a.row + i, a.col - 1];
    const formulas: Array<[number, number, number]> = [];
    if (two) formulas.push([s, a.row - 1, a.col - 1]);
    else if (colInput) for (let j = 0; j < cols; j++) formulas.push([s, a.row - 1, a.col + j]);
    else for (let i = 0; i < rows; i++) formulas.push([s, a.row + i, a.col - 1]);
    const inputs = [rowInput, colInput].filter((x): x is [number, number, number] => !!x);
    const id = `${s}:${key(ctx.row, ctx.col)}`;
    let scope = this.tableScopes.get(id);
    if (!scope) {
      const found = this.tableScope(formulas, inputs);
      scope = found.scope;
      this.tableScopes.set(id, scope);
      if (found.byValue) this.valueScopes.add(id);
    }
    // Substitution values first, as the workbook stands.
    const rowValues = rowInput
      ? Array.from({ length: cols }, (_, j) => this.cellValue(s, a.row - 1, a.col + j))
      : [];
    const colValues = colInput
      ? Array.from({ length: rows }, (_, i) => this.cellValue(s, a.row + i, a.col - 1))
      : [];
    for (const [fs, fr, fc] of formulas) this.cellValue(fs, fr, fc);
    const kept = scope.map(([, , cell]) => [cell.value, cell.state] as const);
    const anchors = new Set(
      scope.filter(([, , cell]) => cell.array).map(([cs, k]) => `${cs}:${k}`),
    );
    const results: Array<{ sheet: number; k: number; cell: Cell; value: Scalar }> = [];
    if (anchors.size)
      this.sheets.forEach((sheet, cs) => {
        for (const [k, cell] of sheet.cells)
          if (cell.spilledFrom !== undefined && anchors.has(`${cs}:${cell.spilledFrom}`))
            results.push({ sheet: cs, k, cell, value: cell.value });
      });
    const inputCells = inputs.map(([is, ir, ic]) => {
      const k = key(ir, ic);
      let cell = this.sheets[is]!.cells.get(k);
      const created = !cell;
      if (!cell) {
        cell = { value: null };
        this.sheets[is]!.cells.set(k, cell);
      }
      return { is, k, cell, created, value: cell.value, state: cell.state };
    });
    const replaying = this.replaying;
    this.replaying = false;
    const out: Scalar[] = new Array(rows * cols);
    try {
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const subs = two
            ? [rowValues[j]!, colValues[i]!]
            : [rowInput ? rowValues[j]! : colValues[i]!];
          inputCells.forEach((input, n) => {
            input.cell.value = subs[n] ?? null;
            if (input.cell.formula) input.cell.state = "done";
          });
          for (const [, , cell] of scope) if (cell.formula) cell.state = "pending";
          const [fr, fc] = formulaAt(i, j);
          out[i * cols + j] = this.cellValue(s, fr, fc);
        }
      }
    } finally {
      this.replaying = replaying;
      scope.forEach(([, , cell], n) => {
        cell.value = kept[n]![0];
        cell.state = kept[n]![1];
      });
      if (anchors.size) {
        this.sheets.forEach((sheet, cs) => {
          for (const [k, cell] of sheet.cells)
            if (
              cell.spilledFrom !== undefined &&
              !cell.formula &&
              anchors.has(`${cs}:${cell.spilledFrom}`)
            )
              sheet.cells.delete(k);
        });
        for (const { sheet, k, cell, value } of results) {
          cell.value = value;
          this.sheets[sheet]!.cells.set(k, cell);
        }
        for (const sheet of this.sheets) sheet.invalidate();
      }
      for (const input of inputCells) {
        if (input.created) this.sheets[input.is]!.cells.delete(input.k);
        else {
          input.cell.value = input.value;
          input.cell.state = input.state;
        }
      }
    }
    return new Matrix(rows, cols, out);
  }

  /** The formula cells between a data table's input cells and its formulas, in calculation order. */
  private tableScope(
    formulas: Array<[number, number, number]>,
    inputs: Array<[number, number, number]>,
  ): { scope: Array<[number, number, Cell]>; byValue: boolean } {
    const { ids, cells, edges } = this.graph;
    const closure = this.precedentClosure(formulas);
    const indirect = closure.some(([s, r, c]) =>
      this.readsIndirectly(s, this.sheets[s]!.cells.get(key(r, c))!.formula!.node, new Set()),
    );
    const reach = new Set(
      indirect
        ? cells.map((_, id) => id)
        : closure.map(([s, r, c]) => ids.get(`${s}:${key(r, c)}`)!),
    );
    const isInput = new Set(inputs.map(([s, r, c]) => `${s}:${key(r, c)}`));
    const affected = new Set<number>();
    // What INDIRECT or OFFSET reads now, when nothing it is given moves with the inputs.
    let byValue = false;
    const moves = (area: Area): boolean => {
      byValue = true;
      if (inputs.some(([s, r, c]) => within(area, s, r, c))) return true;
      const sheet = this.sheets[area.sheet];
      if (!sheet) return false;
      for (const [r, c] of sheet.occupied(area, true)) {
        const cell = sheet.cells.get(key(r, c));
        const id = ids.get(`${area.sheet}:${cell?.spilledFrom ?? key(r, c)}`);
        if (id !== undefined && affected.has(id)) return true;
      }
      return false;
    };
    // Repeated because cells read through INDIRECT or OFFSET can come later in the order.
    for (let changed = true; changed; ) {
      changed = false;
      for (const [s, k] of this.order) {
        const id = ids.get(`${s}:${k}`)!;
        if (!reach.has(id) || affected.has(id) || isInput.has(`${s}:${k}`)) continue;
        const [, row, col] = cells[id]!;
        if (
          edges[id]!.some(
            (other) =>
              affected.has(other) ||
              isInput.has(`${cells[other]![0]}:${key(cells[other]![1], cells[other]![2])}`),
          ) ||
          this.mentions(
            s,
            row,
            col,
            this.sheets[s]!.cells.get(k)!.formula!.node,
            inputs,
            new Set(),
            moves,
          )
        ) {
          affected.add(id);
          changed = true;
        }
      }
    }
    const scope = [...affected].map((id): [number, number, Cell] => {
      const [s, r, c] = cells[id]!;
      return [s, key(r, c), this.sheets[s]!.cells.get(key(r, c))!];
    });
    return { scope, byValue };
  }

  /** Whether a formula reads cells chosen while calculating, so its precedents cannot be listed. */
  private readsIndirectly(sheet: number, node: Node, seen: Set<string>): boolean {
    switch (node.k) {
      case "name": {
        const name = this.lookupName(node.name, node.sheet === -1 ? sheet : node.sheet);
        if (!name || seen.has(node.name.toLowerCase())) return false;
        seen.add(node.name.toLowerCase());
        return this.readsIndirectly(name.sheet >= 0 ? name.sheet : sheet, name.node, seen);
      }
      case "fn":
        return (
          node.name === "INDIRECT" ||
          node.name === "OFFSET" ||
          node.args.some((arg) => this.readsIndirectly(sheet, arg, seen))
        );
      case "bin":
        return (
          this.readsIndirectly(sheet, node.a, seen) || this.readsIndirectly(sheet, node.b, seen)
        );
      case "un":
      case "inarray":
        return this.readsIndirectly(sheet, node.a, seen);
      default:
        return false;
    }
  }

  /**
   * Whether a formula refers to any of the cells, or could through INDIRECT or OFFSET. With
   * `moves`, one whose arguments do not refer to them is judged by the range it reads now.
   */
  private mentions(
    sheet: number,
    row: number,
    col: number,
    node: Node,
    cells: Array<[number, number, number]>,
    seen: Set<string>,
    moves?: (area: Area) => boolean,
  ): boolean {
    switch (node.k) {
      case "ref": {
        const area = this.area(node, sheet, row, col);
        if (!area) return false;
        const last = node.sheet2 ?? area.sheet;
        return cells.some(
          ([s, r, c]) =>
            s >= area.sheet &&
            s <= last &&
            r >= area.r1 &&
            r <= area.r2 &&
            c >= area.c1 &&
            c <= area.c2,
        );
      }
      case "name": {
        const name = this.lookupName(node.name, node.sheet === -1 ? sheet : node.sheet);
        if (!name || seen.has(node.name.toLowerCase())) return false;
        seen.add(node.name.toLowerCase());
        return this.mentions(
          name.sheet >= 0 ? name.sheet : sheet,
          row,
          col,
          name.node,
          cells,
          seen,
          moves,
        );
      }
      case "table": {
        const ref = this.tableRef(node, sheet, row);
        return (
          ref instanceof Ref &&
          ref.areas.some((area) =>
            cells.some(
              ([s, r, c]) =>
                s === area.sheet && r >= area.r1 && r <= area.r2 && c >= area.c1 && c <= area.c2,
            ),
          )
        );
      }
      case "fn": {
        if (node.args.some((arg) => this.mentions(sheet, row, col, arg, cells, seen, moves)))
          return true;
        if (node.name !== "INDIRECT" && node.name !== "OFFSET") return false;
        if (!moves) return true;
        const target = this.evaluate(node, { engine: this, sheet, row, col, array: false });
        return !(target instanceof Ref) || target.areas.some(moves);
      }
      case "bin":
        return (
          this.mentions(sheet, row, col, node.a, cells, seen, moves) ||
          this.mentions(sheet, row, col, node.b, cells, seen, moves)
        );
      case "un":
      case "inarray":
        return this.mentions(sheet, row, col, node.a, cells, seen, moves);
      default:
        return false;
    }
  }

  /** Formula cells the given cells read, directly or through others, the given ones included. */
  private precedentClosure(
    seeds: Array<[number, number, number]>,
  ): Array<[number, number, number]> {
    const { ids, cells, edges } = this.graph;
    const seen = new Set<number>();
    const queue: number[] = [];
    for (const [s, r, c] of seeds) {
      const id = ids.get(`${s}:${key(r, c)}`);
      if (id !== undefined && !seen.has(id)) {
        seen.add(id);
        queue.push(id);
      }
    }
    while (queue.length) {
      for (const next of edges[queue.pop()!]!) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return [...seen].map((id) => cells[id]!);
  }

  /** The given formula cells and every formula that reads one, as "sheet:key". */
  private cyclesAndDependents(seeds: Set<string>): Set<string> {
    const out = new Set<string>(seeds);
    if (!this.graph) return out;
    const { ids, cells, edges } = this.graph;
    const readers: number[][] = cells.map(() => []);
    edges.forEach((precedents, id) => {
      for (const p of precedents) readers[p]!.push(id);
    });
    const queue: number[] = [];
    for (const name of seeds) {
      const id = ids.get(name);
      if (id !== undefined) queue.push(id);
    }
    while (queue.length) {
      for (const next of readers[queue.pop()!]!) {
        const [s, r, c] = cells[next]!;
        const name = `${s}:${key(r, c)}`;
        if (out.has(name)) continue;
        out.add(name);
        queue.push(next);
      }
    }
    return out;
  }

  /** Excel's iterative calculation: repeat the circular cells until they settle or run out of steps. */
  private iterateCycles(iterate: { count: number; delta: number }) {
    const ids = [...this.cyclic].map((id) => id.split(":").map(Number) as [number, number]);
    ids.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [s, k] of ids) {
      const cell = this.sheets[s]!.cells.get(k)!;
      if (typeof cell.value !== "number") cell.value = 0;
    }
    for (let step = 0; step < iterate.count; step++) {
      let change = 0;
      for (const [s, k] of ids) {
        const cell = this.sheets[s]!.cells.get(k)!;
        const before = cell.value;
        cell.state = "pending";
        this.evaluateCell(s, k, cell);
        if (typeof before === "number" && typeof cell.value === "number")
          change = Math.max(change, Math.abs(cell.value - before));
        else if (before !== cell.value) change = Infinity;
      }
      if (change < iterate.delta) break;
    }
  }

  /** Calculation reached a cell it is still calculating: every cell since then is in the loop. */
  private reentered(s: number, k: number) {
    const name = `${s}:${k}`;
    this.cyclic.add(name);
    if (!this.loops) return;
    const from = this.walking.lastIndexOf(name);
    if (from >= 0) for (const member of this.walking.slice(from)) this.loops.add(member);
  }

  private evaluateCell(s: number, k: number, cell: Cell) {
    if (cell.state === "done") return;
    if (cell.state === "busy") {
      this.reentered(s, k);
      return;
    }
    cell.state = "busy";
    if (this.loops) {
      const name = `${s}:${k}`;
      if (!this.prior.has(name)) this.prior.set(name, cell.value);
      this.walking.push(name);
    }
    const col = k % 16384;
    const row = (k - col) / 16384;
    const array = cell.array;
    const ctx: Context = { engine: this, sheet: s, row, col, array: !!array };
    if (array && !array.dynamic && (array.r2 > row || array.c2 > col))
      ctx.extent = { rows: array.r2 - row + 1, cols: array.c2 - col + 1 };
    let result: Value;
    this.depth++;
    try {
      if (this.depth > 4000) throw VALUE;
      result = this.evaluate(cell.formula!.node, ctx, true);
    } catch (error) {
      if (error instanceof XlError) result = error;
      else if (error instanceof RangeError) result = NUM;
      else throw error;
    } finally {
      this.depth--;
    }
    if (cell.array) this.spill(s, row, col, cell, result);
    else {
      // A formula that points at an empty cell shows 0, as in Excel.
      const value = settle(this.toScalar(result, ctx));
      cell.value = value === null ? 0 : value;
    }
    cell.state = "done";
    if (this.loops) this.walking.pop();
  }

  /** An array formula's result over its range, or a dynamic array's result over the cells it needs. */
  private spill(s: number, row: number, col: number, cell: Cell, result: Value) {
    const sheet = this.sheets[s]!;
    const ctx: Context = { engine: this, sheet: s, row, col, array: true };
    const matrix = this.toMatrix(result, ctx);
    const array = cell.array!;
    if (array.dynamic) {
      // Clear the old spill, then claim the new one unless something else sits in it.
      for (const [k, other] of sheet.cells)
        if (other.spilledFrom === key(row, col) && !other.formula) sheet.cells.delete(k);
      sheet.invalidate();
      for (let r = 0; r < matrix.rows; r++) {
        for (let c = 0; c < matrix.cols; c++) {
          if (r === 0 && c === 0) continue;
          const other = sheet.cells.get(key(row + r, col + c));
          if (
            other &&
            other.spilledFrom !== key(row, col) &&
            (other.formula || other.value !== null)
          ) {
            cell.value = SPILL;
            return;
          }
        }
      }
      for (let r = 0; r < matrix.rows; r++) {
        for (let c = 0; c < matrix.cols; c++) {
          const value = settle(matrix.get(r, c) ?? 0);
          if (r === 0 && c === 0) {
            cell.value = value === null ? 0 : value;
            continue;
          }
          const k = key(row + r, col + c);
          const other = sheet.cells.get(k);
          if (other) {
            other.value = value === null ? 0 : value;
            other.spilledFrom = key(row, col);
          } else
            sheet.cells.set(k, { value: value === null ? 0 : value, spilledFrom: key(row, col) });
        }
      }
      sheet.invalidate();
      return;
    }
    // A fixed array range: a single row or column repeats, anything short of the range is #N/A.
    let reindex = false;
    for (let r = row; r <= array.r2; r++) {
      for (let c = col; c <= array.c2; c++) {
        const mr = matrix.rows === 1 ? 0 : r - row;
        const mc = matrix.cols === 1 ? 0 : c - col;
        let value: Scalar = mr < matrix.rows && mc < matrix.cols ? matrix.get(mr, mc) : NA;
        if (value === null) value = 0;
        value = settle(value);
        if (r === row && c === col) cell.value = value;
        else {
          const other = sheet.cells.get(key(r, c));
          if (other) other.value = value;
          else {
            sheet.cells.set(key(r, c), { value, spilledFrom: key(row, col) });
            reindex = true;
          }
        }
      }
    }
    if (reindex) sheet.invalidate();
  }

  /** The value a cell holds, calculating it first if the calculation has not reached it yet. */
  cellValue(s: number, row: number, col: number): Scalar {
    const sheet = this.sheets[s];
    if (!sheet) return REF;
    const k = key(row, col);
    const cell = sheet.cells.get(k);
    if (!cell) return null;
    if (
      this.replaying &&
      cell.saved !== undefined &&
      (cell.formula || cell.spilledFrom !== undefined)
    )
      return cell.saved;
    if (cell.spilledFrom !== undefined && !cell.formula) {
      const master = sheet.cells.get(cell.spilledFrom);
      if (master?.state === "pending") this.evaluateCell(s, cell.spilledFrom, master);
      return cell.value;
    }
    if (cell.formula && cell.state === "pending") this.evaluateCell(s, k, cell);
    if (cell.formula && cell.state === "busy") {
      this.reentered(s, k);
      return typeof cell.value === "number" ? cell.value : 0;
    }
    return cell.value;
  }

  private externalRef(text: string, sheet: number, ctx: Context): Ref | null {
    const at = (part: string) => parseAddress(part.replace(/\$/g, ""), () => sheet, sheet);
    const [a, b] = text.split(":");
    const start = at(a ?? "");
    const end = b ? at(b) : start;
    void ctx;
    if (!start || !end) return null;
    return new Ref([
      {
        sheet,
        r1: Math.min(start.row, end.row),
        c1: Math.min(start.col, end.col),
        r2: Math.max(start.row, end.row),
        c2: Math.max(start.col, end.col),
      },
    ]);
  }

  /** Visits every reference a formula makes without calculating, following names. */
  private walkRefs(
    sheet: number,
    row: number,
    col: number,
    node: Node,
    visit: (area: Area, single: boolean) => void,
    seen = new Set<string>(),
  ) {
    switch (node.k) {
      case "ref": {
        const area = this.area(node, sheet, row, col);
        if (!area) return;
        const last = node.sheet2 ?? area.sheet;
        for (let s = area.sheet; s <= last; s++)
          visit(
            { ...area, sheet: s },
            area.r1 === area.r2 && area.c1 === area.c2 && node.span === undefined,
          );
        return;
      }
      case "name": {
        const key = node.name.toLowerCase();
        const name = this.lookupName(node.name, node.sheet === -1 ? sheet : node.sheet);
        if (name && !seen.has(key)) {
          seen.add(key);
          this.walkRefs(sheet, row, col, name.node, visit, seen);
        }
        return;
      }
      case "table": {
        const ref = this.tableRef(node, sheet, row);
        if (ref instanceof Ref) for (const area of ref.areas) visit(area, false);
        return;
      }
      case "fn":
        for (const arg of node.args) this.walkRefs(sheet, row, col, arg, visit, seen);
        return;
      case "bin":
        // A range built with ":" between two cells is a range, not two single cells.
        if (node.op === ":") {
          this.walkRefs(sheet, row, col, node.a, (area) => visit(area, false), seen);
          this.walkRefs(sheet, row, col, node.b, (area) => visit(area, false), seen);
          return;
        }
        this.walkRefs(sheet, row, col, node.a, visit, seen);
        this.walkRefs(sheet, row, col, node.b, visit, seen);
        return;
      case "un":
      case "inarray":
        this.walkRefs(sheet, row, col, node.a, visit, seen);
        return;
      case "array":
        return;
    }
  }

  private forEachFormula(fn: (sheet: number, row: number, col: number, node: Node) => void) {
    this.sheets.forEach((sheet, s) => {
      for (const [k, cell] of sheet.cells) {
        if (!cell.formula) continue;
        const col = k % 16384;
        fn(s, (k - col) / 16384, col, cell.formula.node);
      }
    });
  }

  /** Areas any formula refers to, by sheet. */
  referencedAreas(): Map<number, Area[]> {
    const out = new Map<number, Area[]>();
    const seen = new Set<string>();
    this.forEachFormula((s, row, col, node) =>
      this.walkRefs(s, row, col, node, (area) => {
        const id = `${area.sheet}:${area.r1}:${area.c1}:${area.r2}:${area.c2}`;
        if (seen.has(id)) return;
        seen.add(id);
        let list = out.get(area.sheet);
        if (!list) {
          list = [];
          out.set(area.sheet, list);
        }
        list.push(area);
      }),
    );
    return out;
  }

  /** Cells a formula on another cell reads on their own (not as part of a range), as "sheet:row:col" with a count. */
  singleCellReferences(): Map<string, number> {
    const out = new Map<string, number>();
    this.forEachFormula((s, row, col, node) =>
      this.walkRefs(s, row, col, node, (area, single) => {
        if (!single || (area.sheet === s && area.r1 === row && area.c1 === col)) return;
        const id = `${area.sheet}:${area.r1}:${area.c1}`;
        out.set(id, (out.get(id) ?? 0) + 1);
      }),
    );
    return out;
  }

  /** A formula calculated as if it were in the given cell, its result flattened row by row. */
  evaluateFormula(text: string, sheet: number, row: number, col: number): Scalar[] {
    const node = parseFormula(text.replace(/^=/, ""), {
      row,
      col,
      sheetIndex: (name) => this.sheetIndex(name),
    });
    const ctx: Context = { engine: this, sheet, row, col, array: true };
    const result = this.evaluate(node, ctx, true);
    return this.toMatrix(result, ctx).data;
  }

  /** CELL("filename"): the saved folder and book, then the sheet. */
  fileNameText(s: number): string {
    return `${this.model.source.bookPath ?? `[${this.model.source.fileName}]`}${this.model.sheets[s]?.name ?? ""}`;
  }

  /** CELL("address"): absolute, with the book and sheet when it is on another sheet. */
  addressText(s: number, row: number, col: number, otherSheet: boolean): string {
    const cell = `$${colName(col)}$${row + 1}`;
    if (!otherSheet) return cell;
    const book = (this.model.source.bookPath ?? `[${this.model.source.fileName}]`).replace(
      /^.*(?=\[)/,
      "",
    );
    const sheet = `${book}${this.model.sheets[s]?.name ?? ""}`;
    return `${/^[A-Za-z0-9_.[\]]+$/.test(sheet) ? sheet : `'${sheet.replace(/'/g, "''")}'`}!${cell}`;
  }

  /** A cell's formula as Excel's FORMULATEXT shows it, or null when the cell holds none. */
  formulaText(s: number, row: number, col: number): string | null {
    let cell = this.sheets[s]?.cells.get(key(row, col));
    if (cell && !cell.formula && cell.spilledFrom !== undefined) {
      const at = cell.spilledFrom;
      const anchor = this.sheets[s]!.cells.get(at);
      if (anchor?.array && !anchor.array.dynamic) {
        cell = anchor;
        col = at % 16384;
        row = (at - col) / 16384;
      }
    }
    if (!cell?.formula) return null;
    const node = this.formulaNodes[cell.formula.index]!;
    const source = this.model.formulas[cell.formula.index];
    const marked = cell.array ? node : markIntersections(node, false);
    // Excel shows the formula as typed; only the anchor cell's stored text has its own references.
    const own =
      marked === node &&
      source &&
      source.row === row &&
      source.col === col &&
      !source.text.startsWith("TABLE(")
        ? `=${source.text}`
        : printFormula(
            marked,
            row,
            col,
            this.model.sheets.map((sheet) => sheet.name),
          );
    const shown = displayFormula(own);
    const spills =
      (node.k === "ref" && (node.r1 !== node.r2 || node.c1 !== node.c2)) ||
      (node.k === "fn" && SPILLING.has(node.name));
    return spills && !cell.array ? `=@${shown.slice(1)}` : shown;
  }

  hasFormula(s: number, row: number, col: number): boolean {
    const cell = this.sheets[s]?.cells.get(key(row, col));
    return (
      !!cell &&
      (!!cell.formula ||
        (cell.spilledFrom !== undefined &&
          !!this.sheets[s]!.cells.get(cell.spilledFrom)?.array &&
          !this.sheets[s]!.cells.get(cell.spilledFrom)!.array!.dynamic))
    );
  }

  /** The range a dynamic array fills (A1#), or #REF! when the cell holds no dynamic array. */
  spillRef(s: number, row: number, col: number): Value {
    const sheet = this.sheets[s];
    const cell = sheet?.cells.get(key(row, col));
    if (!sheet || !cell?.formula) return REF;
    if (!cell.array) return new Ref([{ sheet: s, r1: row, c1: col, r2: row, c2: col }]);
    if (cell.state === "pending") this.evaluateCell(s, key(row, col), cell);
    if (!cell.array.dynamic)
      return new Ref([{ sheet: s, r1: row, c1: col, r2: cell.array.r2, c2: cell.array.c2 }]);
    if (cell.value instanceof XlError && cell.value.code === "#SPILL!") return REF;
    let r2 = row;
    let c2 = col;
    while (sheet.cells.get(key(r2 + 1, col))?.spilledFrom === key(row, col)) r2++;
    while (sheet.cells.get(key(row, c2 + 1))?.spilledFrom === key(row, col)) c2++;
    return new Ref([{ sheet: s, r1: row, c1: col, r2, c2 }]);
  }

  /** A cell's own calculated result, also in replay mode (where references read saved values). */
  result(s: number, row: number, col: number): Scalar {
    const replaying = this.replaying;
    this.replaying = false;
    try {
      const cell = this.sheets[s]?.cells.get(key(row, col));
      if (replaying && cell?.formula && cell.state === "pending") {
        this.replaying = true;
        this.evaluateCell(s, key(row, col), cell);
        this.replaying = false;
      }
      if (replaying && cell?.spilledFrom !== undefined && !cell.formula) {
        const master = this.sheets[s]!.cells.get(cell.spilledFrom);
        if (master?.state === "pending") {
          this.replaying = true;
          this.evaluateCell(s, cell.spilledFrom, master);
          this.replaying = false;
        }
        return cell.value;
      }
      return replaying ? (cell?.value ?? null) : this.cellValue(s, row, col);
    } finally {
      this.replaying = replaying;
    }
  }

  get(text: string): Scalar {
    const at = parseAddress(text, (name) => this.sheetIndex(name));
    if (!at) throw new Error(`"${text}" is not a cell address.`);
    return this.cellValue(at.sheet, at.row, at.col);
  }

  // ---------------------------------------------------------------------------------------------
  // Evaluation

  area(node: RefNode, sheet: number, row: number, col: number): Area | null {
    const s = node.sheet === -1 ? sheet : node.sheet;
    let r1 = node.ar1 ? node.r1 : row + node.r1;
    let r2 = node.ar2 ? node.r2 : row + node.r2;
    let c1 = node.ac1 ? node.c1 : col + node.c1;
    let c2 = node.ac2 ? node.c2 : col + node.c2;
    if (node.span === "cols") {
      r1 = 0;
      r2 = MAX_ROW;
    }
    if (node.span === "rows") {
      c1 = 0;
      c2 = MAX_COL;
    }
    if (
      r1 < 0 ||
      c1 < 0 ||
      r2 < 0 ||
      c2 < 0 ||
      r1 > MAX_ROW ||
      r2 > MAX_ROW ||
      c1 > MAX_COL ||
      c2 > MAX_COL
    )
      return null;
    return {
      sheet: s,
      r1: Math.min(r1, r2),
      r2: Math.max(r1, r2),
      c1: Math.min(c1, c2),
      c2: Math.max(c1, c2),
    };
  }

  private lookupName(name: string, sheet: number) {
    return this.names.get(nameKey(name, sheet)) ?? this.names.get(nameKey(name, -1));
  }

  evaluate(node: Node, ctx: Context, top = false): Value {
    switch (node.k) {
      case "num":
        return node.v;
      case "str":
        return node.v;
      case "bool":
        return node.v;
      case "err":
        return XlError.of(node.v);
      case "missing":
        return null;
      case "array":
        return Matrix.of(
          node.rows.map((row) => row.map((item) => this.evaluate(item, ctx) as Scalar)),
        );
      case "ref": {
        const area = this.area(node, ctx.sheet, ctx.row, ctx.col);
        if (!area) return REF;
        if (node.sheet2 !== undefined) {
          const areas: Area[] = [];
          for (let s = area.sheet; s <= node.sheet2; s++) areas.push({ ...area, sheet: s });
          return new Ref(areas);
        }
        return new Ref([area]);
      }
      case "name": {
        if (node.sheet === -1) {
          const local = ctx.locals?.get(node.name.toLowerCase());
          if (local !== undefined) return local;
          if (/^_xleta\./i.test(node.name)) {
            const builtin = node.name.slice(7).toUpperCase();
            return FUNCTIONS[builtin] ? new Lambda([], null, undefined, builtin) : NAME;
          }
        }
        const name = this.lookupName(node.name, node.sheet === -1 ? ctx.sheet : node.sheet);
        if (!name) return NAME;
        // A name's references are absolute, so it means the same wherever it is used.
        return this.evaluate(name.node, { ...ctx, locals: undefined });
      }
      case "table":
        return this.tableRef(node, ctx.sheet, ctx.row);
      case "external": {
        const target = this.sheetIndex(`[${node.book}]${node.sheet}`);
        if (target >= 0) {
          const ref = this.externalRef(node.ref, target, ctx);
          if (ref) return ref;
        }
        const value = this.externals.get(
          `[${node.book}]${node.sheet}!${node.ref.replace(/\$/g, "")}`.toLowerCase(),
        );
        return value === undefined ? REF : value;
      }
      case "un": {
        const value = this.evaluate(node.a, ctx);
        // Unary plus changes nothing, not even text: =+A1 shows A1 as it is.
        if (node.op === "+") return this.lift1(value, ctx, (x) => x);
        return this.lift1(value, ctx, (x) => {
          const n = toNumber(x);
          if (isError(n)) return n;
          if (node.op === "-") return -n;
          if (node.op === "%") return n / 100;
          return x === null ? 0 : x;
        });
      }
      case "bin":
        return this.binary(node.op, node, ctx, top);
      case "inarray":
        return this.evaluate(
          node.a,
          ctx.array && !ctx.extent ? ctx : { ...ctx, array: true, extent: undefined },
        );
      case "value":
        return node.v;
      case "fn": {
        const fn: Fn | undefined = FUNCTIONS[node.name];
        if (!fn) {
          const target = this.evaluate({ k: "name", name: node.name, sheet: -1 }, ctx);
          if (!(target instanceof Lambda)) return NAME;
          return this.applyLambda(
            target,
            node.args.map((arg) => (arg.k === "missing" ? undefined : this.evaluate(arg, ctx))),
            ctx,
          );
        }
        if (ctx.extent && !ELEMENTWISE.has(fn)) ctx = { ...ctx, extent: undefined };
        try {
          const strict = TOOLPAK[node.name];
          if (strict) {
            const args = this.toolpakArgs(node.args, strict, ctx);
            if (args instanceof XlError) return args;
            const lifted = args.flatMap((arg, i) =>
              arg.k === "value" &&
              arg.v instanceof Matrix &&
              !strict.includes(ALL) &&
              !strict.includes(i)
                ? [i]
                : [],
            );
            if (!lifted.length) return fn(args, ctx);
            return this.liftN(
              lifted.map((i) => (args[i] as { v: Value }).v),
              ctx,
              (items) => {
                const each = [...args];
                lifted.forEach((i, j) => {
                  each[i] = { k: "value", v: items[j]! };
                });
                return this.toScalar(fn(each, ctx), ctx);
              },
            );
          }
          return fn(arrayArgs(node), ctx);
        } catch (error) {
          if (error instanceof XlError) return error;
          throw error;
        }
      }
    }
  }

  private binary(op: string, node: Extract<Node, { k: "bin" }>, ctx: Context, top: boolean): Value {
    if (op === ":" || op === " " || op === ",") {
      const a = this.evaluate(node.a, ctx);
      const b = this.evaluate(node.b, ctx);
      if (isError(a)) return a;
      if (isError(b)) return b;
      if (!(a instanceof Ref) || !(b instanceof Ref)) return VALUE;
      if (op === ",") return new Ref([...a.areas, ...b.areas]);
      if (op === " " && (a.areas.length > 1 || b.areas.length > 1)) {
        const overlaps: Area[] = [];
        for (const x of a.areas)
          for (const y of b.areas) {
            const r1 = Math.max(x.r1, y.r1);
            const r2 = Math.min(x.r2, y.r2);
            const c1 = Math.max(x.c1, y.c1);
            const c2 = Math.min(x.c2, y.c2);
            if (x.sheet === y.sheet && r1 <= r2 && c1 <= c2)
              overlaps.push({ sheet: x.sheet, r1, c1, r2, c2 });
          }
        return overlaps.length ? new Ref(overlaps) : XlError.of("#NULL!");
      }
      const x = a.single;
      const y = b.single;
      if (!x || !y || x.sheet !== y.sheet) return VALUE;
      if (op === ":")
        return new Ref([
          {
            sheet: x.sheet,
            r1: Math.min(x.r1, y.r1),
            c1: Math.min(x.c1, y.c1),
            r2: Math.max(x.r2, y.r2),
            c2: Math.max(x.c2, y.c2),
          },
        ]);
      const r1 = Math.max(x.r1, y.r1);
      const r2 = Math.min(x.r2, y.r2);
      const c1 = Math.max(x.c1, y.c1);
      const c2 = Math.min(x.c2, y.c2);
      if (r1 > r2 || c1 > c2) return XlError.of("#NULL!");
      return new Ref([{ sheet: x.sheet, r1, c1, r2, c2 }]);
    }
    const a = this.evaluate(node.a, ctx);
    const b = this.evaluate(node.b, ctx);
    return this.lift2(a, b, ctx, (x, y) => {
      switch (op) {
        case "+":
        case "-": {
          const p = toNumber(x);
          if (isError(p)) return p;
          const q = toNumber(y);
          if (isError(q)) return q;
          return top && !node.paren
            ? addAdjusted(p, op === "+" ? q : -q)
            : op === "+"
              ? p + q
              : p - q;
        }
        case "*": {
          const p = toNumber(x);
          if (isError(p)) return p;
          const q = toNumber(y);
          if (isError(q)) return q;
          return p * q;
        }
        case "/": {
          const p = toNumber(x);
          if (isError(p)) return p;
          const q = toNumber(y);
          if (isError(q)) return q;
          if (q === 0) return DIV0;
          return p / q;
        }
        case "^": {
          const p = toNumber(x);
          if (isError(p)) return p;
          const q = toNumber(y);
          if (isError(q)) return q;
          return power(p, q);
        }
        case "&": {
          if (isError(x)) return x;
          if (isError(y)) return y;
          const p = toText(x);
          const q = toText(y);
          if (isError(p)) return p;
          if (isError(q)) return q;
          return p + q;
        }
        default: {
          if (isError(x)) return x;
          if (isError(y)) return y;
          const order = compare(x, y);
          switch (op) {
            case "=":
              return order === 0;
            case "<>":
              return order !== 0;
            case "<":
              return order < 0;
            case ">":
              return order > 0;
            case "<=":
              return order <= 0;
            case ">=":
              return order >= 0;
          }
          return VALUE;
        }
      }
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Shapes: references, arrays and single values

  /** A reference or array narrowed to one value, the way a single cell narrows it in Excel. */
  toScalar(value: Value, ctx: Context): Scalar {
    if (value instanceof Ref) {
      const area = value.single;
      if (!area) return VALUE;
      if (area.r1 === area.r2 && area.c1 === area.c2)
        return this.cellValue(area.sheet, area.r1, area.c1);
      // Implicit intersection with the formula's own row or column.
      if (
        area.c1 === area.c2 &&
        ctx.row >= area.r1 &&
        ctx.row <= area.r2 &&
        area.sheet === ctx.sheet
      )
        return this.cellValue(area.sheet, ctx.row, area.c1);
      if (
        area.r1 === area.r2 &&
        ctx.col >= area.c1 &&
        ctx.col <= area.c2 &&
        area.sheet === ctx.sheet
      )
        return this.cellValue(area.sheet, area.r1, ctx.col);
      if (area.c1 === area.c2 && ctx.row >= area.r1 && ctx.row <= area.r2)
        return this.cellValue(area.sheet, ctx.row, area.c1);
      if (area.r1 === area.r2 && ctx.col >= area.c1 && ctx.col <= area.c2)
        return this.cellValue(area.sheet, area.r1, ctx.col);
      return VALUE;
    }
    if (value instanceof Matrix) return value.rows && value.cols ? value.get(0, 0) : VALUE;
    return value;
  }

  /** Rows used anywhere, so whole-column references do not become million-row arrays. */
  usedRows(): number {
    return Math.max(0, ...this.sheets.map((sheet) => sheet.maxRow));
  }

  usedCols(): number {
    return Math.max(0, ...this.sheets.map((sheet) => sheet.maxCol));
  }

  /** Any value as an array: a reference's cells (clipped to the used area), a single value as 1×1. */
  toMatrix(value: Value, ctx: Context): Matrix {
    if (value instanceof Matrix) return value;
    if (value instanceof Ref) {
      const area = value.single;
      if (!area) return Matrix.fill(1, 1, VALUE);
      const r2 = Math.min(area.r2, Math.max(area.r1, this.usedRows()));
      const c2 = Math.min(area.c2, Math.max(area.c1, this.usedCols()));
      const rows = r2 - area.r1 + 1;
      const cols = c2 - area.c1 + 1;
      const data: Scalar[] = new Array(rows * cols);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          data[r * cols + c] = this.cellValue(area.sheet, area.r1 + r, area.c1 + c);
      return new Matrix(rows, cols, data);
    }
    void ctx;
    return new Matrix(1, 1, [value]);
  }

  /** Each cell in a reference that holds something, without visiting empty cells. */
  *cellsIn(ref: Ref): Generator<Scalar> {
    for (const area of ref.areas) {
      const sheet = this.sheets[area.sheet];
      if (!sheet) {
        yield REF;
        continue;
      }
      for (const [r, c] of sheet.occupied(area)) yield this.cellValue(area.sheet, r, c);
    }
  }

  /** An argument for a function that wants one value per call: arrays in array formulas, else one. */
  operand(value: Value, ctx: Context): Scalar | Matrix {
    if (value instanceof Ref) {
      if (ctx.array) {
        const area = value.single;
        if (area && (area.r1 !== area.r2 || area.c1 !== area.c2)) return this.toMatrix(value, ctx);
      }
      return this.toScalar(value, ctx);
    }
    return value;
  }

  lift1(value: Value, ctx: Context, fn: (x: Scalar) => Scalar): Value {
    const x = this.operand(value, ctx);
    if (x instanceof Matrix) {
      if (ctx.extent) return broadcast([x], (items) => fn(items[0]!), ctx.extent);
      return new Matrix(
        x.rows,
        x.cols,
        x.data.map((item) => fn(item)),
      );
    }
    return fn(x);
  }

  lift2(a: Value, b: Value, ctx: Context, fn: (x: Scalar, y: Scalar) => Scalar): Value {
    const x = this.operand(a, ctx);
    const y = this.operand(b, ctx);
    if (!(x instanceof Matrix) && !(y instanceof Matrix)) return fn(x, y);
    return broadcast([x, y], (items) => fn(items[0]!, items[1]!), ctx.extent);
  }

  liftN(values: Value[], ctx: Context, fn: (items: Scalar[]) => Scalar): Value {
    const items = values.map((value) => this.operand(value, ctx));
    if (!items.some((item) => item instanceof Matrix)) return fn(items as Scalar[]);
    return broadcast(items, fn, ctx.extent);
  }

  /**
   * Calls a function passed as an argument (a LAMBDA, a name holding one, or an eta-reduced
   * built-in such as SUM in GROUPBY) with already-evaluated arguments.
   */
  callFunctionArg(fnNode: Node, args: Value[], ctx: Context): Value {
    const fn = this.evaluate(fnNode, ctx);
    if (fn instanceof XlError) return fn;
    return fn instanceof Lambda ? this.applyLambda(fn, args, ctx) : VALUE;
  }

  /** Calls a function value; `undefined` arguments were left out, which ISOMITTED reports. */
  applyLambda(fn: Lambda, args: Array<Value | undefined>, ctx: Context): Value {
    if (fn.builtin) {
      const nodes: Node[] = args.map((v) =>
        v === undefined ? { k: "missing" } : { k: "value", v },
      );
      return this.evaluate(
        { k: "fn", name: fn.builtin, args: nodes },
        { ...ctx, extent: undefined },
      );
    }
    if (args.length > fn.params.length) return VALUE;
    if (++this.depth > 4000) {
      this.depth--;
      return CALC;
    }
    try {
      const locals = new Map(fn.locals ?? []);
      fn.params.forEach((param, i) => {
        const value = args[i];
        locals.set(param, value === undefined ? null : value);
        if (value === undefined) locals.set(`\0omitted:${param}`, true);
        else locals.delete(`\0omitted:${param}`);
      });
      return this.evaluate(fn.body!, { ...ctx, locals, extent: undefined });
    } finally {
      this.depth--;
    }
  }

  /**
   * Arguments for an Analysis ToolPak function, evaluated once. These take single numbers only:
   * TRUE/FALSE is #VALUE!, and so is a multi-cell range in an array formula (they never lift over
   * ranges, which is why =EOMONTH(A1:A3+0,0) is the known workaround). `ranges` lists parameters
   * that do take ranges, such as WORKDAY's holidays.
   */
  private toolpakArgs(args: Node[], ranges: number[], ctx: Context): Node[] | XlError {
    const out: Node[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg.k === "missing") {
        out.push(arg);
        continue;
      }
      const value = this.evaluate(arg, ctx);
      const takesRange = ranges.includes(ALL) || ranges.includes(i);
      if (value instanceof Ref && ctx.array && !takesRange) {
        const area = value.single;
        if (!area || area.r1 !== area.r2 || area.c1 !== area.c2) return VALUE;
      }
      const one =
        value instanceof Ref
          ? value.single
            ? this.toScalar(value, { ...ctx, array: false })
            : null
          : value;
      if (typeof one === "boolean") return VALUE;
      out.push({ k: "value", v: value });
    }
    return out;
  }

  rand(): number {
    return this.random();
  }

  /** Structured references (Table[Column]) as the cells they stand for. */
  tableRef(node: Extract<Node, { k: "table" }>, sheet: number, row: number): Value {
    const table =
      this.model.tables.find((t) => t.name.toLowerCase() === node.table.toLowerCase()) ??
      (node.table === ""
        ? this.model.tables.find((t) => t.sheet === sheet && row >= t.r1 && row <= t.r2)
        : undefined);
    if (!table) return REF;
    let c1 = table.c1;
    let c2 = table.c2;
    if (node.columns) {
      const a = table.columns.findIndex(
        (name) => name.toLowerCase() === node.columns![0].toLowerCase(),
      );
      const b = table.columns.findIndex(
        (name) => name.toLowerCase() === node.columns![1].toLowerCase(),
      );
      if (a < 0 || b < 0) return REF;
      c1 = table.c1 + Math.min(a, b);
      c2 = table.c1 + Math.max(a, b);
    }
    const dataTop = table.r1 + (table.header ? 1 : 0);
    const dataBottom = table.r2 - (table.totals ? 1 : 0);
    const items = new Set(node.items.map((item) => item.toLowerCase()));
    let r1 = dataTop;
    let r2 = dataBottom;
    if (items.has("#all")) {
      r1 = table.r1;
      r2 = table.r2;
    } else if (items.has("#this row")) {
      if (row < dataTop || row > dataBottom) return VALUE;
      r1 = r2 = row;
    } else {
      const headers = items.has("#headers");
      const totals = items.has("#totals");
      const data = items.has("#data") || (!headers && !totals);
      r1 = headers ? table.r1 : data ? dataTop : dataBottom + 1;
      r2 = totals ? table.r2 : data ? dataBottom : table.r1;
    }
    return new Ref([{ sheet: table.sheet, r1, c1, r2, c2 }]);
  }
}

/**
 * Parameters Excel declares as arrays: their arguments are evaluated as arrays in any formula,
 * so =SUMPRODUCT(A1:A3*B1:B3) multiplies whole ranges without being entered as an array formula.
 */
const ALL = -1;
const ARRAY_PARAMS: Record<string, number[]> = {
  SUMPRODUCT: [ALL],
  MMULT: [ALL],
  MINVERSE: [ALL],
  MDETERM: [ALL],
  TRANSPOSE: [ALL],
  LINEST: [ALL],
  LOGEST: [ALL],
  TREND: [ALL],
  GROWTH: [ALL],
  SLOPE: [ALL],
  INTERCEPT: [ALL],
  RSQ: [ALL],
  PEARSON: [ALL],
  CORREL: [ALL],
  COVAR: [ALL],
  "COVARIANCE.P": [ALL],
  "COVARIANCE.S": [ALL],
  STEYX: [ALL],
  FORECAST: [1, 2],
  "FORECAST.LINEAR": [1, 2],
  SUMX2MY2: [ALL],
  SUMX2PY2: [ALL],
  SUMXMY2: [ALL],
  CHITEST: [ALL],
  "CHISQ.TEST": [ALL],
  TTEST: [0, 1],
  "T.TEST": [0, 1],
  FTEST: [ALL],
  "F.TEST": [ALL],
  ZTEST: [0],
  "Z.TEST": [0],
  PROB: [0, 1],
  LOOKUP: [1, 2],
  MATCH: [1],
  XMATCH: [1],
  XLOOKUP: [1, 2],
  INDEX: [0],
  IFS: [ALL],
  VLOOKUP: [1],
  HLOOKUP: [1],
  LARGE: [0],
  SMALL: [0],
  PERCENTILE: [0],
  "PERCENTILE.INC": [0],
  "PERCENTILE.EXC": [0],
  QUARTILE: [0],
  "QUARTILE.INC": [0],
  "QUARTILE.EXC": [0],
  PERCENTRANK: [0],
  "PERCENTRANK.INC": [0],
  "PERCENTRANK.EXC": [0],
  IRR: [0],
  MIRR: [0],
  XNPV: [1, 2],
  XIRR: [0, 1],
  FILTER: [ALL],
  SORT: [ALL],
  SORTBY: [ALL],
  UNIQUE: [ALL],
  ROWS: [ALL],
  COLUMNS: [ALL],
  AREAS: [ALL],
  MODE: [],
  "MODE.MULT": [ALL],
  TEXTJOIN: [],
  CONCAT: [],
  AGGREGATE: [],
  SERIESSUM: [3],
};

/** Analysis ToolPak functions, with the parameters that take ranges (see toolpakArgs). */
const TOOLPAK: Record<string, number[]> = Object.fromEntries([
  ...[
    "ACCRINT",
    "ACCRINTM",
    "AMORDEGRC",
    "AMORLINC",
    "BESSELI",
    "BESSELJ",
    "BESSELK",
    "BESSELY",
    "BIN2DEC",
    "BIN2HEX",
    "BIN2OCT",
    "COMPLEX",
    "CONVERT",
    "COUPDAYBS",
    "COUPDAYS",
    "COUPDAYSNC",
    "COUPNCD",
    "COUPNUM",
    "COUPPCD",
    "CUMIPMT",
    "CUMPRINC",
    "DEC2BIN",
    "DEC2HEX",
    "DEC2OCT",
    "DELTA",
    "DISC",
    "DOLLARDE",
    "DOLLARFR",
    "DURATION",
    "EDATE",
    "EFFECT",
    "EOMONTH",
    "ERF",
    "ERF.PRECISE",
    "ERFC",
    "ERFC.PRECISE",
    "FACTDOUBLE",
    "GESTEP",
    "HEX2BIN",
    "HEX2DEC",
    "HEX2OCT",
    "INTRATE",
    "ISEVEN",
    "ISODD",
    "MDURATION",
    "MROUND",
    "NOMINAL",
    "OCT2BIN",
    "OCT2DEC",
    "OCT2HEX",
    "ODDFPRICE",
    "ODDFYIELD",
    "ODDLPRICE",
    "ODDLYIELD",
    "PRICE",
    "PRICEDISC",
    "PRICEMAT",
    "QUOTIENT",
    "RECEIVED",
    "SQRTPI",
    "TBILLEQ",
    "TBILLPRICE",
    "TBILLYIELD",
    "WEEKNUM",
    "YEARFRAC",
    "YIELD",
    "YIELDDISC",
    "YIELDMAT",
  ].map((name) => [name, []] as const),
  ["NETWORKDAYS", [2]],
  ["WORKDAY", [2]],
  ["GCD", [ALL]],
  ["LCM", [ALL]],
  ["MULTINOMIAL", [ALL]],
  ["FVSCHEDULE", [1]],
  ["SERIESSUM", [3]],
]);

const wrapped = new WeakMap<Node, Node[]>();

function arrayArgs(node: Extract<Node, { k: "fn" }>): Node[] {
  const params = ARRAY_PARAMS[node.name];
  if (!params?.length) return node.args;
  let args = wrapped.get(node);
  if (!args) {
    args = node.args.map((arg, i) =>
      (params.includes(ALL) || params.includes(i)) && arg.k !== "missing" && arg.k !== "ref"
        ? { k: "inarray", a: arg }
        : arg,
    );
    wrapped.set(node, args);
  }
  return args;
}

function broadcast(
  items: Array<Scalar | Matrix>,
  fn: (items: Scalar[]) => Scalar,
  extent?: { rows: number; cols: number },
): Matrix {
  let rows = extent?.rows ?? 1;
  let cols = extent?.cols ?? 1;
  for (const item of items) {
    if (!(item instanceof Matrix)) continue;
    rows = Math.max(rows, item.rows);
    cols = Math.max(cols, item.cols);
  }
  const data: Scalar[] = new Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const args = items.map((item) => {
        if (!(item instanceof Matrix)) return item;
        const mr = item.rows === 1 ? 0 : r;
        const mc = item.cols === 1 ? 0 : c;
        return mr < item.rows && mc < item.cols ? item.get(mr, mc) : NA;
      });
      data[r * cols + c] = fn(args);
    }
  }
  return new Matrix(rows, cols, data);
}

/**
 * Excel's ^: 0^0 and roots of negatives are #NUM!, odd roots of negatives work. Its last digit
 * follows from how Excel works a power out, which every saved result in the test workbooks agrees
 * with: whole-number powers by repeated squaring, ^0.5 as a square root, anything else as
 * EXP(y·LN(x)); and a negative power as 1 over the positive one.
 */
/** Functions whose result spills, which Excel marks with @ when a legacy formula returns one. */
const SPILLING = new Set([
  "ANCHORARRAY",
  "FILTER",
  "RANDARRAY",
  "SEQUENCE",
  "SORT",
  "SORTBY",
  "UNIQUE",
]);

/**
 * A legacy formula with every multi-cell reference that an operator reduces to one cell wrapped
 * in SINGLE, which Excel shows as @; the same node when there is none.
 */
function markIntersections(node: Node, inArray: boolean): Node {
  const many = (n: Node) =>
    n.k === "ref" && n.sheet2 === undefined && (!!n.span || n.r1 !== n.r2 || n.c1 !== n.c2);
  const operand = (n: Node): Node =>
    !inArray && many(n) ? { k: "fn", name: "SINGLE", args: [n] } : markIntersections(n, inArray);
  switch (node.k) {
    case "un": {
      const a = operand(node.a);
      return a === node.a ? node : { ...node, a };
    }
    case "bin": {
      if (node.op === ":" || node.op === " " || node.op === ",") return node;
      const a = operand(node.a);
      const b = operand(node.b);
      return a === node.a && b === node.b ? node : { ...node, a, b };
    }
    case "fn": {
      const params = ARRAY_PARAMS[node.name];
      let changed = false;
      const args = node.args.map((arg, i) => {
        const marked = markIntersections(
          arg,
          inArray || !!params?.includes(ALL) || !!params?.includes(i),
        );
        if (marked !== arg) changed = true;
        return marked;
      });
      return changed ? { ...node, args } : node;
    }
    default:
      return node;
  }
}

/** The end of a quoted string or sheet name that opens at `start`. */
function quoteEnd(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === quote) {
      if (text[i + 1] !== quote) return i;
      i++;
    }
    i++;
  }
  return text.length - 1;
}

/** A formula as Excel shows it: no file-format prefixes, SINGLE(x) as @x and ANCHORARRAY(x) as x#. */
function displayFormula(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      const end = quoteEnd(text, i);
      out += text.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (!/[\w.]/.test(out.at(-1) ?? "")) {
      const rest = text.slice(i);
      const prefix = /^(?:_xl(?:fn|ws|pm|udf)\.)+/i.exec(rest);
      if (prefix) {
        i += prefix[0].length;
        continue;
      }
      const wrapper = /^(SINGLE|ANCHORARRAY)\(/i.exec(rest);
      if (wrapper) {
        const open = i + wrapper[0].length - 1;
        let depth = 0;
        let close = open;
        for (; close < text.length; close++) {
          const c = text[close];
          if (c === '"' || c === "'") close = quoteEnd(text, close);
          else if (c === "(") depth++;
          else if (c === ")" && --depth === 0) break;
        }
        const inner = displayFormula(text.slice(open + 1, close));
        out += wrapper[1]!.toUpperCase() === "SINGLE" ? `@${inner}` : `${inner}#`;
        i = close + 1;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

export function power(base: number, exponent: number): Scalar {
  if (base === 0 && exponent === 0) return NUM;
  if (base === 0 && exponent < 0) return DIV0;
  if (Number.isNaN(base) || Number.isNaN(exponent)) return NUM;
  let sign = 1;
  if (base < 0 && !Number.isInteger(exponent)) {
    const inverse = 1 / exponent;
    if (!Number.isInteger(inverse) || Math.abs(inverse) % 2 !== 1) return NUM;
    sign = -1;
    base = -base;
  }
  const size = Math.abs(exponent);
  let result: number;
  if (Number.isInteger(size) && size <= 1024) result = integerPower(base, size);
  else if (base === 0 || !Number.isFinite(base) || !Number.isFinite(size)) result = base ** size;
  else if (size === 0.5) result = Math.sqrt(base);
  else result = exp(size * log(base));
  if (exponent < 0) result = 1 / result;
  return Number.isFinite(result) ? sign * result : NUM;
}

/**
 * Whole-number powers by repeated squaring and multiplying, which is how Excel rounds them: x^3
 * is (x·x)·x, one step at a time, each product rounded as Excel's power routine rounds it (to 64
 * bits and then to a double), not the library pow's single rounding of the whole.
 */
function integerPower(base: number, exponent: number): number {
  let n = Math.abs(exponent);
  let result = 1;
  let factor = base;
  let first = true;
  while (n > 0) {
    if (n & 1) {
      result = first ? factor : multiply(result, factor);
      first = false;
    }
    n >>>= 1;
    if (n) factor = multiply(factor, factor);
  }
  return result;
}

const nameKey = (name: string, sheet: number) => `${sheet}:${name.toLowerCase()}`;

function colName(col: number): string {
  let name = "";
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** The clock as an Excel serial date-time, in the device's own time zone like Excel. */
export function currentSerial(date = new Date()): number {
  const local = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
  return local / 86_400_000 + 25569;
}

/** A small seeded generator (mulberry32), so RAND() can be repeated exactly. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
