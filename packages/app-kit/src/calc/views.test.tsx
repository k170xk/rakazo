// @vitest-environment jsdom
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Row } from "../schema.js";
import { useTable } from "../sdk/index.js";
import type { Calc } from "./kit.js";
import { CalcDetails, CalcForm, calcLabel, useCalc } from "./kit.js";
import type { CalcModel } from "./model.js";
import { SAVED_INPUTS_SCHEMA } from "./present.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A beam check: span and load in, moment, utilisation against 20 kNm and a verdict out. */
const MODEL: CalcModel = {
  version: 1,
  source: { fileName: "beam.xlsx", sha256: "" },
  date1904: false,
  sheets: [
    {
      name: "Beam",
      rows: 7,
      cols: 3,
      cells: [
        [0, 0, { v: "BEAM DESIGN", s: 0 }],
        [2, 0, { v: "Span" }],
        [2, 1, { v: 6 }],
        [2, 2, { v: "m" }],
        [3, 0, { v: "Load" }],
        [3, 1, { v: 2 }],
        [3, 2, { v: "kN/m" }],
        [4, 0, { v: "Moment" }],
        [4, 1, { f: 0, v: 9 }],
        [4, 2, { v: "kNm" }],
        [5, 0, { v: "Utilisation" }],
        [5, 1, { f: 1, v: 0.45 }],
        [6, 0, { v: "Status" }],
        [6, 1, { f: 2, v: "OK" }],
      ],
    },
  ],
  formulas: [
    { text: "B4*B3^2/8", row: 4, col: 1 },
    { text: "B5/20", row: 5, col: 1 },
    { text: 'IF(B6<=1,"OK","FAIL")', row: 6, col: 1 },
  ],
  formats: [],
  styles: [{ bold: true }],
  names: [],
  tables: [],
  externals: {},
  inputs: [
    { sheet: 0, row: 2, col: 1, kind: "number", why: "unlocked", label: "Span", unit: "m", min: 1 },
    { sheet: 0, row: 3, col: 1, kind: "number", why: "unlocked", label: "Load", unit: "kN/m" },
  ],
  unsupported: [],
};

const saved: Row = {
  _id: "mine",
  _mine: true,
  _updatedAt: "",
  model: "model",
  values: JSON.stringify({ "Beam!B4": 4, "Beam!C9": 99 }),
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

function App({ details }: { details?: boolean }) {
  const calc = useCalc("model");
  const remembered = useTable(SAVED_INPUTS_SCHEMA.name).rows[0]?.values;
  return (
    <>
      <output data-testid="remembered">{String(remembered)}</output>
      {details ? <CalcDetails calc={calc} /> : <CalcForm calc={calc} sheet="Beam" />}
    </>
  );
}

async function render(details = false) {
  (window as { __OCSC_APP_FIXTURE__?: unknown }).__OCSC_APP_FIXTURE__ = {
    assets: { model: `data:application/json;base64,${btoa(JSON.stringify(MODEL))}` },
    tables: { [SAVED_INPUTS_SCHEMA.name]: { schema: SAVED_INPUTS_SCHEMA, rows: [saved] } },
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<App details={details} />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return host;
}

function type(input: HTMLInputElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

const labelled = (page: HTMLElement, label: string) => {
  const target = [...page.querySelectorAll("label")].find((item) =>
    item.textContent?.startsWith(label),
  );
  return page.querySelector<HTMLInputElement>(`#${CSS.escape(target!.htmlFor)}`)!;
};

describe("calculator views", () => {
  it("puts back the inputs this person last used, ignoring ones the workbook no longer has", async () => {
    const page = await render();
    expect(labelled(page, "Load").value).toBe("4");
    expect(labelled(page, "Span").value).toBe("6");
    expect(page.textContent).toContain("18");
  });

  it("presents a sheet as a page that recalculates, with units, verdicts and ranges", async () => {
    const page = await render();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      expect(page.textContent).toContain("Beam design");
      expect(page.textContent).toContain("kN/m");
      expect(page.querySelector('[role="status"]')!.textContent).toContain("OK");
      type(labelled(page, "Load"), "10");
      expect(page.textContent).toContain("45");
      expect(page.querySelector('[role="status"]')!.textContent).toContain("Fail");
      type(labelled(page, "Span"), "0.5");
      expect(page.textContent).toContain("Expected ≥ 1");
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(JSON.parse(page.querySelector('[data-testid="remembered"]')!.textContent!)).toEqual({
        "Beam!B3": 0.5,
        "Beam!B4": 10,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows every sheet in the full calculation, as the app reads it or as the workbook lays it out", async () => {
    const page = await render(true);
    expect(page.textContent).toContain("Moment");
    const sheetMode = [...page.querySelectorAll("button")].find(
      (item) => item.textContent === "Sheet",
    )!;
    act(() => sheetMode.click());
    expect(page.querySelector("table td")).not.toBeNull();
    expect(
      [...page.querySelectorAll("td")].some((cell) => cell.textContent === "Utilisation"),
    ).toBe(true);
  });

  it("names a field by the text its label formula gives now", () => {
    const reads: Record<string, string> = { "Beam!A3": "SPAN 3", "Beam!A5": "Inside" };
    const calc = { text: (address: string) => reads[address] ?? "" } as Calc;
    const field = {
      address: "Beam!B3",
      label: "Span 2 · Moment",
      input: false,
      live: [{ text: "Span 2", address: "Beam!A3", from: "SPAN 2" }],
    };
    expect(calcLabel(calc, field)).toBe("Span 3 · Moment");
    expect(
      calcLabel(calc, {
        address: "Beam!B5",
        label: "Outside",
        input: true,
        labelAddress: "Beam!A5",
      }),
    ).toBe("Inside");
  });
});
