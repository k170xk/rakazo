import { ARRAYS } from "./arrays.js";
import { BONDS } from "./bonds.js";
import { COMPLEX_FNS } from "./complex.js";
import { DATE_FNS } from "./date.js";
import { ENGINEERING } from "./engineering.js";
import { FINANCE } from "./finance.js";
import type { Fn } from "./helpers.js";
import { INFO } from "./info.js";
import { LAMBDA_FNS } from "./lambda.js";
import { LOGIC } from "./logic.js";
import { LOOKUP } from "./lookup.js";
import { FUNCTION_LOOKUP, MATH } from "./math.js";
import { STATS } from "./stats.js";
import { TEXT_FNS } from "./text.js";

export type { Fn } from "./helpers.js";

/** Every worksheet function the engine calculates, by Excel's name. */
export const FUNCTIONS: Record<string, Fn> = {
  ...MATH,
  ...LOGIC,
  ...LOOKUP,
  ...TEXT_FNS,
  ...DATE_FNS,
  ...STATS,
  ...FINANCE,
  ...ENGINEERING,
  ...BONDS,
  ...COMPLEX_FNS,
  ...ARRAYS,
  ...LAMBDA_FNS,
  ...INFO,
  TABLE: (args, ctx) => ctx.engine.dataTable(ctx, args[0], args[1]),
};

for (const [name, fn] of Object.entries(FUNCTIONS)) FUNCTION_LOOKUP.set(name, fn);

/** Functions whose result changes without any input changing. */
export const VOLATILE = new Set(["NOW", "TODAY", "RAND", "RANDBETWEEN", "RANDARRAY"]);
