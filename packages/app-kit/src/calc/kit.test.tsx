// @vitest-environment jsdom
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { CalcInputs, CalcSheet, entryValue, referenceParts, useCalc } from "./kit.js";
import type { CalcModel } from "./model.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Width in A2, length in B2, area = A2*B2 in C2 shown to one decimal, a list input in D2. */
const MODEL: CalcModel = {
  version: 1,
  source: { fileName: "area.xlsx", sha256: "" },
  date1904: false,
  sheets: [
    {
      name: "Area",
      rows: 1,
      cols: 3,
      cells: [
        [0, 0, { v: "Width" }],
        [0, 1, { v: "Length" }],
        [0, 2, { v: "Area" }],
        [0, 3, { v: "Finish" }],
        [1, 0, { v: 2 }],
        [1, 1, { v: 3 }],
        [1, 2, { f: 0, v: 6, z: 0 }],
        [1, 3, { v: "Matt" }],
      ],
    },
  ],
  formulas: [{ text: "A2*B2", row: 1, col: 2 }],
  formats: ["0.0"],
  styles: [],
  names: [],
  tables: [],
  externals: {},
  inputs: [
    { sheet: 0, row: 1, col: 0, kind: "number", why: "unlocked", label: "Width" },
    { sheet: 0, row: 1, col: 1, kind: "number", why: "unlocked", label: "Length" },
    {
      sheet: 0,
      row: 1,
      col: 3,
      kind: "choice",
      why: "validation",
      label: "Finish",
      options: ["Matt", "Gloss"],
    },
  ],
  unsupported: [],
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

function App({ form }: { form?: boolean }) {
  const calc = useCalc("model");
  return (
    <>
      <span data-testid="changed">{String(calc.changed)}</span>
      <button type="button" onClick={calc.reset}>
        Reset
      </button>
      {form ? <CalcInputs calc={calc} /> : <CalcSheet calc={calc} sheet="Area" />}
    </>
  );
}

async function render(form = false) {
  (window as { __OCSC_APP_FIXTURE__?: unknown }).__OCSC_APP_FIXTURE__ = {
    assets: { model: `data:application/json;base64,${btoa(JSON.stringify(MODEL))}` },
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<App form={form} />);
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

const field = (page: HTMLElement, label: string) =>
  page.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const cells = (page: HTMLElement) =>
  [...page.querySelectorAll("td")].map((cell) => cell.textContent);

describe("@ocsc/calc", () => {
  it("shows the sheet calculated and recalculates when an input changes", async () => {
    const page = await render();
    expect(cells(page).slice(0, 7)).toEqual(["Width", "Length", "Area", "Finish", "", "", "6.0"]);
    expect(field(page, "Width").value).toBe("2");
    expect(page.querySelector<HTMLSelectElement>('select[aria-label="Finish"]')!.value).toBe(
      "Matt",
    );
    type(field(page, "Length"), "4.5");
    expect(cells(page)[6]).toBe("9.0");
    expect(page.querySelector('[data-testid="changed"]')!.textContent).toBe("true");
    act(() => page.querySelector("button")!.click());
    expect(cells(page)[6]).toBe("6.0");
    expect(page.querySelector('[data-testid="changed"]')!.textContent).toBe("false");
  });

  it("lists the inputs as a form, with list inputs as choices", async () => {
    const page = await render(true);
    const select = page.querySelector("select")!;
    expect([...select.options].map((option) => option.value)).toEqual(["Matt", "Gloss"]);
    expect(page.querySelectorAll("input")).toHaveLength(2);
  });

  it("reads typed entries the way Excel does", () => {
    expect(entryValue("5%")).toBe(0.05);
    expect(entryValue(" 1,234.5 ")).toBe(1234.5);
    expect(entryValue("true")).toBe(true);
    expect(entryValue("")).toBeNull();
    expect(entryValue("C32/40")).toBe("C32/40");
  });

  it("splits a chart series of several ranges into its ranges", () => {
    expect(referenceParts("(Gra!$A$1:$E$1,'A, B'!$A$3:$E$3)")).toEqual([
      "Gra!$A$1:$E$1",
      "'A, B'!$A$3:$E$3",
    ]);
    expect(referenceParts("Gra!$A$1:$E$1")).toEqual(["Gra!$A$1:$E$1"]);
  });
});
