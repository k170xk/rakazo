// @vitest-environment jsdom
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  CalcSheet,
  CalcStep,
  Check,
  CheckSummary,
  checkTex,
  renderTex,
  stepTex,
  subst,
  Tex,
  texNum,
  texQty,
  texUnit,
} from "./index.js";
import { katexStylesheet } from "./katex-style.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

function render(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

describe("LaTeX helpers", () => {
  it("writes numbers and units by the shared rounding rules", () => {
    expect(texNum(56.25)).toBe("56.25");
    expect(texNum(56.25, { sf: 3 })).toBe("56.3");
    expect(texNum(2.1e-6, { sf: 2 })).toBe("2.1 \\times 10^{-6}");
    expect(texUnit("kN/m^2")).toBe("\\mathrm{kN/m^{2}}");
    expect(texUnit("N/mm²")).toBe("\\mathrm{N/mm^{2}}");
    expect(texUnit("kgCO2e/m2")).toBe("\\mathrm{kgCO_2e/m^{2}}");
    expect(texUnit("W/(m·K)")).toBe("\\mathrm{W/(m\\cdot K)}");
    expect(texQty(25, "°C")).toBe("25\\,\\mathrm{{}^{\\circ}C}");
    expect(texQty(12, "%")).toBe("12\\mathrm{\\%}");
  });

  it("substitutes values into a formula with explicit multiplication", () => {
    expect(subst("\\frac{w L^2}{8}", { w: 12.5, L: 6 })).toBe("\\frac{12.5 \\times 6^2}{8}");
    expect(subst("0.87 f_{yk} A_s z", { "f_{yk}": 500, A_s: 942, z: 450 })).toBe(
      "0.87 \\times 500 \\times 942 \\times 450",
    );
    expect(
      subst("\\frac{\\alpha_{cc} f_{ck}}{\\gamma_c}", {
        "\\alpha_{cc}": 0.85,
        "f_{ck}": 30,
        "\\gamma_c": 1.5,
      }),
    ).toBe("\\frac{0.85 \\times 30}{1.5}");
    expect(subst("x + y", { x: -2, y: 3 })).toBe("\\left(-2\\right) + 3");
    expect(subst("\\pi D \\text{ for D}", { D: 300 })).toBe("\\pi \\times 300 \\text{ for D}");
  });

  it("lays out a step and a check", () => {
    expect(
      stepTex({
        symbol: "M_{Ed}",
        formula: "\\frac{w L^2}{8}",
        values: { w: 12.5, L: 6 },
        result: 56.25,
        unit: "kNm",
      }),
    ).toBe("M_{Ed} = \\frac{w L^2}{8} = \\frac{12.5 \\times 6^2}{8} = 56.25\\,\\mathrm{kNm}");
    expect(
      checkTex({ symbol: "M_{Ed}", limitSymbol: "M_{Rd}", value: 56.25, limit: 70, unit: "kNm" }),
    ).toContain("\\le");
    expect(checkTex({ value: 30, limit: 25, mode: "min", unit: "mm" })).toBe(
      "30\\,\\mathrm{mm} \\ge 25\\,\\mathrm{mm}",
    );
  });

  it("renders bad LaTeX as an error instead of throwing", () => {
    expect(renderTex("\\frac{1}{")).toContain("katex-error");
    expect(renderTex("\\href{https://example.com}{x}")).not.toContain("href=");
  });
});

describe("components", () => {
  it("renders a calculation sheet with steps, checks and a summary", () => {
    const el = render(
      <CalcSheet title="RC beam B1" job="1234" by="AB">
        <CalcStep
          label="Design moment"
          symbol="M_{Ed}"
          formula="\frac{w L^2}{8}"
          values={{ w: 12.5, L: 6 }}
          result={56.25}
          unit="kNm"
          reference="EN 1990"
        />
        <Check
          label="Bending"
          symbol="M_{Ed}"
          limitSymbol="M_{Rd}"
          value={56.25}
          limit={50}
          unit="kNm"
        />
        <CheckSummary
          checks={[
            { label: "Bending", value: 56.25, limit: 50 },
            { label: "Shear", value: 40, limit: 80 },
          ]}
        />
        <Tex block>{"\\sigma = \\frac{M}{Z}"}</Tex>
      </CalcSheet>,
    );
    expect(el.textContent).toContain("RC beam B1");
    expect(el.textContent).toContain("EN 1990");
    expect(el.querySelectorAll(".katex").length).toBeGreaterThan(3);
    expect(el.textContent).toContain("Fail 1.13");
    expect(el.textContent).toContain("0.50");
    expect(document.head.querySelector('style[data-ocsc="math"]')).not.toBeNull();
  });
});

describe("stylesheet", () => {
  it("swaps the stylesheet's font URLs for bundled data URIs", () => {
    const css =
      '@font-face{font-family:KaTeX_Main;src:url(fonts/KaTeX_Main-Regular.woff2) format("woff2")}.katex{font:normal 1.21em KaTeX_Main}';
    const out = katexStylesheet(css, [
      {
        family: "KaTeX_Main",
        weight: 400,
        style: "normal",
        bytes: new Uint8Array([119, 79, 70, 50]),
      },
    ]);
    expect(out).not.toContain("fonts/");
    expect(out).toContain("url(data:font/woff2;base64,d09GMg==)");
    expect(out).toContain(".katex{font:normal 1.21em KaTeX_Main}");
  });
});
