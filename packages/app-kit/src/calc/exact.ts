/**
 * Excel's last digit for exp, log and powers.
 *
 * Excel for Windows works these out the way the processor's floating-point unit does: in its
 * 64-bit extended precision, storing the result as a double afterwards. The result is therefore
 * rounded twice (to 64 bits, then to 53), and e^x is 2^(x·log2 e) with the product rounded to 64
 * bits. JavaScript's Math.exp and Math.log round once and may also be a unit out, which formulas
 * such as 1-EXP(-x) magnify into visible differences. Everything here is computed in double-double
 * arithmetic (about 32 significant digits) and then rounded the way Excel's result is.
 */

type DD = [number, number];

const SPLIT = 134217729; // 2^27 + 1

function twoSum(a: number, b: number): DD {
  const s = a + b;
  const v = s - a;
  return [s, a - (s - v) + (b - v)];
}

function twoProd(a: number, b: number): DD {
  const p = a * b;
  const ca = SPLIT * a;
  const ah = ca - (ca - a);
  const al = a - ah;
  const cb = SPLIT * b;
  const bh = cb - (cb - b);
  const bl = b - bh;
  return [p, ah * bh - p + ah * bl + al * bh + al * bl];
}

function add([ah, al]: DD, [bh, bl]: DD): DD {
  const [s, e] = twoSum(ah, bh);
  const [h, l] = twoSum(s, e + al + bl);
  return [h, l];
}

function mul([ah, al]: DD, [bh, bl]: DD): DD {
  const [p, e] = twoProd(ah, bh);
  return twoSum(p, e + ah * bl + al * bh);
}

const LN2: DD = [Math.LN2, 2.3190468138462996e-17];
/** log2(e) as the floating-point unit holds it: rounded to 64 bits, here exactly as two doubles. */
const LOG2E_64: DD = [Math.LOG2E, 2.0383000842727483e-17];

const FLOAT = new Float64Array(1);
const WORDS = new Uint32Array(FLOAT.buffer);

/** The gap between a normal double and the next one away from zero. */
function ulp(x: number): number {
  FLOAT[0] = x;
  return 2 ** (((WORDS[1]! >>> 20) & 0x7ff) - 1075);
}

function isPowerOfTwo(x: number): boolean {
  FLOAT[0] = x;
  return WORDS[0] === 0 && (WORDS[1]! & 0xfffff) === 0;
}

function isOdd(x: number): boolean {
  FLOAT[0] = x;
  return (WORDS[0]! & 1) === 1;
}

/** Nearest whole number, halves to the even one. */
function rint(x: number): number {
  const r = Math.round(x);
  return Math.abs(x - Math.trunc(x)) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Too large or small for the gaps below to be exact powers of two in range. */
const outOfRange = (h: number) => !(Math.abs(h) > 1e-290 && Math.abs(h) < 1e300);

/**
 * A double-double rounded to 64 significant bits, as the unit's registers hold a result. `h` must
 * be the double nearest the value (which add, mul and twoSum all return).
 */
function round64([h, l]: DD): DD {
  if (l === 0 || outOfRange(h)) return [h, l];
  // Below a power of two the value has the smaller exponent, so its 64-bit grid is twice as fine.
  const below = isPowerOfTwo(h) && l < 0 === h > 0;
  const grid = ulp(h) / (below ? 4096 : 2048);
  return [h, rint(l / grid) * grid];
}

/** The double nearest a value held to 64 bits, halves to the even one, as storing a register rounds. */
function store([h, l]: DD): number {
  if (l === 0 || outOfRange(h)) return h + l;
  const away = l < 0 === h < 0;
  const gap = !away && isPowerOfTwo(h) ? ulp(h) / 2 : ulp(h);
  const size = Math.abs(l);
  if (size < gap / 2) return h;
  const next = h + (l < 0 ? -gap : gap);
  if (size > gap / 2) return next;
  return isOdd(h) ? next : h;
}

/** a·b rounded to 64 bits and then stored: differs from a plain product only on near-halves. */
export function multiply(a: number, b: number): number {
  const product = twoProd(a, b);
  if (
    product[1] === 0 ||
    !Number.isFinite(product[0]) ||
    outOfRange(product[0]) ||
    Math.abs(a) < 1e-140 ||
    Math.abs(b) < 1e-140
  )
    return a * b;
  return store(round64(product));
}

/** e^r - 1 as a double-double, for |r| below about 0.36. */
function expm1Small(r: DD): DD {
  const s: DD = [r[0] / 1024, r[1] / 1024];
  // Taylor series of e^s - 1 for |s| < 4e-4: thirteen terms reach far below double-double precision.
  let term: DD = s;
  let sum: DD = s;
  for (let n = 2; n <= 13; n++) {
    term = mul(term, s);
    term = [term[0] / n, term[1] / n];
    sum = add(sum, term);
  }
  // (1 + m)^2 = 1 + (2m + m^2), keeping the small part separate so nothing is lost to the 1.
  for (let i = 0; i < 10; i++) sum = add(add(sum, sum), mul(sum, sum));
  return sum;
}

function scale(x: number, k: number): number {
  if (k > 1000) return x * 2 ** 1000 * 2 ** (k - 1000);
  if (k < -1000) return x * 2 ** -1000 * 2 ** (k + 1000);
  return x * 2 ** k;
}

/** Excel's EXP: 2^(x·log2 e), the product held to 64 bits, then 2^fraction - 1, + 1, and scaled. */
export function exp(x: number): number {
  if (!Number.isFinite(x) || x > 709.78 || x < -708) return Math.exp(x);
  if (x === 0) return 1;
  const [th, tl] = round64(mul([x, 0], LOG2E_64));
  let n = rint(th);
  let fraction = twoSum(th - n, tl);
  if (
    fraction[0] > 0.5 ||
    (fraction[0] === 0.5 && (fraction[1] > 0 || (fraction[1] === 0 && n % 2 !== 0)))
  ) {
    n += 1;
    fraction = twoSum(th - n, tl);
  } else if (
    fraction[0] < -0.5 ||
    (fraction[0] === -0.5 && (fraction[1] < 0 || (fraction[1] === 0 && n % 2 !== 0)))
  ) {
    n -= 1;
    fraction = twoSum(th - n, tl);
  }
  const minusOne = round64(expm1Small(mul(fraction, LN2)));
  return scale(store(round64(add([1, 0], minusOne))), n);
}

/** Excel's LN: the natural log held to 64 bits, then stored. */
export function log(x: number): number {
  if (!(x > 0) || !Number.isFinite(x) || x < 2.3e-308) return Math.log(x);
  if (x === 1) return 0;
  const y = Math.log(x);
  // One Newton step in double-double: ln x = y + log1p(x·e^-y - 1), with e^-y = 2^k·(1 + m).
  const k = Math.round(-y / LN2[0]);
  const [p, pe] = twoProd(k, LN2[0]);
  const r = add(add([-y, 0], [-p, -pe]), [-k * LN2[1], 0]);
  const m = expm1Small(r);
  const scaled = scale(x, k);
  const c = add([scaled - 1, 0], mul([scaled, 0], m));
  const square = mul(c, c);
  const correction = add(c, [-square[0] / 2, -square[1] / 2]);
  return store(round64(add([y, 0], correction)));
}

/** π/2 as the processor holds it: π rounded to 64 bits, halved. Exact as a double-double. */
const HALF_PI_64: DD = [1.5707963267948966, 6.1257422745431e-17];

const neg = ([h, l]: DD): DD => [-h, -l];

function divNumber(a: DD, n: number): DD {
  const q1 = a[0] / n;
  const [p, e] = twoProd(q1, n);
  return twoSum(q1, (a[0] - p - e + a[1]) / n);
}

function div(a: DD, b: DD): DD {
  const q1 = a[0] / b[0];
  const r = add(a, neg(mul([q1, 0], b)));
  const q2 = r[0] / b[0];
  const r2 = add(r, neg(mul([q2, 0], b)));
  return add(twoSum(q1, q2), [r2[0] / b[0], 0]);
}

/** Sine and cosine of a double-double no larger than π/4, by their Taylor series. */
function sinCosSmall(r: DD): [DD, DD] {
  const r2 = mul(r, r);
  let sinTerm: DD = r;
  let sin: DD = r;
  let cosTerm: DD = [1, 0];
  let cos: DD = [1, 0];
  for (let n = 1; n <= 14; n++) {
    cosTerm = mul(cosTerm, r2);
    cosTerm = neg(divNumber(cosTerm, (2 * n - 1) * 2 * n));
    cos = add(cos, cosTerm);
    sinTerm = mul(sinTerm, r2);
    sinTerm = neg(divNumber(sinTerm, 2 * n * (2 * n + 1)));
    sin = add(sin, sinTerm);
  }
  return [sin, cos];
}

/**
 * Sine and cosine the way Windows Excel gets them from the processor: the angle is reduced by
 * multiples of its 64-bit π/2, and the results carry 64 bits until they are stored.
 */
function sinCos(x: number): [DD, DD] {
  if (Math.abs(x) < HALF_PI_64[0] / 2) return sinCosSmall([x, 0]);
  const k = rint(x / HALF_PI_64[0]);
  const [ph, pl] = twoProd(k, HALF_PI_64[0]);
  const r = add(add(twoSum(x, -ph), [-pl, 0]), neg(twoProd(k, HALF_PI_64[1])));
  const [s, c] = sinCosSmall(r);
  switch (((k % 4) + 4) % 4) {
    case 0:
      return [s, c];
    case 1:
      return [c, neg(s)];
    case 2:
      return [neg(s), neg(c)];
    default:
      return [neg(c), s];
  }
}

export function sin(x: number): number {
  return store(round64(sinCos(x)[0]));
}

export function cos(x: number): number {
  return store(round64(sinCos(x)[1]));
}

export function tan(x: number): number {
  const [s, c] = sinCos(x);
  return store(round64(div(s, c)));
}
