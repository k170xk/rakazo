import { describe, expect, it } from "vitest";
import { Engine, toJson } from "./engine.js";
import type { CalcModel, CellSpec, CellValueJson } from "./model.js";
import { parseAddress } from "./model.js";
import { describeVerification, verifyModel } from "./verify.js";
import { parseXml, textOf } from "./xml.js";

type Entry = CellValueJson | `=${string}` | { array: string; to: string };

/** A model from cells by address: "=…" is a formula, { array } an array formula over A1:to. */
function model(
  sheets: Record<string, Record<string, Entry>>,
  extra: Partial<CalcModel> = {},
): CalcModel {
  const names = Object.keys(sheets);
  const formulas: CalcModel["formulas"] = [];
  const at = (text: string, sheet: number) => {
    const found = parseAddress(text, (name) => names.indexOf(name), sheet);
    if (!found) throw new Error(text);
    return found;
  };
  return {
    version: 1,
    source: { fileName: "test.xlsx", sha256: "" },
    date1904: false,
    sheets: names.map((name, index) => {
      const cells: Array<[number, number, CellSpec]> = [];
      let rows = 0;
      let cols = 0;
      for (const [ref, entry] of Object.entries(sheets[name]!)) {
        const { row, col } = at(ref, index);
        rows = Math.max(rows, row);
        cols = Math.max(cols, col);
        if (typeof entry === "string" && entry.startsWith("=")) {
          formulas.push({ text: entry.slice(1), row, col });
          cells.push([row, col, { f: formulas.length - 1 }]);
        } else if (entry !== null && typeof entry === "object" && "array" in entry) {
          const end = at(entry.to, index);
          formulas.push({ text: entry.array, row, col });
          cells.push([row, col, { f: formulas.length - 1, a: [end.row, end.col] }]);
        } else cells.push([row, col, { v: entry }]);
      }
      return { name, rows, cols, cells };
    }),
    formulas,
    formats: [],
    styles: [],
    names: [],
    tables: [],
    externals: {},
    inputs: [],
    unsupported: [],
    ...extra,
  };
}

function calculate(cells: Record<string, Entry>, rules?: number) {
  const engine = new Engine(model({ Sheet1: cells }));
  engine.calculate({ rules, now: 46000 });
  return (address: string) => toJson(engine.get(address));
}

const one = (formula: string, cells: Record<string, Entry> = {}, rules?: number) =>
  calculate({ ...cells, Z1: `=${formula}` }, rules)("Z1");

describe("Excel arithmetic", () => {
  it("compares numbers to 15 digits, but lookups exactly", () => {
    expect(one("0.1+0.2=0.3")).toBe(true);
    expect(one("MATCH(0.1+0.2,A1:A1,0)", { A1: 0.3 })).toEqual({ e: "#N/A" });
    expect(one("AVERAGE(0.1,0.2,-0.3)")).toBe(0);
  });

  it("rounds as Excel does", () => {
    expect(one("ROUNDUP(0.0916,2)")).toBe(0.09 + 0.01);
    expect(one("INT(0.29/0.01)")).toBe(29);
    expect(one("FLOOR(0.7433178244187401,0.05)")).toBe(0.7000000000000001);
    expect(one("CEILING(2.5,0.1)")).toBe(2.5);
  });

  it("follows the saving version's rules for CEILING of a negative number", () => {
    expect(one("CEILING(-2.5,1)")).toBe(-2);
    expect(one("CEILING(-2.5,1)", {}, 11)).toEqual({ e: "#NUM!" });
  });

  it("takes LOG without a base as log10", () => {
    expect(one("LOG(1000)")).toBe(3);
    expect(one("LOG(8,2)")).toBe(3);
    expect(one("LOG(0)")).toEqual({ e: "#NUM!" });
  });

  it("reduces angles by Excel's 64-bit pi", () => {
    const vectors = [
      [-2.066390506984397, -0.8796863001197269, -0.4755544273599666, 1.8498120288844588],
      [-7.114898332851249, -0.7390863673330805, 0.6736106751101788, -1.0972010905441667],
      [5.142818591304987, -0.9087865735494401, 0.4172612655594429, -2.1779797181293237],
      [8.893621902158749, 0.5065304587104335, -0.8622220679144079, -0.5874709979711589],
      [-2460636.497883166, -0.23777816804043103, -0.9713194854440719, 0.2447991331417825],
      [-7676692.145047611, 0.009293026567813239, -0.9999568188963011, -0.009293427868285737],
    ];
    for (const [x, sin, cos, tan] of vectors) {
      const at = calculate({ A1: x!, B1: "=SIN(A1)", C1: "=COS(A1)", D1: "=TAN(A1)" });
      expect([at("B1"), at("C1"), at("D1")]).toEqual([sin, cos, tan]);
    }
    expect(one("SIN(2^27)")).toEqual({ e: "#NUM!" });
    expect(one("RADIANS(180)")).toBe(Math.PI);
    expect(one("DEGREES(PI())")).toBe(180);
  });

  it("reads serial 0 as 0 January 1900", () => {
    expect([one("YEAR(0)"), one("MONTH(0)"), one("DAY(0)")]).toEqual([1900, 1, 0]);
  });

  it("sees the #N/A that pads an array formula's range from formulas above it", () => {
    const at = calculate({
      A5: 1,
      B5: 2,
      A6: 3,
      B6: 4,
      A1: "=SUM(A5:B6)",
      D1: "=ISERROR(SUM(D2:G4))",
      D2: { array: "A5:B6", to: "F4" },
    });
    expect([at("F2"), at("D1")]).toEqual([{ e: "#N/A" }, true]);
  });

  it("lifts INDEX, IFS, SWITCH and CHOOSE over array arguments", () => {
    const grid = { A5: 1, B5: 2, A6: 3, B6: 4 };
    const at = calculate({
      ...grid,
      D1: { array: "INDEX(A5:B6,{1,2},2)", to: "E1" },
      D2: { array: "IFS({TRUE,FALSE},1,TRUE,2)", to: "E2" },
      D3: { array: 'SWITCH({1,2},1,"a","b")', to: "E3" },
      D4: { array: 'CHOOSE({1,2},"x","y")', to: "E4" },
    });
    expect(["D1", "E1", "D2", "E2", "D3", "E3", "D4", "E4"].map(at)).toEqual([
      2,
      4,
      1,
      2,
      "a",
      "b",
      "x",
      "y",
    ]);
  });

  it("sorts on several keys, keeps blanks last and rejects bad sort arguments", () => {
    const at = calculate({
      A1: 2,
      B1: "b",
      A2: 1,
      B2: "z",
      A3: 2,
      B3: "a",
      D1: { array: "SORT(A1:B3,{1,2},{1,-1})", to: "E3" },
      G1: "=SORT(A1:B3,3)",
      G2: "=SORT(A1:B3,1,2)",
    });
    expect(["D1", "E1", "D2", "E2", "D3", "E3"].map(at)).toEqual([1, "z", 2, "b", 2, "a"]);
    expect([at("G1"), at("G2")]).toEqual([{ e: "#VALUE!" }, { e: "#VALUE!" }]);
  });

  it("gives #CALC! when TAKE or DROP leave nothing and #VALUE! for text FILTER flags", () => {
    expect(one("TAKE({1,2},0)")).toEqual({ e: "#CALC!" });
    expect(one("DROP({1,2},1)")).toEqual({ e: "#CALC!" });
    expect(one('FILTER({1,2},{"x",TRUE})')).toEqual({ e: "#VALUE!" });
    expect(one("ROWS(UNIQUE({1,1,2},TRUE))")).toBe(1);
    expect(one("COLUMNS(UNIQUE({1,1,2},TRUE))")).toBe(2);
  });

  it("follows Excel's TIME, DATEDIF YD and SUBSTITUTE edge cases", () => {
    expect(one("TIME(25,0,0)")).toBeCloseTo(1 / 24, 15);
    expect(one('DATEDIF("1988-06-22","2012-05-11","YD")')).toBe(323);
    expect(one('SUBSTITUTE("aa","a","b",TRUE)')).toEqual({ e: "#VALUE!" });
    expect(one("YEAR(2958466)")).toEqual({ e: "#NUM!" });
  });

  it("matches error criteria and returns the first error SUMPRODUCT meets", () => {
    expect(one('COUNTIFS(A2:A3,"#N/A")', { A2: { e: "#N/A" }, A3: 1 })).toBe(1);
    expect(one("SUMPRODUCT({1,2},{1,2,3}/0)")).toEqual({ e: "#DIV/0!" });
  });

  it("writes ADDRESS with a sheet only when one is given", () => {
    expect(one("ADDRESS(1,1)")).toBe("$A$1");
    expect(one("ADDRESS(1,1,1,A2)")).toBe("R1C1");
    expect(one('ADDRESS(1,1,1,TRUE,"")')).toBe("!$A$1");
  });

  it("intersects every pair of areas in a multi-area intersection", () => {
    expect(one("SUM((A2:B3,D2:E3) B2:D2)", { B2: 1, D2: 2 })).toBe(3);
    expect(one("SUM((A2,B3) C4)")).toEqual({ e: "#NULL!" });
  });

  it("computes ACOT, ACOTH and MULTINOMIAL over Excel's domains", () => {
    expect(one("ACOT(-1)")).toBeCloseTo((3 * Math.PI) / 4, 15);
    expect(one("ACOTH(1)")).toEqual({ e: "#NUM!" });
    expect(one("MULTINOMIAL(2,3,4)")).toBeCloseTo(1260, 9);
    expect(one("MULTINOMIAL(-1,2)")).toEqual({ e: "#NUM!" });
    expect(one("MULTINOMIAL(TRUE)")).toEqual({ e: "#VALUE!" });
  });

  it("reduces FREQUENCY's expression arguments to one cell outside array formulas", () => {
    const at = calculate({
      A1: 1,
      A2: 5,
      A3: 9,
      B2: "=SUM(SIGN(FREQUENCY(A1:A3*1,{2,6,10})))",
      C1: { array: "SUM(SIGN(FREQUENCY(A1:A3*1,{2,6,10})))", to: "C1" },
      D1: "=FREQUENCY(FALSE,{1})",
    });
    expect([at("B2"), at("C1"), at("D1")]).toEqual([1, 3, { e: "#VALUE!" }]);
  });

  it("gives an error written in the formula before one read from a cell", () => {
    expect(one("SUM(A1,1/0)", { A1: { e: "#N/A" } })).toEqual({ e: "#DIV/0!" });
  });
});

describe("circular references with iteration off", () => {
  it("leaves a loop and what reads it at their values, and calculates the rest", () => {
    const m = model(
      {
        Sheet1: {
          C1: 5,
          A1: "=B1",
          B1: "=A1+C1",
          D1: "=A1*2",
          E1: "=C1*3",
          F1: "=IF(C1>0,1,F1)",
        },
      },
      { iterationOff: true },
    );
    m.sheets[0]!.cells.find(([r, c]) => r === 0 && c === 3)![2].v = 7;
    const engine = new Engine(m);
    engine.calculate({ now: 46000 });
    engine.setByAddress("C1", 6);
    engine.calculate({ now: 46000 });
    const at = (address: string) => toJson(engine.get(address));
    expect(["A1", "B1", "D1", "E1", "F1"].map(at)).toEqual([0, 0, 7, 18, 1]);
  });
});

describe("what-if data tables", () => {
  it("substitutes each value into the input cell and leaves the workbook as it was", () => {
    const at = calculate({
      A1: 2,
      B1: "=A1*10",
      B2: "=B1",
      A3: 1,
      A4: 2,
      A5: 3,
      B3: { array: "TABLE(,$A$1)", to: "B5" },
    });
    expect([at("B3"), at("B4"), at("B5")]).toEqual([10, 20, 30]);
    expect([at("A1"), at("B1")]).toEqual([2, 20]);
  });
});

describe("workbook text", () => {
  it("reads line ends as Excel does", () => {
    expect(textOf(parseXml("<t>a\r\nb\rc</t>"))).toBe("a\nb\nc");
  });
});

describe("import gate", () => {
  /** A workbook whose B1 = A1*2 was saved by Excel showing `result`. */
  const saved = (result: number) => {
    const book = model(
      { Sheet1: { A1: 3, B1: "=A1*2" } },
      { source: { fileName: "t.xlsx", sha256: "", excelCalculated: true } },
    );
    book.sheets[0]!.cells[1]![2].v = result;
    return book;
  };

  it("passes when every formula matches what Excel saved", () => {
    const result = verifyModel(saved(6));
    expect(result.passed).toBe(true);
    expect(describeVerification(result)[0]).toBe(
      "All 1 formula results match the values Excel saved.",
    );
  });

  it("names each formula that differs", () => {
    const result = verifyModel(saved(7));
    expect(result.passed).toBe(false);
    expect(result.mismatches[0]).toMatchObject({
      sheet: "Sheet1",
      cell: "B1",
      expected: 7,
      actual: 6,
    });
  });
});

describe("argument rules of individual functions", () => {
  it("matches Excel's handling of dates, weekends and Roman forms", () => {
    expect(one("ISOWEEKNUM(1)")).toBe(52);
    expect(one('NETWORKDAYS.INTL("2020-1-1","2024-1-1",TRUE)')).toBe(1044);
    expect(one('NETWORKDAYS.INTL("2020-1-1","2024-1-1",A1)')).toEqual({ e: "#NUM!" });
    expect(one('NETWORKDAYS.INTL("2020-1-1","2024-1-1",NA())')).toEqual({ e: "#VALUE!" });
    expect(one('WORKDAY.INTL("2020-1-1","2024-1-1",TRUE)')).toBe(107239);
    expect(one('WORKDAY.INTL("2020-1-1","2024-1-1",NA())')).toEqual({ e: "#NUM!" });
    expect(one('INDEX(WORKDAY("2020-1-1",{"2024-7-1","2010-3-2","2010-2-1"}),1,2)')).toBe(100166);
    expect(one("DAYS(1987,-1)")).toEqual({ e: "#NUM!" });
    expect(one("DAYS360(1987,2958466)")).toEqual({ e: "#NUM!" });
    expect(
      ["0", "1.9", "2.9", "3", "4", "TRUE", "FALSE"].map((f) => one(`ROMAN(999.9,${f})`)),
    ).toEqual(["CMXCIX", "LMVLIV", "XMIX", "VMIV", "IM", "CMXCIX", "IM"]);
  });

  it("matches Excel on GCD, LCM, AND, N and MUNIT arguments", () => {
    expect(one("GCD(-0.4)")).toEqual({ e: "#NUM!" });
    expect(one("GCD(A1)")).toEqual({ e: "#VALUE!" });
    expect(one("LCM(A1)", { A1: "ciao" })).toEqual({ e: "#VALUE!" });
    expect(one("GCD(A1:C1)", { A1: -0.4, C1: "ciao" })).toEqual({ e: "#VALUE!" });
    expect(one('AND(TRUE,"0")')).toBe(true);
    expect(one('AND(TRUE,"0",#REF!)')).toEqual({ e: "#REF!" });
    expect(one("SUM(MUNIT({1,2;3,4;7,8}))")).toBe(6);
    const at = calculate({ A1: 4, B1: "x", C1: { array: "N(A1:B1)", to: "D1" } });
    expect([at("C1"), at("D1")]).toEqual([4, 4]);
  });
});

describe("formulas as Excel shows them", () => {
  it("keeps typed spacing, writes @ and #, and treats spills and plain formulas as Excel does", () => {
    const m = model({
      Sheet1: {
        A1: 1,
        A2: 2,
        A3: 3,
        B1: { array: "A1:A3*2", to: "B3" },
        G1: { array: "A1:A3", to: "G3" },
        D1: "=SUM( A1:A3 ,1)",
        D2: "=_xlfn.SINGLE((A1:A3)) + 1",
        D3: "=_xlfn.ANCHORARRAY(G1)",
        D4: "=$A$1:$A$3",
        E1: { array: "IFERROR(A1:A3/0,A1:A3*10)", to: "E3" },
        C1: "=FORMULATEXT(D1)",
        C2: "=FORMULATEXT(D2)",
        C3: "=FORMULATEXT(D3)",
        C4: "=FORMULATEXT(D4)",
        C5: "=ISFORMULA(G2)",
        C6: "=ISFORMULA(B2)",
        C7: "=SUM(ANCHORARRAY(D1))",
        C8: "=ANCHORARRAY(A1)",
        C9: "=FORMULATEXT(D5)",
        C10: "=FORMULATEXT(D6)",
        D5: "=A1:A3+B1:B3",
        D6: "=SUMPRODUCT(A1:A3*B1:B3)",
      },
    });
    const g1 = m.sheets[0]!.cells.find(([r, c]) => r === 0 && c === 6)!;
    g1[2].d = true;
    const engine = new Engine(m);
    engine.calculate({ now: 46000 });
    const at = (address: string) => toJson(engine.get(address));
    expect(at("C1")).toBe("=SUM( A1:A3 ,1)");
    expect(at("C2")).toBe("=@(A1:A3) + 1");
    expect(at("C3")).toBe("=@G1#");
    expect(at("C4")).toBe("=@$A$1:$A$3");
    expect(at("C9")).toBe("=@A1:A3+@B1:B3");
    expect(at("C10")).toBe("=SUMPRODUCT(A1:A3*B1:B3)");
    expect(at("C5")).toBe(false);
    expect(at("C6")).toBe(true);
    expect(at("C7")).toBe(7);
    expect(at("C8")).toEqual({ e: "#REF!" });
    expect(at("D2")).toBe(3);
    expect(at("E2")).toBe(20);
  });
});

describe("SUBTOTAL and AGGREGATE", () => {
  it("leave out hidden rows, nested subtotals and errors as their options say", () => {
    const formulas = {
      C1: "=SUBTOTAL(9,A1:A5)",
      C2: "=SUBTOTAL(109,A1:A5)",
      C3: "=AGGREGATE(9,0,A1:A5)",
      C4: "=AGGREGATE(9,4,A1:A5)",
      C5: "=AGGREGATE(9,5,A1:A5)",
      C6: "=AGGREGATE(9,3,A1:A6)",
      C7: "=AGGREGATE(9,1,A1:A6)",
      C8: "=AGGREGATE(14,6,A1:A6,1)",
      C9: "=SUBTOTAL(9,A1:A6)",
    } as const;
    const m = model({
      Sheet1: { A1: 1, A2: 2, A3: 3, A4: 4, A5: "=SUBTOTAL(9,A1:A2)", A6: "=1/0", ...formulas },
    });
    m.sheets[0]!.hiddenRows = [2];
    const engine = new Engine(m);
    engine.calculate({ now: 46000 });
    const at = (address: keyof typeof formulas) => toJson(engine.get(address));
    expect(at("C1")).toBe(10);
    expect(at("C2")).toBe(7);
    expect(at("C3")).toBe(10);
    expect(at("C4")).toBe(13);
    expect(at("C5")).toBe(10);
    expect(at("C6")).toBe(7);
    expect(at("C7")).toEqual({ e: "#DIV/0!" });
    expect(at("C8")).toBe(4);
    expect(at("C9")).toEqual({ e: "#DIV/0!" });
  });
});

describe("regression and smoothing", () => {
  it("gives a collinear LINEST column a zero coefficient and one fewer degree of freedom", () => {
    const cells: Record<string, Entry> = { A1: 1, A2: 2, A3: 3, A4: 5 };
    [1, 2, 3, 4].forEach((x, i) => {
      cells[`B${i + 1}`] = x;
      cells[`C${i + 1}`] = 2 * x;
    });
    const at = calculate({
      ...cells,
      E1: "=INDEX(LINEST(A1:A4,B1:C4,TRUE,TRUE),1,1)",
      E2: "=INDEX(LINEST(A1:A4,B1:C4,TRUE,TRUE),1,2)",
      E3: "=INDEX(LINEST(A1:A4,B1:C4,TRUE,TRUE),1,3)",
      E4: "=INDEX(LINEST(A1:A4,B1:C4,TRUE,TRUE),4,2)",
    });
    const [m2, m1] = [at("E1") as number, at("E2") as number];
    expect(m1 === 0 || m2 === 0).toBe(true);
    expect(m1 + 2 * m2).toBeCloseTo(1.3, 14);
    expect(at("E3")).toBeCloseTo(-0.5, 14);
    expect(at("E4")).toBe(2);
  });

  it("keeps LINEST's column order when no column is more independent than another", () => {
    const xs = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
    const ys = [
      16.700000000000003, 12.1, 8.3, 5.4, 3.1, 1.7000000000000002, 1.1, 1.3, 2.3000000000000003,
      4.1, 6.700000000000001, 10.1,
    ];
    const cells: Record<string, Entry> = {};
    xs.forEach((x, i) => {
      cells[`A${i + 1}`] = x;
      cells[`B${i + 1}`] = ys[i]!;
    });
    const at = calculate({
      ...cells,
      D1: "=INDEX(LINEST(B1:B12,A1:A12^{1,2}),1,1)",
      D2: "=INDEX(LINEST(B1:B12,A1:A12^{1,2}),1,3)",
    });
    expect(at("D1")).toBe(0.3995754245754246);
    expect(at("D2")).toBe(1.1124125874125879);
  });

  it("returns the first error in a matrix function's input, row by row", () => {
    const cells: Record<string, Entry> = {
      A1: { e: "#REF!" },
      B1: 0,
      A2: { e: "#N/A" },
      B2: 1,
      C1: 2,
      C2: { e: "#NUM!" },
    };
    expect(one("MDETERM(A1:B2)", cells)).toEqual({ e: "#REF!" });
    expect(one("INDEX(MINVERSE(B1:C2),1,1)", cells)).toEqual({ e: "#NUM!" });
    expect(one("INDEX(MMULT(B1:C1,C1:C2),1,1)", cells)).toEqual({ e: "#NUM!" });
    expect(one('MDETERM({1,"a";2,3})')).toEqual({ e: "#VALUE!" });
    expect(one("INDEX(MMULT(NA(),B1:B2),1,1)", cells)).toEqual({ e: "#N/A" });
  });

  it("recalculates a data table through array results and INDIRECT, then puts them back", () => {
    const at = calculate({
      A1: 1,
      B1: "=A1*2",
      C1: { array: "B1*{1;2}", to: "C2" },
      D1: '=INDIRECT("C2")+0',
      F2: "=D1",
      G2: "=C2",
      E3: 2,
      E4: 3,
      F3: { array: "TABLE(,A1)", to: "G4" },
    });
    expect([at("F3"), at("G3"), at("F4"), at("G4")]).toEqual([8, 8, 12, 12]);
    expect([at("C2"), at("D1")]).toEqual([4, 4]);
  });

  it("follows a data table's INDIRECT to wherever it points at each calculation", () => {
    const engine = new Engine(
      model({
        Sheet1: {
          A1: 1,
          B1: "=A1*2",
          B2: 5,
          C1: "B2",
          D1: "=INDIRECT(C1)+0",
          F2: "=D1",
          E3: 2,
          E4: 3,
          F3: { array: "TABLE(,A1)", to: "F4" },
        },
      }),
    );
    engine.calculate({ now: 46000 });
    expect([toJson(engine.get("F3")), toJson(engine.get("F4"))]).toEqual([5, 5]);
    engine.setByAddress("C1", "B1");
    engine.calculate({ now: 46000 });
    expect([toJson(engine.get("F3")), toJson(engine.get("F4"))]).toEqual([4, 6]);
    expect(toJson(engine.get("D1"))).toBe(2);
  });

  it("forecasts a three-point series with Excel's fixed smoothing parameters", () => {
    const at = calculate({
      A1: 2018,
      A2: 2019,
      A3: 2020,
      B1: 72854,
      B2: 74286,
      B3: 74298,
      C1: "=FORECAST.ETS(2021,B1:B3,A1:A3,1,1)",
      C2: "=FORECAST.ETS(2023,B1:B3,A1:A3,1,1)",
    });
    expect(at("C1")).toBeCloseTo(75203.46329, 8);
    expect(at("C2")).toBeCloseTo(76760.06787, 8);
  });
});
