/**
 * Numerical kernels for the statistical distributions. They follow LibreOffice's interpr3/interpr6
 * algorithms (Lanczos gamma from Boost, continued fractions for the incomplete beta and gamma,
 * AS241 for the inverse normal, bracketed inverse quadratic interpolation for inverses), whose
 * results agree with Excel's to the last digit or two far more often than textbook formulas.
 */

const EPS = Number.EPSILON;
const DBL_MIN = 2.2250738585072014e-308;
const LOG_DBL_MAX = Math.log(Number.MAX_VALUE);
const LOG_DBL_MIN = Math.log(DBL_MIN);
export const MAX_GAMMA_ARGUMENT = 171.624376956302;

/** Neumaier summation with LibreOffice's one-value delay, so 0.1 + 0.2 - 0.3 comes out 0. */
export class KahanSum {
  private sum = 0;
  private error = 0;
  private mem = 0;

  constructor(first = 0) {
    this.sum = first;
  }

  add(x: number): this {
    if (x === 0) return this;
    if (!this.mem) {
      this.mem = x;
      return this;
    }
    const t = this.sum + this.mem;
    if (Math.abs(this.sum) >= Math.abs(this.mem)) this.error += this.sum - t + this.mem;
    else this.error += this.mem - t + this.sum;
    this.sum = t;
    this.mem = x;
    return this;
  }

  get(): number {
    const total = this.sum + this.error;
    if (!this.mem) return total;
    // The remembered value cancelling the rest is taken as exactly 0, as rtl::math::approxAdd does.
    if (
      ((this.mem < 0 && total > 0) || (total < 0 && this.mem > 0)) &&
      approxEqual(this.mem, -total)
    )
      return 0;
    const t = this.sum + this.mem;
    if (Math.abs(this.sum) >= Math.abs(this.mem)) this.error += this.sum - t + this.mem;
    else this.error += this.mem - t + this.sum;
    this.sum = t;
    this.mem = 0;
    return this.sum + this.error;
  }
}

function approxEqual(a: number, b: number): boolean {
  if (a === b) return true;
  if (a === 0 || b === 0) return false;
  const d = Math.abs(a - b);
  return d < Math.abs(a) * 2 ** -48 && d < Math.abs(b) * 2 ** -48;
}

/** sin(πx) that is exactly 0 for whole x. */
const sinPi = (x: number) => (Number.isInteger(x) ? 0 : Math.sin(Math.PI * x));

// ---------------------------------------------------------------------------------------------
// Gamma and beta functions

const LANCZOS_NUM = [
  23531376880.41076, 42919803642.6491, 35711959237.35567, 17921034426.03721, 6039542586.352028,
  1439720407.3117216, 248874557.86205417, 31426415.585400194, 2876370.6289353725,
  186056.26539522348, 8071.672002365816, 210.82427775157936, 2.5066282746310002,
];
const LANCZOS_DENOM = [
  0, 39916800, 120543840, 150917976, 105258076, 45995730, 13339535, 2637558, 357423, 32670, 1925,
  66, 1,
];
const LANCZOS_G = 6.02468004077673;

function lanczosSum(z: number): number {
  let num: number;
  let denom: number;
  if (z <= 1) {
    num = LANCZOS_NUM[12]!;
    denom = LANCZOS_DENOM[12]!;
    for (let i = 11; i >= 0; i--) {
      num = num * z + LANCZOS_NUM[i]!;
      denom = denom * z + LANCZOS_DENOM[i]!;
    }
  } else {
    const inv = 1 / z;
    num = LANCZOS_NUM[0]!;
    denom = LANCZOS_DENOM[0]!;
    for (let i = 1; i <= 12; i++) {
      num = num * inv + LANCZOS_NUM[i]!;
      denom = denom * inv + LANCZOS_DENOM[i]!;
    }
  }
  return num / denom;
}

function gammaHelper(z: number): number {
  let gamma = lanczosSum(z);
  const zg = z + LANCZOS_G - 0.5;
  const half = zg ** (z / 2 - 0.25);
  gamma *= half;
  gamma /= Math.exp(zg);
  gamma *= half;
  if (z <= 20 && Number.isInteger(z)) gamma = Math.round(gamma);
  return gamma;
}

function logGammaHelper(z: number): number {
  const zg = z + LANCZOS_G - 0.5;
  return Math.log(lanczosSum(z)) + (z - 0.5) * Math.log(zg) - zg;
}

/** Γ(z); NaN where it overflows (callers turn that into #NUM!). z must not be 0 or a negative whole number. */
export function gamma(z: number): number {
  if (z > MAX_GAMMA_ARGUMENT) return NaN;
  if (z >= 1) return gammaHelper(z);
  if (z >= 0.5) return gammaHelper(z + 1) / z;
  if (z >= -0.5) {
    const logTest = logGammaHelper(z + 2) - Math.log1p(z) - Math.log(Math.abs(z));
    if (logTest >= LOG_DBL_MAX) return NaN;
    return gammaHelper(z + 2) / (z + 1) / z;
  }
  const logDivisor = logGammaHelper(1 - z) + Math.log(Math.abs(sinPi(z)));
  if (logDivisor - Math.log(Math.PI) >= LOG_DBL_MAX) return 0;
  if (logDivisor < 0 && Math.log(Math.PI) - logDivisor > LOG_DBL_MAX) return NaN;
  return Math.exp(Math.log(Math.PI) - logDivisor) * (sinPi(z) < 0 ? -1 : 1);
}

/** ln Γ(z) for z > 0. */
export function logGamma(z: number): number {
  if (z >= MAX_GAMMA_ARGUMENT) return logGammaHelper(z);
  if (z >= 1) return Math.log(gammaHelper(z));
  if (z >= 0.5) return Math.log(gammaHelper(z + 1) / z);
  return logGammaHelper(z + 2) - Math.log1p(z) - Math.log(z);
}

export function beta(alpha: number, b: number): number {
  const [fA, fB] = alpha > b ? [alpha, b] : [b, alpha];
  if (fA + fB < MAX_GAMMA_ARGUMENT) return (gamma(fA) / gamma(fA + fB)) * gamma(fB);
  const gm = LANCZOS_G - 0.5;
  let lanczos = lanczosSum(fA);
  lanczos /= lanczosSum(fA + fB);
  lanczos *= lanczosSum(fB);
  const abgm = fA + fB + gm;
  lanczos *= Math.sqrt(abgm / (fA + gm) / (fB + gm));
  const tempA = fB / (fA + gm);
  const tempB = fA / (fB + gm);
  return Math.exp(-fA * Math.log1p(tempA) - fB * Math.log1p(tempB) - gm) * lanczos;
}

export function logBeta(alpha: number, b: number): number {
  const [fA, fB] = alpha > b ? [alpha, b] : [b, alpha];
  const gm = LANCZOS_G - 0.5;
  let lanczos = lanczosSum(fA);
  lanczos /= lanczosSum(fA + fB);
  lanczos *= lanczosSum(fB);
  let logLanczos = Math.log(lanczos);
  const abgm = fA + fB + gm;
  logLanczos += 0.5 * (Math.log(abgm) - Math.log(fA + gm) - Math.log(fB + gm));
  const tempA = fB / (fA + gm);
  const tempB = fA / (fB + gm);
  return -fA * Math.log1p(tempA) - fB * Math.log1p(tempB) - gm + logLanczos;
}

/** Beta density on [0, 1]; NaN where it is infinite. */
export function betaPdf(x: number, a: number, b: number): number {
  if (a === 1) {
    if (b === 1) return 1;
    if (b === 2) return -2 * x + 2;
    if (x === 1 && b < 1) return NaN;
    if (x <= 0.01) return b + b * Math.expm1((b - 1) * Math.log1p(-x));
    return b * (0.5 - x + 0.5) ** (b - 1);
  }
  if (b === 1) {
    if (a === 2) return a * x;
    if (x === 0 && a < 1) return NaN;
    return a * x ** (a - 1);
  }
  if (x <= 0) return a < 1 && x === 0 ? NaN : 0;
  if (x >= 1) return b < 1 && x === 1 ? NaN : 0;
  const logY = x < 0.1 ? Math.log1p(-x) : Math.log(0.5 - x + 0.5);
  const logX = Math.log(x);
  const am1LogX = (a - 1) * logX;
  const bm1LogY = (b - 1) * logY;
  const lb = logBeta(a, b);
  if (
    am1LogX < LOG_DBL_MAX &&
    am1LogX > LOG_DBL_MIN &&
    bm1LogY < LOG_DBL_MAX &&
    bm1LogY > LOG_DBL_MIN &&
    lb < LOG_DBL_MAX &&
    lb > LOG_DBL_MIN &&
    am1LogX + bm1LogY < LOG_DBL_MAX &&
    am1LogX + bm1LogY > LOG_DBL_MIN
  )
    return (x ** (a - 1) * (0.5 - x + 0.5) ** (b - 1)) / beta(a, b);
  return Math.exp(am1LogX + bm1LogY - lb);
}

/** Regularised incomplete beta I_x(α, β). */
export function betaDist(x: number, alpha: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return ddIncompleteBeta(new DD(x), new DD(1).sub(x), alpha, b)[0].value;
}

// ---------------------------------------------------------------------------------------------
// Incomplete gamma

/** Regularised lower incomplete gamma P(a, x), a > 0, x > 0. */
export const lowRegIGamma = (a: number, x: number) => ddIncompleteGamma(a, new DD(x))[0].value;

/** Regularised upper incomplete gamma Q(a, x), a > 0, x > 0. */
export const upRegIGamma = (a: number, x: number) => ddIncompleteGamma(a, new DD(x))[1].value;

/** Gamma density with shape α and scale λ; NaN at 0 when α < 1. */
export function gammaPdf(x: number, alpha: number, lambda: number): number {
  if (x < 0) return 0;
  if (x === 0) return alpha < 1 ? NaN : alpha === 1 ? 1 / lambda : 0;
  const xr = x / lambda;
  if (xr > 1) {
    if (Math.log(xr) * (alpha - 1) < LOG_DBL_MAX && alpha < MAX_GAMMA_ARGUMENT)
      return (xr ** (alpha - 1) * Math.exp(-xr)) / lambda / gamma(alpha);
    return Math.exp((alpha - 1) * Math.log(xr) - xr - Math.log(lambda) - logGamma(alpha));
  }
  if (alpha < MAX_GAMMA_ARGUMENT)
    return (xr ** (alpha - 1) * Math.exp(-xr)) / lambda / gamma(alpha);
  return (xr ** (alpha - 1) * Math.exp(-xr)) / lambda / Math.exp(logGamma(alpha));
}

export const gammaCdf = (x: number, alpha: number, lambda: number) =>
  x <= 0 ? 0 : ddIncompleteGamma(alpha, new DD(x).div(lambda))[0].value;

// ---------------------------------------------------------------------------------------------
// Chi-squared, t and F

/** Right tail of chi-squared. */
export const chiDist = (x: number, df: number) => (x <= 0 ? 1 : upRegIGamma(df / 2, x / 2));
export const chiSqCdf = (x: number, df: number) => (x <= 0 ? 0 : lowRegIGamma(df / 2, x / 2));

export function chiSqPdf(x: number, df: number): number {
  if (x <= 0) return 0;
  if (df * x > 1391000)
    return Math.exp(
      (0.5 * df - 1) * Math.log(x * 0.5) - 0.5 * x - Math.log(2) - logGamma(0.5 * df),
    );
  let value: number;
  let count: number;
  if (df % 2 < 0.5) {
    value = 0.5;
    count = 2;
  } else {
    value = 1 / Math.sqrt(x * 2 * Math.PI);
    count = 1;
  }
  while (count < df) {
    value *= x / count;
    count += 2;
  }
  if (x >= 1425) return Math.exp(Math.log(value) - x / 2);
  return value * Math.exp(-x / 2);
}

/** t distribution: 1 right tail, 2 both tails, 3 density, 4 left-tail cumulative. */
export function tDist(t: number, df: number, type: 1 | 2 | 3 | 4): number {
  if (type === 3)
    return (1 + (t * t) / df) ** (-(df + 1) / 2) / (Math.sqrt(df) * beta(0.5, df / 2));
  // Excel rounds the beta argument to a double; an exact argument drifts from its results.
  const x = df / (df + t * t);
  const [both, inside] = ddIncompleteBeta(new DD(x), new DD(1).sub(x), df / 2, 0.5);
  if (type === 2) return both.value;
  if (type === 1 || t < 0) return both.mul(0.5).value;
  return inside.add(1).mul(0.5).value;
}

/**
 * F distribution as [left, right] tails. F.DIST rounds the beta argument to a double as in
 * tDist, while F.INV matches Excel only when inverting the `exact` argument.
 */
export function fTails(x: number, f1: number, f2: number, exact = false): [number, number] {
  let z: DD;
  if (exact) {
    const scaled = new DD(f1).mul(x);
    z = new DD(f2).div(scaled.add(f2));
  } else z = new DD(f2 / (f2 + f1 * x));
  const [right, left] = ddIncompleteBeta(z, new DD(1).sub(z), f2 / 2, f1 / 2);
  return [left.value, right.value];
}

/** Right tail of F. */
export const fDist = (x: number, f1: number, f2: number) => fTails(x, f1, f2)[1];

// ---------------------------------------------------------------------------------------------
// Normal

export const phi = (x: number) => 0.3989422804014327 * Math.exp(-(x * x) / 2);

/** erfc to full double precision: Taylor series near zero, continued fraction beyond. */
export function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  if (x < 2) return 1 - erfSeries(x);
  const tiny = 1e-300;
  let f = x;
  let c = x;
  let d = 0;
  for (let n = 1; n < 500; n++) {
    const a = n / 2;
    d = x + a * d;
    d = Math.abs(d) < tiny ? tiny : d;
    c = x + a / c;
    c = Math.abs(c) < tiny ? tiny : c;
    d = 1 / d;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / (f * Math.sqrt(Math.PI));
}

function erfSeries(x: number): number {
  let term = x;
  let total = x;
  const x2 = x * x;
  for (let n = 1; n < 200; n++) {
    term *= -x2 / n;
    const add = term / (2 * n + 1);
    total += add;
    if (Math.abs(add) < 1e-17 * Math.abs(total)) break;
  }
  return (2 / Math.sqrt(Math.PI)) * total;
}

const PHI_C = [
  0.39894151208813466, 8.883149794388377, 93.50665613217785, 597.2702763948002, 2494.5375852903726,
  6848.190450536283, 11602.65143764735, 9842.714838383978, 1.0765576773720192e-8,
];
const PHI_D = [
  22.266688044328117, 235.387901782625, 1519.3775994075547, 6485.558298266761, 18615.571640885097,
  34900.95272114598, 38912.00328609327, 19685.429676859992,
];
const PHI_P = [
  0.215898534057957, 0.12740116116024736, 0.022235277870649807, 0.0014216191932278934,
  0.000029112874951168793, 0.023073441764940174,
];
const PHI_Q = [
  1.284260096144911, 0.4682382124808651, 0.06598813786892856, 0.0037823963320275824,
  0.00007297515550839662,
];

/** Φ(x) − 0.5 near zero as φ(x)·Σ x^(2n+1)/(2n+1)!!, in double-double so Φ rounds correctly. */
function centralPhi(x: number): DD {
  const xsq = new DD(x).mul(x);
  let term = new DD(x);
  let total = term;
  for (let n = 1; n < 100 && Math.abs(term.hi) > Math.abs(total.hi) * 1e-33; n++) {
    term = term.mul(xsq).div(2 * n + 1);
    total = total.add(term);
  }
  return total.mul(ddExp(xsq.mul(-0.5).sub(DD_HALF_LOG_2PI)));
}

/** The smaller tail, Φ(−|x|), with exp(−x²/2) split so it keeps full precision. */
function tailPhi(y: number): number {
  let temp: number;
  if (y <= Math.sqrt(32)) {
    let xnum = PHI_C[8]! * y;
    let xden = y;
    for (let i = 0; i < 7; i++) {
      xnum = (xnum + PHI_C[i]!) * y;
      xden = (xden + PHI_D[i]!) * y;
    }
    temp = (xnum + PHI_C[7]!) / (xden + PHI_D[7]!);
  } else {
    const xsq = 1 / (y * y);
    let xnum = PHI_P[5]! * xsq;
    let xden = xsq;
    for (let i = 0; i < 4; i++) {
      xnum = (xnum + PHI_P[i]!) * xsq;
      xden = (xden + PHI_Q[i]!) * xsq;
    }
    temp = (0.3989422804014327 - (xsq * (xnum + PHI_P[4]!)) / (xden + PHI_Q[4]!)) / y;
  }
  const xsq = Math.trunc(y * 16) / 16;
  const del = (y - xsq) * (y + xsq);
  return Math.exp(-xsq * xsq * 0.5) * Math.exp(-del * 0.5) * temp;
}

/** Φ(x), the standard normal cumulative distribution (Cody's rational approximations). */
export function integralPhi(x: number): number {
  if (Math.abs(x) <= 0.67448975) return centralPhi(x).add(0.5).value;
  const tail = tailPhi(Math.abs(x));
  return x > 0 ? 1 - tail : tail;
}

/** 1 − Φ(x) without cancellation. */
export function upperPhi(x: number): number {
  if (Math.abs(x) <= 0.67448975) return centralPhi(x).neg().add(0.5).value;
  const tail = tailPhi(Math.abs(x));
  return x > 0 ? tail : 1 - tail;
}

/** Φ(x) − 0.5, as GAUSS returns it. */
export function gauss(x: number): number {
  return Math.abs(x) <= 0.67448975 ? centralPhi(x).value : integralPhi(x) - 0.5;
}

/** Inverse standard normal, Wichura's AS241 (PPND16). */
export function gaussInv(x: number): number {
  const q = x - 0.5;
  let t: number;
  let z: number;
  if (Math.abs(q) <= 0.425) {
    t = 0.180625 - q * q;
    z =
      (q *
        (((((((t * 2509.0809287301227 + 33430.57558358813) * t + 67265.7709270087) * t +
          45921.95393154987) *
          t +
          13731.69376550946) *
          t +
          1971.5909503065513) *
          t +
          133.14166789178438) *
          t +
          3.3871328727963665)) /
      (((((((t * 5226.495278852854 + 28729.085735721943) * t + 39307.89580009271) * t +
        21213.794301586597) *
        t +
        5394.196021424751) *
        t +
        687.1870074920579) *
        t +
        42.31333070160091) *
        t +
        1);
    return z;
  }
  t = q > 0 ? 1 - x : x;
  t = Math.sqrt(-Math.log(t));
  if (t <= 5) {
    t += -1.6;
    z =
      (((((((t * 0.0007745450142783414 + 0.022723844989269184) * t + 0.2417807251774506) * t +
        1.2704582524523684) *
        t +
        3.6478483247632045) *
        t +
        5.769497221460691) *
        t +
        4.630337846156546) *
        t +
        1.4234371107496835) /
      (((((((t * 1.0507500716444169e-9 + 0.0005475938084995345) * t + 0.015198666563616457) * t +
        0.14810397642748008) *
        t +
        0.6897673349851) *
        t +
        1.6763848301838038) *
        t +
        2.053191626637759) *
        t +
        1);
  } else {
    t += -5;
    z =
      (((((((t * 2.0103343992922881e-7 + 0.000027115555687434876) * t + 0.0012426609473880784) * t +
        0.026532189526576124) *
        t +
        0.29656057182850487) *
        t +
        1.7848265399172913) *
        t +
        5.463784911164114) *
        t +
        6.657904643501103) /
      (((((((t * 2.0442631033899397e-15 + 1.421511758316446e-7) * t + 0.000018463183175100548) * t +
        0.0007868691311456133) *
        t +
        0.014875361290850615) *
        t +
        0.1369298809227358) *
        t +
        0.599832206555888) *
        t +
        1);
  }
  return q < 0 ? -z : z;
}

// ---------------------------------------------------------------------------------------------
// Inverses

const changesSign = (u: number, w: number) => (u < 0 && w > 0) || (u > 0 && w < 0);

/**
 * A root of `f` (an inverse distribution's p − cdf(x)) from the bracket [ax, bx], widened as
 * needed, then inverse quadratic interpolation with bisection fallback. NaN when no sign change.
 */
export function iterateInverse(f: (x: number) => number, ax: number, bx: number): number {
  const yEps = 1e-307;
  const xEps = EPS;
  let ay = f(ax);
  let by = f(bx);
  for (let n = 0; n < 1000 && !changesSign(ay, by); n++) {
    if (Math.abs(ay) <= Math.abs(by)) {
      const temp = ax;
      ax = new KahanSum(ax).add((ax - bx) * 2).get();
      if (ax < 0) ax = 0;
      bx = temp;
      by = ay;
      ay = f(ax);
    } else {
      const temp = bx;
      bx = new KahanSum(bx).add((bx - ax) * 2).get();
      ax = temp;
      ay = by;
      by = f(bx);
    }
  }
  if (ay === 0) return ax;
  if (by === 0) return bx;
  if (!changesSign(ay, by)) return NaN;
  let px = ax;
  let py = ay;
  let qx = bx;
  let qy = by;
  let rx = ax;
  let ry = ay;
  let sx = 0.5 * (ax + bx);
  let interpolate = true;
  for (
    let n = 0;
    n < 500 && Math.abs(ry) > yEps && bx - ax > Math.max(Math.abs(ax), Math.abs(bx)) * xEps;
    n++
  ) {
    if (interpolate) {
      if (py !== qy && qy !== ry && ry !== py) {
        sx =
          (px * ry * qy) / (ry - py) / (qy - py) +
          (rx * qy * py) / (qy - ry) / (py - ry) +
          (qx * py * ry) / (py - qy) / (ry - qy);
        interpolate = ax < sx && sx < bx;
      } else interpolate = false;
    }
    if (!interpolate) {
      sx = 0.5 * (ax + bx);
      qx = bx;
      qy = by;
      interpolate = true;
    }
    px = qx;
    qx = rx;
    rx = sx;
    py = qy;
    qy = ry;
    ry = f(sx);
    if (changesSign(ay, ry)) {
      bx = rx;
      by = ry;
    } else {
      ax = rx;
      ay = ry;
    }
    interpolate = interpolate && Math.abs(ry) * 2 <= Math.abs(qy);
  }
  return rx;
}

// ---------------------------------------------------------------------------------------------
// Discrete distributions

/** Binomial probability of exactly x successes; 0 ≤ x ≤ n, 0 < p < 1. */
export function binomPmf(x: number, n: number, p: number): number {
  const q = 0.5 - p + 0.5;
  let factor = q ** n;
  if (factor <= DBL_MIN) {
    factor = p ** n;
    if (factor <= DBL_MIN) return betaPdf(p, x + 1, n - x + 1) / (n + 1);
    const max = n - x;
    for (let i = 0; i < max && factor > 0; i++) factor *= ((n - i) / (i + 1)) * (q / p);
    return factor;
  }
  for (let i = 0; i < x && factor > 0; i++) factor *= ((n - i) / (i + 1)) * (p / q);
  return factor;
}

/** Σ binomial probabilities from xs to xe, starting from factor = q^n. */
export function binomRange(
  n: number,
  xs: number,
  xe: number,
  factor: number,
  p: number,
  q: number,
): number {
  let i: number;
  for (i = 1; i <= xs && factor > 0; i++) factor *= ((n - i + 1) / i) * (p / q);
  const sum = new KahanSum(factor);
  for (i = xs + 1; i <= xe && factor > 0; i++) {
    factor *= ((n - i + 1) / i) * (p / q);
    sum.add(factor);
  }
  return Math.min(sum.get(), 1);
}

/** Binomial cumulative probability of at most x successes; 0 ≤ x ≤ n, 0 < p < 1. */
export function binomCdf(x: number, n: number, p: number): number {
  if (x >= n) return 1;
  return ddIncompleteBeta(new DD(1).sub(p), new DD(p), n - x, x + 1)[0].value;
}

function putFactorialElements(out: number[], lower: number, upper: number, base: number) {
  for (let i = lower; i <= upper; i++) {
    const value = base - i;
    if (value > 1) out.push(value);
  }
}

/** Hypergeometric probability of x successes in a sample of n from N holding M successes. */
export function hypGeom(x: number, n: number, M: number, N: number): number {
  const numer: number[] = [];
  const denom: number[] = [];
  let cNumVarUpper = N - n - M + x - 1;
  let cDenomVarLower = 1;
  if (N - n - M + x >= M - x + 1) {
    cNumVarUpper = M - x - 1;
    cDenomVarLower = N - n - 2 * (M - x) + 1;
  }
  let cDenomUpper = N - n - M + x + 1 - cDenomVarLower;
  let dNumVarLower = n - M;
  if (n >= M + 1) {
    if (N - M < n + 1) {
      if (N - n < n + 1) {
        putFactorialElements(numer, 0, cNumVarUpper, N - n);
        putFactorialElements(denom, 0, N - n - 1, N);
      } else {
        putFactorialElements(numer, N - 2 * n, cNumVarUpper, N - n);
        putFactorialElements(denom, 0, n - 1, N);
      }
      if (cDenomUpper < n - x + 1) putFactorialElements(numer, 1, N - M - n + x, N - M + 1);
      else {
        putFactorialElements(numer, 1, N - M - cDenomUpper, N - M + 1);
        cDenomUpper = n - x;
        cDenomVarLower = N - M - 2 * (n - x) + 1;
      }
    } else {
      if (n > M - 1) {
        putFactorialElements(numer, 0, cNumVarUpper, N - n);
        putFactorialElements(denom, 0, M - 1, N);
      } else {
        putFactorialElements(numer, M - n, cNumVarUpper, N - n);
        putFactorialElements(denom, 0, n - 1, N);
      }
      if (cDenomUpper < n - x + 1)
        putFactorialElements(numer, N - M - n + 1, N - M - n + x, N - M + 1);
      else {
        putFactorialElements(numer, N - M - n + 1, N - M - cDenomUpper, N - M + 1);
        cDenomUpper = n - x;
        cDenomVarLower = N - M - 2 * (n - x) + 1;
      }
    }
  } else {
    if (N - M < M + 1) {
      if (N - n < M + 1) {
        putFactorialElements(numer, 0, cNumVarUpper, N - n);
        putFactorialElements(denom, 0, N - M - 1, N);
      } else {
        putFactorialElements(numer, N - n - M, cNumVarUpper, N - n);
        putFactorialElements(denom, 0, n - 1, N);
      }
      if (n - x + 1 > cDenomUpper) putFactorialElements(numer, 1, N - M - n + x, N - M + 1);
      else {
        putFactorialElements(numer, 1, N - M - cDenomUpper, N - M + 1);
        cDenomVarLower = N - M - 2 * (n - x) + 1;
        cDenomUpper = n - x;
      }
    } else {
      if (N - n < N - M + 1) {
        putFactorialElements(numer, 0, cNumVarUpper, N - n);
        putFactorialElements(denom, 0, M - 1, N);
      } else {
        putFactorialElements(numer, M - n, cNumVarUpper, N - n);
        putFactorialElements(denom, 0, n - 1, N);
      }
      if (n - x + 1 > cDenomUpper)
        putFactorialElements(numer, N - 2 * M + 1, N - M - n + x, N - M + 1);
      else if (M >= cDenomUpper) {
        putFactorialElements(numer, N - 2 * M + 1, N - M - cDenomUpper, N - M + 1);
        cDenomUpper = n - x;
        cDenomVarLower = N - M - 2 * (n - x) + 1;
      } else {
        putFactorialElements(denom, cDenomVarLower, N - n - 2 * M + x, N - n - M + x + 1);
        cDenomUpper = n - x;
        cDenomVarLower = N - M - 2 * (n - x) + 1;
      }
    }
    dNumVarLower = 0;
  }
  const dNumVarUpper = cDenomUpper < x + 1 ? n - x - 1 : n - cDenomUpper - 1;
  const dDenomVarLower = cDenomUpper < x + 1 ? cDenomVarLower : N - n - M + 1;
  putFactorialElements(numer, dNumVarLower, dNumVarUpper, n);
  putFactorialElements(denom, dDenomVarLower, N - n - M + x, N - n - M + x + 1);
  numer.sort((a, b) => b - a);
  denom.sort((a, b) => b - a);
  let factor = 1;
  for (let i = 0; i < Math.max(numer.length, denom.length); i++)
    factor *= (numer[i] ?? 1) / (denom[i] ?? 1);
  return factor;
}

// ---------------------------------------------------------------------------------------------
// Double-double arithmetic (about 32 digits), so the cumulative distributions round correctly

/** hi + lo with |lo| ≤ ulp(hi) / 2. */
export class DD {
  constructor(
    readonly hi: number,
    readonly lo = 0,
  ) {}

  get value(): number {
    return this.hi + this.lo;
  }

  add(b: DD | number): DD {
    const other = typeof b === "number" ? new DD(b) : b;
    const [s, e] = twoSum(this.hi, other.hi);
    const [t, f] = twoSum(this.lo, other.lo);
    const [s2, e2] = quickTwoSum(s, e + t);
    return renormal(s2, e2 + f);
  }

  sub(b: DD | number): DD {
    return this.add(typeof b === "number" ? new DD(-b) : new DD(-b.hi, -b.lo));
  }

  mul(b: DD | number): DD {
    const other = typeof b === "number" ? new DD(b) : b;
    const [p, e] = twoProd(this.hi, other.hi);
    return renormal(p, e + (this.hi * other.lo + this.lo * other.hi));
  }

  div(b: DD | number): DD {
    const other = typeof b === "number" ? new DD(b) : b;
    const q1 = this.hi / other.hi;
    let r = this.sub(other.mul(q1));
    const q2 = r.hi / other.hi;
    r = r.sub(other.mul(q2));
    const q3 = r.hi / other.hi;
    return renormal(q1, q2).add(q3);
  }

  neg(): DD {
    return new DD(-this.hi, -this.lo);
  }
}

function twoSum(a: number, b: number): [number, number] {
  const s = a + b;
  const bb = s - a;
  return [s, a - (s - bb) + (b - bb)];
}

function quickTwoSum(a: number, b: number): [number, number] {
  const s = a + b;
  return [s, b - (s - a)];
}

function renormal(a: number, b: number): DD {
  const [s, e] = quickTwoSum(a, b);
  return new DD(s, e);
}

function split(a: number): [number, number] {
  const t = 134217729 * a;
  const hi = t - (t - a);
  return [hi, a - hi];
}

function twoProd(a: number, b: number): [number, number] {
  const p = a * b;
  if (!Number.isFinite(p)) return [p, 0];
  const [ah, al] = Math.abs(a) > 1e300 ? [a, 0] : split(a);
  const [bh, bl] = Math.abs(b) > 1e300 ? [b, 0] : split(b);
  return [p, ah * bh - p + ah * bl + al * bh + al * bl];
}

const DD_LN2 = new DD(Math.LN2, 2.3190468138462996e-17);
const DD_HALF_LOG_2PI = new DD(0.9189385332046728, -3.8782941580672414e-17);

export function ddExp(x: DD): DD {
  if (x.hi > 709.78) return new DD(Infinity);
  if (x.hi < -745.2) return new DD(0);
  const k = Math.round(x.hi / DD_LN2.hi);
  const r = x.sub(DD_LN2.mul(k)).div(1024);
  let term = new DD(1);
  let total = new DD(1);
  for (let i = 1; i < 30; i++) {
    term = term.mul(r).div(i);
    total = total.add(term);
    if (Math.abs(term.hi) < 1e-34) break;
  }
  for (let i = 0; i < 10; i++) total = total.mul(total);
  // Scale in two steps so 2^k for k near the exponent limits neither overflows nor flushes to 0.
  const half = Math.trunc(k / 2);
  return total.mul(2 ** half).mul(2 ** (k - half));
}

export function ddLog(x: DD): DD {
  let y = new DD(Math.log(x.hi));
  for (let i = 0; i < 2; i++) y = y.add(x.mul(ddExp(y.neg())).sub(1));
  return y;
}

const STIRLING = [
  [1, 6],
  [-1, 30],
  [1, 42],
  [-1, 30],
  [5, 66],
  [-691, 2730],
  [7, 6],
  [-3617, 510],
  [43867, 798],
  [-174611, 330],
  [854513, 138],
  [-236364091, 2730],
  [8553103, 6],
  [-23749461029, 870],
  [8615841276005, 14322],
].map(([num, den], i) => new DD(num!).div(den! * (2 * i + 2) * (2 * i + 1)));

/** ln Γ(z) for z > 0. */
export function ddLogGamma(z: number): DD {
  let shift = new DD(1);
  let zz = new DD(z);
  while (zz.hi < 25) {
    shift = shift.mul(zz);
    zz = zz.add(1);
  }
  const inverse = new DD(1).div(zz);
  const inverse2 = inverse.mul(inverse);
  let series = new DD(0);
  let power = inverse;
  for (const c of STIRLING) {
    series = series.add(c.mul(power));
    power = power.mul(inverse2);
  }
  const result = zz.sub(0.5).mul(ddLog(zz)).sub(zz).add(DD_HALF_LOG_2PI).add(series);
  return shift.hi === 1 && shift.lo === 0 ? result : result.sub(ddLog(shift));
}

/** Regularised incomplete gamma as [P(a, x), Q(a, x)], a > 0, x > 0. */
export function ddIncompleteGamma(a: number, x: DD): [DD, DD] {
  const prefix = ddExp(ddLog(x).mul(a).sub(x).sub(ddLogGamma(a)));
  if (x.hi < a + 1) {
    let term = new DD(1);
    let total = new DD(1);
    for (let n = 1; n < 100000; n++) {
      term = term.mul(x).div(a + n);
      total = total.add(term);
      if (Math.abs(term.hi) < Math.abs(total.hi) * 1e-33) break;
    }
    const p = prefix.mul(total).div(a);
    return [p, new DD(1).sub(p)];
  }
  const tiny = 1e-300;
  let b = x.add(1 - a);
  let c = new DD(1 / tiny);
  let d = new DD(1).div(b);
  let h = d;
  for (let i = 1; i < 100000; i++) {
    const an = new DD(-i).mul(i - a);
    b = b.add(2);
    d = an.mul(d).add(b);
    if (Math.abs(d.hi) < tiny) d = new DD(tiny);
    c = b.add(an.div(c));
    if (Math.abs(c.hi) < tiny) c = new DD(tiny);
    d = new DD(1).div(d);
    const delta = d.mul(c);
    h = h.mul(delta);
    if (Math.abs(delta.hi - 1) + Math.abs(delta.lo) < 1e-32) break;
  }
  const q = prefix.mul(h);
  return [new DD(1).sub(q), q];
}

/** Regularised incomplete beta as [I_x(a, b), 1 − I_x(a, b)], with y = 1 − x given exactly. */
export function ddIncompleteBeta(x: DD, y: DD, a: number, b: number): [DD, DD] {
  if (x.hi <= 0) return [new DD(0), new DD(1)];
  if (y.hi <= 0) return [new DD(1), new DD(0)];
  if (x.hi > (a + 1) / (a + b + 2)) {
    const [p, q] = ddIncompleteBeta(y, x, b, a);
    return [q, p];
  }
  const logBetaAB = ddLogGamma(a)
    .add(ddLogGamma(b))
    .sub(ddLogGamma(a + b));
  const prefix = ddExp(ddLog(x).mul(a).add(ddLog(y).mul(b)).sub(logBetaAB)).div(a);
  const tiny = 1e-300;
  let c = new DD(1);
  let d = new DD(1).sub(x.mul(a + b).div(a + 1));
  if (Math.abs(d.hi) < tiny) d = new DD(tiny);
  d = new DD(1).div(d);
  let h = d;
  for (let m = 1; m < 100000; m++) {
    const m2 = 2 * m;
    for (const coefficient of [
      x.mul(m * (b - m)).div((a + m2 - 1) * (a + m2)),
      x.mul(-(a + m) * (a + b + m)).div((a + m2) * (a + m2 + 1)),
    ]) {
      d = new DD(1).add(coefficient.mul(d));
      if (Math.abs(d.hi) < tiny) d = new DD(tiny);
      c = new DD(1).add(coefficient.div(c));
      if (Math.abs(c.hi) < tiny) c = new DD(tiny);
      d = new DD(1).div(d);
      h = h.mul(d).mul(c);
    }
    const last = d.mul(c);
    if (Math.abs(last.hi - 1) + Math.abs(last.lo) < 1e-32) break;
  }
  const p = prefix.mul(h);
  return [p, new DD(1).sub(p)];
}
