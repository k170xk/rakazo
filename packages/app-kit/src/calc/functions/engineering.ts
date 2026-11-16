import type { Scalar } from "../values.js";
import { NA, NUM } from "../values.js";
import type { Fn } from "./helpers.js";
import { int, num, scalar, text } from "./helpers.js";
import { erfc as erfcValue } from "./stats.js";

/**
 * CONVERT's units with Excel's own definitions (older CODATA constants), each as a factor to its
 * group's base unit, and whether it takes metric (k, m, µ…) prefixes; information units also take
 * binary ones (ki, Mi…).
 */
type Unit = { group: string; factor: number; prefix: boolean };

const UNITS = new Map<string, Unit>();
function units(group: string, list: [string[], number, boolean?][]) {
  for (const [names, factor, prefix] of list)
    for (const name of names) UNITS.set(name, { group, factor, prefix: !!prefix });
}

units("mass", [
  [["g"], 1, true],
  [["sg"], 14593.902937206363],
  [["lbm"], 453.59237],
  [["u"], 1.660538782e-24, true],
  [["ozm"], 28.349523125],
  [["grain"], 0.06479891],
  [["cwt", "shweight"], 45359.237],
  [["uk_cwt", "lcwt", "hweight"], 50802.34544],
  [["stone"], 6350.29318],
  [["ton"], 907184.74],
  [["uk_ton", "LTON", "brton"], 1016046.9088],
]);
units("length", [
  [["m"], 1, true],
  [["mi"], 1609.344],
  [["Nmi"], 1852],
  [["in"], 0.0254],
  [["ft"], 0.3048],
  [["yd"], 0.9144],
  [["ang"], 1e-10, true],
  [["ell"], 1.143],
  [["ly"], 9460730472580800, true],
  [["parsec", "pc"], 30856775812815532, true],
  [["Picapt", "Pica"], 0.0254 / 72],
  [["pica"], 0.0254 / 6],
  [["survey_mi"], 1609.3472186944373],
]);
units("time", [
  [["yr"], 31557600],
  [["day", "d"], 86400],
  [["hr"], 3600],
  [["mn", "min"], 60],
  [["sec", "s"], 1, true],
]);
units("pressure", [
  [["Pa", "p"], 1, true],
  [["atm", "at"], 101325, true],
  [["mmHg"], 133.322, true],
  [["psi"], 6894.757293168362],
  [["Torr"], 101325 / 760],
]);
units("force", [
  [["N"], 1, true],
  [["dyn", "dy"], 1e-5, true],
  [["lbf"], 4.4482216152605005],
  [["pond"], 0.00980665, true],
]);
units("energy", [
  [["J"], 1, true],
  [["e"], 1e-7, true],
  [["c"], 4.184, true],
  [["cal"], 4.1868, true],
  [["eV", "ev"], 1.602176487e-19, true],
  [["HPh", "hh"], 2684519.537696173],
  [["Wh", "wh"], 3600, true],
  [["flb"], 1.3558179483314003],
  [["BTU", "btu"], 1055.05585262],
]);
units("power", [
  [["W", "w"], 1, true],
  [["HP", "h"], 745.6998715822702],
  [["PS"], 735.49875],
]);
units("magnetism", [
  [["T"], 1, true],
  [["ga"], 1e-4, true],
]);
units("temperature", [
  [["C", "cel", "F", "fah", "Rank", "Reau"], 1],
  [["K", "kel"], 1, true],
]);
units("volume", [
  [["tsp"], 0.00492892159375],
  [["tspm"], 0.005],
  [["tbs"], 0.01478676478125],
  [["oz"], 0.0295735295625],
  [["cup"], 0.2365882365],
  [["pt", "us_pt"], 0.473176473],
  [["uk_pt"], 0.56826125, true],
  [["qt"], 0.946352946],
  [["uk_qt"], 1.1365225],
  [["gal"], 3.785411784],
  [["uk_gal"], 4.54609],
  [["l", "L", "lt"], 1, true],
  [["ang3"], 1e-27, true],
  [["barrel"], 158.987294928],
  [["bushel"], 35.23907016688],
  [["ft3"], 28.316846592],
  [["in3"], 0.016387064],
  [["ly3"], 8.467866646237152e50],
  [["m3"], 1000, true],
  [["mi3"], 4168181825440.5796],
  [["yd3"], 764.554857984],
  [["Nmi3"], 6352182208000],
  [["Picapt3", "Pica3"], 4.39039566186557e-8],
  [["regton", "GRT"], 2831.6846592],
  [["MTON"], 1132.67386368],
]);
units("area", [
  [["uk_acre"], 4046.8564224],
  [["us_acre"], 4046.8726098742522],
  [["ang2"], 1e-20, true],
  [["ar"], 100, true],
  [["ft2"], 0.09290304],
  [["ha"], 10000],
  [["in2"], 0.00064516],
  [["ly2"], 8.95054210748189e31],
  [["m2"], 1, true],
  [["Morgen"], 2500],
  [["mi2"], 2589988.110336],
  [["Nmi2"], 3429904],
  [["Picapt2", "Pica2"], 1.2445216049382715e-7],
  [["yd2"], 0.83612736],
]);
units("information", [
  [["bit"], 1, true],
  [["byte"], 8, true],
]);
units("speed", [
  [["admkn"], 1853.184 / 3600],
  [["kn"], 1852 / 3600],
  [["m/h", "m/hr"], 1 / 3600, true],
  [["m/s", "m/sec"], 1, true],
  [["mph"], 0.44704, true],
]);

const METRIC: Record<string, number> = {
  Y: 1e24,
  Z: 1e21,
  E: 1e18,
  P: 1e15,
  T: 1e12,
  G: 1e9,
  M: 1e6,
  k: 1e3,
  h: 1e2,
  da: 1e1,
  e: 1e1,
  d: 1e-1,
  c: 1e-2,
  m: 1e-3,
  u: 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
  a: 1e-18,
  z: 1e-21,
  y: 1e-24,
};
const BINARY: Record<string, number> = {
  Yi: 2 ** 80,
  Zi: 2 ** 70,
  Ei: 2 ** 60,
  Pi: 2 ** 50,
  Ti: 2 ** 40,
  Gi: 2 ** 30,
  Mi: 2 ** 20,
  ki: 2 ** 10,
};

type Reading = { name: string; unit: Unit; scale: number; exact: boolean };

/** Every way Excel can read a unit name: the unit itself, or a prefix on a unit that takes one. */
function readings(raw: string): Reading[] {
  // "ft^3" is "ft3".
  const name = /.\^[23]$/.test(raw) ? raw.slice(0, -2) + raw.slice(-1) : raw;
  const out: Reading[] = [];
  const exact = UNITS.get(name);
  if (exact) out.push({ name, unit: exact, scale: 1, exact: true });
  for (const [prefixes, binary] of [
    [METRIC, false],
    [BINARY, true],
  ] as const) {
    for (const [prefix, factor] of Object.entries(prefixes)) {
      if (!name.startsWith(prefix)) continue;
      const rest = name.slice(prefix.length);
      const unit = UNITS.get(rest);
      if (!unit?.prefix || (binary && unit.group !== "information")) continue;
      // Squared and cubed units take the prefix squared or cubed (km2 = 1e6 m2).
      const power =
        unit.group === "area" && rest.endsWith("2")
          ? 2
          : unit.group === "volume" && rest.endsWith("3")
            ? 3
            : 1;
      out.push({ name: rest, unit, scale: factor ** power, exact: false });
    }
  }
  return out;
}

function toKelvin(value: number, unit: string): number {
  switch (unit) {
    case "C":
    case "cel":
      return value + 273.15;
    case "F":
    case "fah":
      return ((value - 32) * 5) / 9 + 273.15;
    case "Rank":
      return (value * 5) / 9;
    case "Reau":
      return value * 1.25 + 273.15;
    default:
      return value;
  }
}

function fromKelvin(value: number, unit: string): number {
  switch (unit) {
    case "C":
    case "cel":
      return value - 273.15;
    case "F":
    case "fah":
      return ((value - 273.15) * 9) / 5 + 32;
    case "Rank":
      return (value * 9) / 5;
    case "Reau":
      return (value - 273.15) / 1.25;
    default:
      return value;
  }
}

/** CONVERT: a pair of readings in the same group, exact unit names preferred over prefixed ones. */
function convert(value: number, fromName: string, toName: string): Scalar {
  let best: [Reading, Reading] | null = null;
  let bestRank = -1;
  for (const from of readings(fromName)) {
    for (const to of readings(toName)) {
      if (from.unit.group !== to.unit.group) continue;
      const rank = (from.exact ? 2 : 0) + (to.exact ? 1 : 0);
      if (rank > bestRank) [best, bestRank] = [[from, to], rank];
    }
  }
  if (!best) return NA;
  const [from, to] = best;
  if (from.unit.group === "temperature")
    return fromKelvin(toKelvin(value * from.scale, from.name), to.name) / to.scale;
  return (value * (from.unit.factor * from.scale)) / (to.unit.factor * to.scale);
}

function radix(value: Scalar, base: number, places: Scalar | undefined, bits: number): Scalar {
  let n = Math.trunc(num(value ?? null));
  const limit = base === 2 ? 512 : base === 8 ? 2 ** 29 : 2 ** 39;
  if (n < -limit || n >= limit) return NUM;
  if (n < 0) n += 2 ** bits;
  let out = n.toString(base).toUpperCase();
  if (places !== undefined && places !== null && Number(value) >= 0) {
    const width = Math.trunc(num(places));
    if (width < out.length || width > 10) return NUM;
    out = out.padStart(width, "0");
  }
  return out;
}

function fromRadix(value: Scalar, base: number, bits: number): Scalar {
  const s = text(value ?? "")
    .trim()
    .toUpperCase();
  if (s.length > 10 || !s) return s ? NUM : 0;
  const valid = base === 2 ? /^[01]+$/ : base === 8 ? /^[0-7]+$/ : /^[0-9A-F]+$/;
  if (!valid.test(s)) return NUM;
  let n = parseInt(s, base);
  if (s.length === 10 && n >= 2 ** (bits - 1)) n -= 2 ** bits;
  return n;
}

// ---------------------------------------------------------------------------------------------
// Bessel functions, with the Numerical Recipes (1st edition) approximations Excel uses: its results
// are only good to about 8 digits, and the polynomials below reproduce them exactly.

function besselI0(x: number): number {
  const ax = Math.abs(x);
  if (ax < 3.75) {
    const y = (x / 3.75) ** 2;
    return (
      1 +
      y *
        (3.5156229 +
          y * (3.0899424 + y * (1.2067492 + y * (0.2659732 + y * (0.0360768 + y * 0.0045813)))))
    );
  }
  const y = 3.75 / ax;
  return (
    (Math.exp(ax) / Math.sqrt(ax)) *
    (0.39894228 +
      y *
        (0.01328592 +
          y *
            (0.00225319 +
              y *
                (-0.00157565 +
                  y *
                    (0.00916281 +
                      y * (-0.02057706 + y * (0.02635537 + y * (-0.01647633 + y * 0.00392377))))))))
  );
}

function besselI1(x: number): number {
  const ax = Math.abs(x);
  let ans: number;
  if (ax < 3.75) {
    const y = (x / 3.75) ** 2;
    ans =
      ax *
      (0.5 +
        y *
          (0.87890594 +
            y *
              (0.51498869 +
                y * (0.15084934 + y * (0.02658733 + y * (0.00301532 + y * 0.00032411))))));
  } else {
    const y = 3.75 / ax;
    ans = 0.02282967 + y * (-0.02895312 + y * (0.01787654 - y * 0.00420059));
    ans =
      0.39894228 +
      y * (-0.03988024 + y * (-0.00362018 + y * (0.00163801 + y * (-0.01031555 + y * ans))));
    ans *= Math.exp(ax) / Math.sqrt(ax);
  }
  return x < 0 ? -ans : ans;
}

const ACC = 40;
const BIGNO = 1e10;
const BIGNI = 1e-10;

/** I_n by Miller's downward recurrence, normalised with I_0. */
function besselI(x: number, n: number): number {
  if (n === 0) return besselI0(x);
  if (n === 1) return besselI1(x);
  if (x === 0) return 0;
  const tox = 2 / Math.abs(x);
  let bip = 0;
  let ans = 0;
  let bi = 1;
  for (let j = 2 * (n + Math.trunc(Math.sqrt(ACC * n))); j > 0; j--) {
    const bim = bip + j * tox * bi;
    bip = bi;
    bi = bim;
    if (Math.abs(bi) > BIGNO) {
      ans *= BIGNI;
      bi *= BIGNI;
      bip *= BIGNI;
    }
    if (j === n) ans = bip;
  }
  ans *= besselI0(x) / bi;
  return x < 0 && n % 2 ? -ans : ans;
}

function besselJ0(x: number): number {
  const ax = Math.abs(x);
  if (ax < 8) {
    const y = x * x;
    const a1 =
      57568490574.0 +
      y *
        (-13362590354.0 +
          y * (651619640.7 + y * (-11214424.18 + y * (77392.33017 + y * -184.9052456))));
    const a2 =
      57568490411.0 +
      y * (1029532985.0 + y * (9494680.718 + y * (59272.64853 + y * (267.8532712 + y))));
    return a1 / a2;
  }
  const z = 8 / ax;
  const y = z * z;
  const xx = ax - 0.785398164;
  const a1 =
    1 +
    y * (-0.1098628627e-2 + y * (0.2734510407e-4 + y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
  const a2 =
    -0.1562499995e-1 +
    y * (0.1430488765e-3 + y * (-0.6911147651e-5 + y * (0.7621095161e-6 - y * 0.934935152e-7)));
  return Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * a1 - z * Math.sin(xx) * a2);
}

function besselJ1(x: number): number {
  const ax = Math.abs(x);
  if (ax < 8) {
    const y = x * x;
    const a1 =
      x *
      (72362614232.0 +
        y *
          (-7895059235.0 +
            y * (242396853.1 + y * (-2972611.439 + y * (15704.4826 + y * -30.16036606)))));
    const a2 =
      144725228442.0 +
      y * (2300535178.0 + y * (18583304.74 + y * (99447.43394 + y * (376.9991397 + y))));
    return a1 / a2;
  }
  const z = 8 / ax;
  const y = z * z;
  const xx = ax - 2.356194491;
  const a1 =
    1 + y * (0.183105e-2 + y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * -0.240337019e-6)));
  const a2 =
    0.04687499995 +
    y * (-0.2002690873e-3 + y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
  const ans = Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * a1 - z * Math.sin(xx) * a2);
  return x < 0 ? -ans : ans;
}

/** J_n by upward recurrence when x > n, otherwise Miller's downward recurrence. */
function besselJ(x: number, n: number): number {
  if (n === 0) return besselJ0(x);
  if (n === 1) return besselJ1(x);
  const ax = Math.abs(x);
  if (ax === 0) return 0;
  const tox = 2 / ax;
  let ans: number;
  if (ax > n) {
    let bjm = besselJ0(ax);
    let bj = besselJ1(ax);
    for (let j = 1; j < n; j++) {
      const bjp = j * tox * bj - bjm;
      bjm = bj;
      bj = bjp;
    }
    ans = bj;
  } else {
    const m = 2 * Math.trunc((n + Math.trunc(Math.sqrt(ACC * n))) / 2);
    let even = false;
    let bjp = 0;
    let sum = 0;
    let bj = 1;
    ans = 0;
    for (let j = m; j > 0; j--) {
      const bjm = j * tox * bj - bjp;
      bjp = bj;
      bj = bjm;
      if (Math.abs(bj) > BIGNO) {
        bj *= BIGNI;
        bjp *= BIGNI;
        ans *= BIGNI;
        sum *= BIGNI;
      }
      if (even) sum += bj;
      even = !even;
      if (j === n) ans = bjp;
    }
    ans /= 2 * sum - bj;
  }
  return x < 0 && n % 2 ? -ans : ans;
}

function besselK0(x: number): number {
  if (x <= 2) {
    const y = (x * x) / 4;
    return (
      -Math.log(x / 2) * besselI0(x) +
      (-0.57721566 +
        y *
          (0.4227842 +
            y *
              (0.23069756 + y * (0.0348859 + y * (0.00262698 + y * (0.0001075 + y * 0.0000074))))))
    );
  }
  const y = 2 / x;
  return (
    (Math.exp(-x) / Math.sqrt(x)) *
    (1.25331414 +
      y *
        (-0.07832358 +
          y *
            (0.02189568 +
              y * (-0.01062446 + y * (0.00587872 + y * (-0.0025154 + y * 0.00053208))))))
  );
}

function besselK1(x: number): number {
  if (x <= 2) {
    const y = (x * x) / 4;
    return (
      Math.log(x / 2) * besselI1(x) +
      (1 / x) *
        (1 +
          y *
            (0.15443144 +
              y *
                (-0.67278579 +
                  y * (-0.18156897 + y * (-0.01919402 + y * (-0.00110404 + y * -0.00004686))))))
    );
  }
  const y = 2 / x;
  return (
    (Math.exp(-x) / Math.sqrt(x)) *
    (1.25331414 +
      y *
        (0.23498619 +
          y *
            (-0.0365562 +
              y * (0.01504268 + y * (-0.00780353 + y * (0.00325614 + y * -0.00068245))))))
  );
}

function besselK(x: number, n: number): number {
  if (n === 0) return besselK0(x);
  if (n === 1) return besselK1(x);
  const tox = 2 / x;
  let bkm = besselK0(x);
  let bk = besselK1(x);
  for (let j = 1; j < n; j++) {
    const bkp = bkm + j * tox * bk;
    bkm = bk;
    bk = bkp;
  }
  return bk;
}

function besselY0(x: number): number {
  if (x < 8) {
    const y = x * x;
    const a1 =
      -2957821389.0 +
      y *
        (7062834065.0 +
          y * (-512359803.6 + y * (10879881.29 + y * (-86327.92757 + y * 228.4622733))));
    const a2 =
      40076544269.0 +
      y * (745249964.8 + y * (7189466.438 + y * (47447.2647 + y * (226.1030244 + y))));
    return a1 / a2 + 0.636619772 * besselJ0(x) * Math.log(x);
  }
  const z = 8 / x;
  const y = z * z;
  const xx = x - 0.785398164;
  const a1 =
    1 +
    y * (-0.1098628627e-2 + y * (0.2734510407e-4 + y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
  const a2 =
    -0.1562499995e-1 +
    y * (0.1430488765e-3 + y * (-0.6911147651e-5 + y * (0.7621095161e-6 + y * -0.934945152e-7)));
  return Math.sqrt(0.636619772 / x) * (Math.sin(xx) * a1 + z * Math.cos(xx) * a2);
}

function besselY1(x: number): number {
  if (x < 8) {
    const y = x * x;
    const a1 =
      x *
      (-0.4900604943e13 +
        y *
          (0.127527439e13 +
            y *
              (-0.5153438139e11 +
                y * (0.7349264551e9 + y * (-0.4237922726e7 + y * 0.8511937935e4)))));
    const a2 =
      0.249958057e14 +
      y *
        (0.4244419664e12 +
          y *
            (0.3733650367e10 +
              y * (0.2245904002e8 + y * (0.102042605e6 + y * (0.3549632885e3 + y)))));
    return a1 / a2 + 0.636619772 * (besselJ1(x) * Math.log(x) - 1 / x);
  }
  const z = 8 / x;
  const y = z * z;
  const xx = x - 2.356194491;
  const a1 =
    1 + y * (0.183105e-2 + y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * -0.240337019e-6)));
  const a2 =
    0.04687499995 +
    y * (-0.2002690873e-3 + y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
  return Math.sqrt(0.636619772 / x) * (Math.sin(xx) * a1 + z * Math.cos(xx) * a2);
}

function besselY(x: number, n: number): number {
  if (n === 0) return besselY0(x);
  if (n === 1) return besselY1(x);
  const tox = 2 / x;
  let bym = besselY0(x);
  let by = besselY1(x);
  for (let j = 1; j < n; j++) {
    const byp = j * tox * by - bym;
    bym = by;
    by = byp;
  }
  return by;
}

/** A BESSEL* function: order truncated and at least 0, x positive where `positive`, finite results only. */
function bessel(impl: (x: number, n: number) => number, positive: boolean): Fn {
  return scalar(([xItem, nItem]) => {
    const x = num(xItem ?? null);
    const n = int(nItem ?? null);
    if (n < 0 || (positive && x <= 0)) return NUM;
    const result = impl(x, n);
    return Number.isFinite(result) ? result : NUM;
  });
}

const BITS: Record<number, number> = { 2: 10, 8: 30, 16: 40 };

/** BIN2HEX and friends: through the signed value, so negatives keep their two's complement form. */
function changeRadix(
  value: Scalar | undefined,
  from: number,
  to: number,
  places: Scalar | undefined,
): Scalar {
  const n = fromRadix(value ?? null, from, BITS[from]!);
  return typeof n === "number" ? radix(n, to, places, BITS[to]!) : n;
}

export const ENGINEERING: Record<string, Fn> = {
  BESSELI: bessel(besselI, false),
  BESSELJ: bessel(besselJ, false),
  BESSELK: bessel(besselK, true),
  BESSELY: bessel(besselY, true),
  CONVERT: scalar(([valueItem, fromItem, toItem]) =>
    convert(num(valueItem ?? null), text(fromItem ?? ""), text(toItem ?? "")),
  ),
  DEC2BIN: scalar(([v, places]) => radix(v ?? null, 2, places, 10)),
  DEC2OCT: scalar(([v, places]) => radix(v ?? null, 8, places, 30)),
  DEC2HEX: scalar(([v, places]) => radix(v ?? null, 16, places, 40)),
  BIN2DEC: scalar(([v]) => fromRadix(v ?? null, 2, 10)),
  BIN2OCT: scalar(([v, places]) => changeRadix(v, 2, 8, places)),
  BIN2HEX: scalar(([v, places]) => changeRadix(v, 2, 16, places)),
  OCT2BIN: scalar(([v, places]) => changeRadix(v, 8, 2, places)),
  OCT2HEX: scalar(([v, places]) => changeRadix(v, 8, 16, places)),
  HEX2BIN: scalar(([v, places]) => changeRadix(v, 16, 2, places)),
  HEX2OCT: scalar(([v, places]) => changeRadix(v, 16, 8, places)),
  OCT2DEC: scalar(([v]) => fromRadix(v ?? null, 8, 30)),
  HEX2DEC: scalar(([v]) => fromRadix(v ?? null, 16, 40)),
  BITAND: scalar(([a, b]) => Number(bits(a) & bits(b))),
  BITOR: scalar(([a, b]) => Number(bits(a) | bits(b))),
  BITXOR: scalar(([a, b]) => Number(bits(a) ^ bits(b))),
  BITLSHIFT: scalar(([a, shift]) => bitShift(a, shift, 1)),
  BITRSHIFT: scalar(([a, shift]) => bitShift(a, shift, -1)),
  DELTA: scalar(([a, b]) => (num(a ?? null) === num(b ?? 0) ? 1 : 0)),
  GESTEP: scalar(([a, b]) => (num(a ?? null) >= num(b ?? 0) ? 1 : 0)),
  ERF: scalar(([lower, upper]) => {
    const a = num(lower ?? null);
    if (upper === undefined) return erf(a);
    return erf(num(upper)) - erf(a);
  }),
  "ERF.PRECISE": scalar(([x]) => erf(num(x ?? null))),
  ERFC: scalar(([x]) => erfcValue(num(x ?? null))),
  "ERFC.PRECISE": scalar(([x]) => erfcValue(num(x ?? null))),
};

/** erf near zero straight from its Taylor series, where 1 - erfc would lose digits. */
function erf(x: number): number {
  if (Math.abs(x) >= 0.5) return 1 - erfcValue(x);
  let term = x;
  let total = x;
  const x2 = x * x;
  for (let n = 1; n < 100; n++) {
    term *= -x2 / n;
    const add = term / (2 * n + 1);
    total += add;
    if (Math.abs(add) < 1e-17 * Math.abs(total)) break;
  }
  return (2 / Math.sqrt(Math.PI)) * total;
}

/** A BIT* operand: an integer from 0 to 2^48 - 1. */
function bits(value: Scalar | undefined): bigint {
  const n = num(value ?? null);
  if (!Number.isInteger(n) || n < 0 || n >= 2 ** 48) throw NUM;
  return BigInt(n);
}

/** BITLSHIFT by `shift` places (right when negative); the result must stay below 2^48. */
function bitShift(
  value: Scalar | undefined,
  places: Scalar | undefined,
  direction: 1 | -1,
): Scalar {
  const n = bits(value);
  const shift = direction * int(places ?? null);
  if (Math.abs(shift) > 53) return NUM;
  const out = shift >= 0 ? n << BigInt(shift) : n >> BigInt(-shift);
  return out >= 2n ** 48n ? NUM : Number(out);
}
