// @vitest-environment jsdom
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { BeamInput } from "../eng/beam.js";
import { analyseBeam } from "../eng/beam.js";
import {
  BeamResults,
  ContourPlot,
  contourSegments,
  InteractionDiagram,
  insidePolygon,
  logTicks,
  niceTicks,
  Plot,
  PolarPlot,
  SectionDrawing,
  svgFile,
  tickFormat,
} from "./index.js";

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

const texts = (el: Element) => [...el.querySelectorAll("text")].map((t) => t.textContent);

describe("scales", () => {
  it("picks round ticks and labels them consistently", () => {
    expect(niceTicks(0, 9.7, 5)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(-0.3, 0.42, 4)).toEqual([-0.2, 0, 0.2, 0.4]);
    expect(logTicks(1, 1000).major).toEqual([1, 10, 100, 1000]);
    expect(logTicks(1, 100).major).toEqual([1, 2, 5, 10, 20, 50, 100]);
    expect([0, 0.5, 1].map(tickFormat([0, 0.5, 1]))).toEqual(["0.0", "0.5", "1.0"]);
    expect([1e4, 1e5, 1e6].map(tickFormat([1e4, 1e5, 1e6]))).toEqual(["1×10⁴", "1×10⁵", "1×10⁶"]);
  });
});

describe("geometry helpers", () => {
  it("traces a contour where the field crosses the level", () => {
    const grid = {
      x: [0, 1],
      y: [0, 1],
      z: [
        [0, 1],
        [1, 2],
      ],
    };
    const segments = contourSegments(grid, 0.5);
    expect(segments).toHaveLength(1);
    const ends = segments[0]!.map(([x, y]) => [x, y].map((v) => Math.round(v * 100) / 100));
    expect(ends).toEqual(
      expect.arrayContaining([
        [0.5, 0],
        [0, 0.5],
      ]),
    );
    expect(contourSegments(grid, 3)).toEqual([]);
  });

  it("tells whether a design point lies inside a capacity curve", () => {
    const curve = [
      [0, -100],
      [50, 0],
      [0, 400],
      [-50, 0],
    ] as const;
    expect(insidePolygon([10, 50], curve)).toBe(true);
    expect(insidePolygon([60, 50], curve)).toBe(false);
  });
});

describe("components", () => {
  it("draws a log-log chart with a secondary axis and annotations, the same way every time", () => {
    const chart = (
      <Plot
        series={[
          {
            name: "Curve",
            data: [
              [1e4, 300],
              [1e6, 90],
              [1e8, 30],
            ],
          },
          {
            name: "Ratio",
            data: [
              [1e4, 0.2],
              [1e8, 0.9],
            ],
            axis: "right",
          },
        ]}
        x={{ label: "Cycles", scale: "log" }}
        y={{ label: "Stress", unit: "MPa", scale: "log" }}
        y2={{ label: "Ratio", min: 0, max: 1 }}
        annotations={[
          { type: "hline", y: 50, label: "Limit" },
          { type: "point", x: 1e6, y: 90, label: "Design" },
        ]}
        exportName="sn"
      />
    );
    const markup = (el: Element) => el.innerHTML.replace(/_r_\w+?_/g, "_id_");
    const first = markup(render(chart));
    act(() => root?.unmount());
    host?.remove();
    const el = render(chart);
    expect(markup(el)).toBe(first);
    const svg = el.querySelector("svg[data-plot]")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(texts(svg)).toEqual(
      expect.arrayContaining(["Stress (MPa)", "Limit", "Design", "1×10⁶"]),
    );
    expect(el.querySelector('button[aria-label="Download SVG"]')).not.toBeNull();
  });

  it("aligns beam loads, shear, moment and deflection", () => {
    const beam: BeamInput = {
      length: 6,
      supports: [
        { x: 0, type: "pin" },
        { x: 6, type: "roller" },
      ],
      loads: [{ type: "udl", w: 25 }],
      EI: 50_000,
    };
    const el = render(<BeamResults beam={beam} result={analyseBeam(beam)} />);
    expect(el.querySelectorAll("svg[data-plot]")).toHaveLength(4);
    const all = texts(el).join(" ");
    expect(all).toContain("25 kN/m");
    expect(all).toContain("75 kN");
    expect(all).toContain("112.5 kNm");
  });

  it("draws sections, polar plots, contours and interaction diagrams", () => {
    const el = render(
      <>
        <SectionDrawing
          shape={{ type: "rect", b: 300, h: 550 }}
          bars={[{ x: -100, y: 50, d: 20 }]}
          link={{ cover: 30, dia: 10 }}
        />
        <PolarPlot
          series={[
            {
              name: "Wind",
              data: [
                [0, 5],
                [22.5, 7],
                [45, 4],
              ],
              closed: true,
            },
          ]}
          step={22.5}
        />
        <ContourPlot
          grid={{
            x: [0, 1, 2],
            y: [0, 1],
            z: [
              [0, 5, 10],
              [5, 10, 15],
            ],
          }}
          levels={[5]}
          zLabel="Depth (m)"
        />
        <InteractionDiagram
          curve={[
            [0, -100],
            [50, 0],
            [0, 400],
            [-50, 0],
          ]}
          points={[{ M: 60, N: 50, label: "C1" }]}
        />
      </>,
    );
    const all = texts(el);
    expect(all).toEqual(expect.arrayContaining(["300 mm", "550 mm", "22.5°", "Depth (m)", "C1"]));
    expect(
      [...el.querySelectorAll("circle")].some((c) => c.getAttribute("fill-opacity") === "1"),
    ).toBe(true);
  });

  it("exports a standalone SVG without leaving styles on the page", () => {
    const el = render(
      <Plot
        series={[
          {
            name: "A",
            data: [
              [0, 1],
              [1, 2],
            ],
          },
        ]}
      />,
    );
    const svg = el.querySelector<SVGSVGElement>("svg[data-plot]")!;
    const before = svg.getAttribute("style");
    const file = svgFile(svg);
    expect(file.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(file).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg.getAttribute("style")).toBe(before);
  });
});
