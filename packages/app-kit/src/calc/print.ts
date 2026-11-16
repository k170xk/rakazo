import { columnName, quoteSheet } from "./model.js";
import type { Node, RefNode } from "./parse.js";
import { CALL, MAX_COL, MAX_ROW } from "./parse.js";
import { numberToText } from "./values.js";

/**
 * A parsed formula written back out as it reads in a given cell, so a filled or shared formula
 * shows that cell's own references in reports. Brackets are added only where precedence needs them.
 */
export function printFormula(
  node: Node,
  row: number,
  col: number,
  sheetNames: readonly string[],
): string {
  return `=${print(node, row, col, sheetNames, 0)}`;
}

const PRECEDENCE: Record<string, number> = {
  "=": 1,
  "<>": 1,
  "<": 1,
  ">": 1,
  "<=": 1,
  ">=": 1,
  "&": 2,
  "+": 3,
  "-": 3,
  "*": 4,
  "/": 4,
  "^": 5,
  " ": 8,
  ":": 9,
  ",": 0,
};

function print(
  node: Node,
  row: number,
  col: number,
  names: readonly string[],
  outer: number,
): string {
  switch (node.k) {
    case "num":
      return numberToText(node.v);
    case "str":
      return `"${node.v.replace(/"/g, '""')}"`;
    case "bool":
      return node.v ? "TRUE" : "FALSE";
    case "err":
      return node.v;
    case "missing":
      return "";
    case "ref":
      return printRef(node, row, col, names);
    case "name":
      return node.sheet >= 0 ? `${quoteSheet(names[node.sheet] ?? "?")}!${node.name}` : node.name;
    case "table": {
      const parts = [...node.items.map((item) => `[${item}]`)];
      if (node.columns)
        parts.push(
          node.columns[0] === node.columns[1]
            ? `[${node.columns[0]}]`
            : `[${node.columns[0]}]:[${node.columns[1]}]`,
        );
      return `${node.table}[${parts.join(",")}]`;
    }
    case "external":
      return `[${node.book}]${node.sheet}!${node.ref}`;
    case "array":
      return `{${node.rows.map((r) => r.map((item) => print(item, row, col, names, 0)).join(",")).join(";")}}`;
    case "fn":
      if (node.name === CALL)
        return `${print(node.args[0]!, row, col, names, 0)}(${node.args
          .slice(1)
          .map((arg) => print(arg, row, col, names, 0))
          .join(",")})`;
      return `${node.name}(${node.args.map((arg) => print(arg, row, col, names, 0)).join(",")})`;
    case "inarray":
      return print(node.a, row, col, names, outer);
    case "value":
      return "#VALUE!";
    case "un": {
      const inner = print(node.a, row, col, names, 6);
      return node.op === "%" ? `${inner}%` : `${node.op}${inner}`;
    }
    case "bin": {
      const prec = PRECEDENCE[node.op] ?? 0;
      // Left-associative: the right side needs brackets at equal precedence.
      const text = `${print(node.a, row, col, names, prec)}${node.op}${print(node.b, row, col, names, prec + 0.5)}`;
      return prec < outer || node.op === "," ? `(${text})` : text;
    }
  }
}

function printRef(node: RefNode, row: number, col: number, names: readonly string[]): string {
  const r1 = node.ar1 ? node.r1 : row + node.r1;
  const r2 = node.ar2 ? node.r2 : row + node.r2;
  const c1 = node.ac1 ? node.c1 : col + node.c1;
  const c2 = node.ac2 ? node.c2 : col + node.c2;
  const sheet =
    node.sheet >= 0
      ? `${node.sheet2 !== undefined ? quoteSheet(`${names[node.sheet]}:${names[node.sheet2]}`) : quoteSheet(names[node.sheet] ?? "?")}!`
      : "";
  if (r1 < 0 || c1 < 0 || r2 > MAX_ROW || c2 > MAX_COL) return `${sheet}#REF!`;
  const colText = (c: number, abs: boolean) => `${abs ? "$" : ""}${columnName(c)}`;
  const rowText = (r: number, abs: boolean) => `${abs ? "$" : ""}${r + 1}`;
  if (node.span === "cols") return `${sheet}${colText(c1, node.ac1)}:${colText(c2, node.ac2)}`;
  if (node.span === "rows") return `${sheet}${rowText(r1, node.ar1)}:${rowText(r2, node.ar2)}`;
  const first = colText(c1, node.ac1) + rowText(r1, node.ar1);
  const second = colText(c2, node.ac2) + rowText(r2, node.ar2);
  return first === second &&
    r1 === r2 &&
    c1 === c2 &&
    node.ar1 === node.ar2 &&
    node.ac1 === node.ac2
    ? `${sheet}${first}`
    : `${sheet}${first}:${second}`;
}
