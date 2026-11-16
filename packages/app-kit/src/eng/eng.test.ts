import { describe, expect, it } from "vitest";
import { roundDecimal } from "../calc/functions/helpers.js";
import {
  analyseBeam,
  barArea,
  barRow,
  bisect,
  brent,
  check,
  compatible,
  convert,
  det,
  engNotation,
  fmt,
  interpolate,
  interpolate2d,
  q,
  round,
  sectionProps,
  sigFig,
  simpson,
  siPrefix,
  solve,
  trapz,
} from "./index.js";

const close = (actual: number, expected: number, rel = 1e-9) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * rel + 1e-12);

describe("number formatting", () => {
  it("rounds as Excel's ROUND", () => {
    expect(round(2.675, 2)).toBe(2.68);
    expect(round(-2.5)).toBe(-3);
    expect(round(1234.5678, -2)).toBe(1200);
    for (const x of [0.1 + 0.2, 1.005, 12.345, -0.000123456, 98765.4321]) {
      expect(round(x, 2)).toBe(roundDecimal(x, 2, "half"));
    }
  });

  it("formats significant figures and fixed decimals by one rule", () => {
    expect(sigFig(123456, 3)).toBe(123000);
    expect(fmt(0.1 + 0.2)).toBe("0.3");
    expect(fmt(135.04)).toBe("135");
    expect(fmt(12.5, { dp: 2 })).toBe("12.50");
    expect(fmt(-0.0001, { dp: 2 })).toBe("0.00");
    expect(fmt(9.99951)).toBe("10");
    expect(fmt(1.5e-6)).toBe("1.5×10⁻⁶");
    expect(fmt(2.1e11, { sf: 3 })).toBe("2.1×10¹¹");
    expect(fmt(1234567, { sf: 7, group: "," })).toBe("1,234,567");
    expect(engNotation(12500)).toBe("12.5×10³");
    expect(siPrefix(12500, "W")).toBe("12.5 kW");
    expect(siPrefix(0.0047, "F", 2)).toBe("4.7 mF");
  });

  it("checks utilisation without ever showing a failure as 1.00", () => {
    expect(check(80, 100)).toEqual({ utilisation: 0.8, pass: true, shown: "0.80" });
    expect(check(100.0001, 100).pass).toBe(false);
    expect(check(100.0001, 100).shown).toBe("1.01");
    expect(check(30, 25, "min")).toMatchObject({ pass: true, shown: "0.84" });
    expect(check(20, 25, "min").pass).toBe(false);
  });
});

describe("units", () => {
  it("converts common engineering units", () => {
    expect(convert(1, "N/mm²", "MPa")).toBe(1);
    expect(convert(250, "kN/m2", "kPa")).toBe(250);
    expect(convert(1, "kNm", "Nmm")).toBe(1e6);
    expect(convert(1, "ft", "in")).toBe(12);
    expect(convert(1, "ksi", "MPa")).toBe(6.89475729316836);
    expect(convert(1, "kip", "kN")).toBe(4.4482216152605);
    expect(convert(20, "°C", "°F")).toBe(68);
    expect(convert(300, "K", "°C")).toBe(26.85);
    expect(convert(1, "kWh", "MJ")).toBe(3.6);
    expect(convert(36, "m³/h", "l/s")).toBe(10);
    expect(convert(1, "W/m2K", "W/(m²·K)")).toBe(1);
    expect(convert(1, "tCO2e", "kgCO2e")).toBe(1000);
    expect(convert(8360, "cm4", "mm4")).toBe(83600000);
    expect(convert(90, "deg", "rad")).toBe(1.5707963267949);
    expect(convert(1, "kΩ", "Ω")).toBe(1000);
  });

  it("refuses conversions between different quantities", () => {
    expect(() => convert(1, "kN", "kg")).toThrow(/Cannot convert/);
    expect(() => convert(1, "kgCO2e", "kg")).toThrow(/Cannot convert/);
    expect(() => convert(1, "furlong", "m")).toThrow(/Unknown unit/);
    expect(compatible("kVA", "kW")).toBe(true);
    expect(compatible("kNm", "kN")).toBe(false);
  });

  it("carries dimensions through arithmetic", () => {
    const moment = q(12, "kN/m").mul(q(6, "m").pow(2)).div(8);
    expect(moment.to("kNm")).toBe(54);
    const stress = moment.div(q(1e6, "mm3"));
    expect(stress.to("MPa")).toBe(54);
    const power = q(400, "V").mul(q(32, "A")).mul(Math.sqrt(3));
    close(power.to("kW"), (400 * 32 * Math.sqrt(3)) / 1000);
    expect(() => q(1, "kN").add(q(1, "m"))).toThrow(/Cannot add/);
  });
});

describe("numerical methods", () => {
  it("interpolates tables as codes of practice do", () => {
    expect(interpolate([0, 10, 20], [1, 0.8, 0.5], 15)).toBe(0.65);
    expect(() => interpolate([0, 10], [1, 2], 11)).toThrow(RangeError);
    expect(interpolate([0, 10], [1, 2], 11, "clamp")).toBe(2);
    expect(interpolate([0, 10], [1, 2], 20, "extrapolate")).toBe(3);
    expect(
      interpolate2d(
        [0, 1],
        [0, 1],
        [
          [0, 1],
          [2, 3],
        ],
        0.5,
        0.5,
      ),
    ).toBe(1.5);
  });

  it("finds roots", () => {
    const f = (x: number) => x ** 3 - 2 * x - 5;
    close(brent(f, 2, 3), 2.0945514815423265, 1e-12);
    close(bisect(f, 2, 3), 2.0945514815423265, 1e-11);
    expect(() => brent(f, 3, 4)).toThrow(/not bracketed/);
  });

  it("integrates", () => {
    close(simpson(Math.sin, 0, Math.PI), 2, 1e-8);
    expect(simpson((x) => x ** 3, 0, 2, 2)).toBe(4);
    expect(trapz([0, 1, 3], [0, 2, 2])).toBe(5);
  });

  it("solves dense systems with partial pivoting", () => {
    const x = solve(
      [
        [0, 2, 1],
        [1, -2, -3],
        [-1, 1, 2],
      ],
      [-8, 0, 3],
    );
    for (const [i, value] of [-4, -5, 2].entries()) close(x[i]!, value, 1e-12);
    close(
      det([
        [2, -3, 1],
        [2, 0, -1],
        [1, 4, 5],
      ]),
      49,
      1e-12,
    );
    expect(() =>
      solve(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toThrow(/singular/);
  });
});

describe("sections", () => {
  it("matches textbook section properties", () => {
    const rect = sectionProps({ type: "rect", b: 300, h: 600 });
    close(rect.Ix, (300 * 600 ** 3) / 12);
    close(rect.Zp, (300 * 600 ** 2) / 4);
    const ub = sectionProps({ type: "i", h: 400, b: 200, tf: 20, tw: 10 });
    close(ub.Ix, (200 * 400 ** 3 - 190 * 360 ** 3) / 12);
    close(ub.Zp, 200 * 20 * 380 + (10 * 360 ** 2) / 4);
    const tee = sectionProps({ type: "t", h: 300, b: 200, tf: 50, tw: 50 });
    close(tee.yc, (250 * 50 * 125 + 200 * 50 * 275) / 22500);
    close(sectionProps({ type: "circle", d: 100 }).Ix, (Math.PI * 100 ** 4) / 64);
    const bars = barRow({ n: 3, dia: 20, b: 300, h: 600, cover: 30, link: 10 });
    expect(bars.map((bar) => bar.x)).toEqual([-100, 0, 100]);
    expect(bars[0]!.y).toBe(50);
    close(barArea(3, 20), 942.4777960769379);
  });
});

describe("beam analysis", () => {
  const EI = 20_000;
  const peak = (values: number[]) => Math.max(...values.map(Math.abs));

  it("simply supported beam with a UDL: wL²/8 and 5wL⁴/384EI", () => {
    const w = 10;
    const L = 6;
    const r = analyseBeam({
      length: L,
      supports: [
        { x: 0, type: "pin" },
        { x: L, type: "roller" },
      ],
      loads: [{ type: "udl", w }],
      EI,
    });
    close(r.reactions[0]!.V, (w * L) / 2);
    close(r.max.sagging.value, (w * L * L) / 8);
    close(r.max.sagging.x, 3);
    close(r.max.deflection!.value, -((5 * w * L ** 4) / (384 * EI)) * 1000, 1e-9);
    close(peak(r.shear), (w * L) / 2);
    expect(r.shear[0]).toBe(0);
  });

  it("central point load: PL/4 and PL³/48EI, with a shear jump under the load", () => {
    const r = analyseBeam({
      length: 8,
      supports: [
        { x: 0, type: "pin" },
        { x: 8, type: "roller" },
      ],
      loads: [{ type: "point", x: 4, P: 50 }],
      EI,
    });
    close(r.max.sagging.value, 100);
    close(r.max.deflection!.value, -((50 * 8 ** 3) / (48 * EI)) * 1000);
    const at = r.x.flatMap((x, i) => (x === 4 ? [r.shear[i]] : []));
    expect(at).toEqual([25, -25]);
  });

  it("cantilever with a tip load: PL hogging and PL³/3EI", () => {
    const r = analyseBeam({
      length: 3,
      supports: [{ x: 0, type: "fixed" }],
      loads: [{ type: "point", x: 3, P: 20 }],
      EI,
    });
    close(r.reactions[0]!.V, 20);
    close(r.reactions[0]!.M, 60);
    close(r.max.hogging.value, -60);
    close(r.max.deflection!.value, -((20 * 27) / (3 * EI)) * 1000);
  });

  it("propped cantilever with a UDL: 3wL/8 at the prop, wL²/8 at the fixed end, 9wL²/128 sagging", () => {
    const r = analyseBeam({
      length: 5,
      supports: [
        { x: 0, type: "fixed" },
        { x: 5, type: "roller" },
      ],
      loads: [{ type: "udl", w: 8 }],
      EI,
    });
    close(r.reactions[1]!.V, (3 * 8 * 5) / 8);
    close(r.max.hogging.value, -(8 * 25) / 8);
    close(r.max.sagging.value, (9 * 8 * 25) / 128);
    close(r.max.sagging.x, (5 * 5) / 8);
  });

  it("two equal continuous spans with a UDL: 1.25wL at the middle support, wL²/8 over it", () => {
    const r = analyseBeam({
      length: 12,
      supports: [
        { x: 0, type: "pin" },
        { x: 6, type: "roller" },
        { x: 12, type: "roller" },
      ],
      loads: [{ type: "udl", w: 10 }],
      EI,
    });
    close(r.reactions[1]!.V, 1.25 * 10 * 6);
    close(r.max.hogging.value, -(10 * 36) / 8);
    close(r.max.hogging.x, 6);
  });

  it("fixed-fixed beam with a UDL: wL²/12 ends, wL²/24 midspan, wL⁴/384EI", () => {
    const r = analyseBeam({
      length: 6,
      supports: [
        { x: 0, type: "fixed" },
        { x: 6, type: "fixed" },
      ],
      loads: [{ type: "udl", w: 12 }],
      EI,
    });
    close(r.max.hogging.value, -(12 * 36) / 12);
    close(r.max.sagging.value, (12 * 36) / 24);
    close(r.max.deflection!.value, -((12 * 6 ** 4) / (384 * EI)) * 1000);
  });

  it("triangular load on a simple span: wL²/(9√3) at L/√3", () => {
    const r = analyseBeam({
      length: 6,
      supports: [
        { x: 0, type: "pin" },
        { x: 6, type: "roller" },
      ],
      loads: [{ type: "linear", w1: 0, w2: 9, from: 0, to: 6 }],
    });
    close(r.max.sagging.value, (9 * 36) / (9 * Math.sqrt(3)), 1e-9);
    close(r.max.sagging.x, 6 / Math.sqrt(3), 1e-9);
    expect(r.deflection).toBeNull();
  });

  it("refuses mechanisms", () => {
    expect(() =>
      analyseBeam({
        length: 4,
        supports: [{ x: 0, type: "pin" }],
        loads: [{ type: "point", x: 2, P: 1 }],
      }),
    ).toThrow(/unstable/);
  });
});
