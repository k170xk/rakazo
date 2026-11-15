import { z } from "zod";

export const REPLY_FAILURE_PERIODS = ["7d", "30d", "90d"] as const;
export type ReplyFailurePeriod = (typeof REPLY_FAILURE_PERIODS)[number];

/**
 * Why a failed reply failed: "context" did not fit the model's input, "output" ran out of the
 * model's output allowance, "other" is everything else (provider faults, keys, limits).
 */
export const REPLY_FAILURE_KINDS = ["context", "output", "other"] as const;
export type ReplyFailureKind = (typeof REPLY_FAILURE_KINDS)[number];

const counts = {
  context: z.number().int(),
  output: z.number().int(),
  other: z.number().int(),
};

/** Failed replies per day and per agent, for admins. */
export const ReplyFailuresSchema = z.object({
  period: z.enum(REPLY_FAILURE_PERIODS),
  since: z.string(),
  /** Every day in the period, oldest first, as YYYY-MM-DD (UTC), with all replies that ended. */
  days: z.array(z.object({ day: z.string(), finished: z.number().int(), ...counts })),
  totals: z.object({ finished: z.number().int(), ...counts }),
  agents: z.array(
    z.object({
      botId: z.string(),
      name: z.string(),
      owner: z.string(),
      ...counts,
      lastFailedAt: z.string().nullable(),
    }),
  ),
});
export type ReplyFailures = z.infer<typeof ReplyFailuresSchema>;
