import * as z from "zod";

export const ROUTINE_RUNS_PER_DAY_MAX = 96;
export const MAX_ACTIVE_ROUTINES_MAX = 200;
export const MONTHLY_BUDGET_USD_MAX = 100_000;

/** Company routine and spend limits for staff, which admins also follow. */
export const StaffLimitsSchema = z.object({
  /** Times each routine may run in any 24 hours, whatever starts it. */
  routineRunsPerDay: z.number().int().min(1).max(ROUTINE_RUNS_PER_DAY_MAX),
  /** Routines one person may keep switched on at once. */
  maxActiveRoutines: z.number().int().min(0).max(MAX_ACTIVE_ROUTINES_MAX),
  /** AI spend per person per calendar month (UTC); null sets no budget. */
  monthlyBudgetUsd: z.number().min(0).max(MONTHLY_BUDGET_USD_MAX).nullable(),
});
export type StaffLimits = z.infer<typeof StaffLimitsSchema>;

export const DEFAULT_STAFF_LIMITS: StaffLimits = {
  routineRunsPerDay: 24,
  maxActiveRoutines: 10,
  monthlyBudgetUsd: null,
};

/** Stored company limits with absent or invalid keys taking their defaults. */
export function staffLimitsFrom(raw: unknown): StaffLimits {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const limits = { ...DEFAULT_STAFF_LIMITS };
  for (const key of Object.keys(DEFAULT_STAFF_LIMITS) as Array<keyof StaffLimits>) {
    const parsed = StaffLimitsSchema.shape[key].safeParse(value[key]);
    if (parsed.success && value[key] !== undefined) Object.assign(limits, { [key]: parsed.data });
  }
  return limits;
}

export const ModelAccessSchema = z.enum(["choose", "fixed"]);
export type ModelAccess = z.infer<typeof ModelAccessSchema>;

/** "provider/modelId"; the provider never contains a slash, a model id may. */
export const AllowedModelSchema = z
  .string()
  .regex(/^[^/\s]+\/\S+$/)
  .max(200);

export function allowedModelKey(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

/** One person's overrides; null follows the company setting. */
export const StaffPersonLimitsSchema = z.object({
  routineRunsPerDay: z.number().int().min(1).max(ROUTINE_RUNS_PER_DAY_MAX).nullable(),
  maxActiveRoutines: z.number().int().min(0).max(MAX_ACTIVE_ROUTINES_MAX).nullable(),
  /** Null follows the company budget; "none" gives this person no budget. */
  monthlyBudgetUsd: z
    .union([z.number().min(0).max(MONTHLY_BUDGET_USD_MAX), z.literal("none")])
    .nullable(),
  /** Null follows the company "members choose models" switch. */
  modelAccess: ModelAccessSchema.nullable(),
  /** Empty allows every model. */
  allowedModels: z.array(AllowedModelSchema).max(100),
});
export type StaffPersonLimits = z.infer<typeof StaffPersonLimitsSchema>;

export const StaffLimitsStateSchema = z.object({
  defaults: StaffLimitsSchema,
  /** The company "members choose models" switch that people without an override follow. */
  memberModels: z.boolean(),
  people: z.array(
    StaffPersonLimitsSchema.extend({
      userId: z.string(),
      name: z.string(),
      email: z.string(),
      activeRoutines: z.number().int(),
      spentThisMonthUsd: z.number(),
    }),
  ),
});
export type StaffLimitsState = z.infer<typeof StaffLimitsStateSchema>;

export const ROUTINE_ACTIVITY_PERIODS = ["7d", "30d", "90d"] as const;
export type RoutineActivityPeriod = (typeof ROUTINE_ACTIVITY_PERIODS)[number];

/** Routines created per day and per person, for admins. */
export const RoutineActivitySchema = z.object({
  period: z.enum(ROUTINE_ACTIVITY_PERIODS),
  since: z.string(),
  /** Every day in the period, oldest first, as YYYY-MM-DD (UTC). */
  days: z.array(z.object({ day: z.string(), created: z.number().int() })),
  totals: z.object({
    created: z.number().int(),
    active: z.number().int(),
    runs: z.number().int(),
  }),
  people: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      email: z.string(),
      created: z.number().int(),
      active: z.number().int(),
      runs: z.number().int(),
      lastCreatedAt: z.string().nullable(),
      /** Created per day, aligned with `days`. */
      daily: z.array(z.number().int()),
    }),
  ),
});
export type RoutineActivity = z.infer<typeof RoutineActivitySchema>;
