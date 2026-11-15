import type { InfraPeriod, InfraSeriesKey, Infrastructure } from "@rakazo/contracts";
import { INFRA_SERIES, InfraSampleSchema } from "@rakazo/contracts";
import { Prisma, runAsSystem } from "@rakazo/db";
import { requireAdmin } from "./admins.js";
import type { RouterDeps } from "./router.js";

type InfrastructureDeps = Pick<RouterDeps, "prisma"> & {
  env: Pick<RouterDeps["env"], "adminEmails">;
};

const PERIOD_MINUTES: Record<InfraPeriod, number> = { "24h": 1440, "7d": 10_080, "30d": 43_200 };
/** About 300 points per chart, so a peak inside a bucket still shows. */
const BUCKET_MINUTES: Record<InfraPeriod, number> = { "24h": 5, "7d": 30, "30d": 120 };

/** Where each charted series lives in a stored sample. */
const SERIES_PATHS: Record<InfraSeriesKey, string[]> = {
  appCpu: ["app", "cpuPercent"],
  appMemUsed: ["app", "memUsedBytes"],
  appDiskUsed: ["app", "diskUsedBytes"],
  routinesCpu: ["routines", "cpuPercent"],
  routinesMemUsed: ["routines", "memUsedBytes"],
  routinesDiskUsed: ["routines", "diskUsedBytes"],
  incusMemUsed: ["incus", "memUsedBytes"],
  incusDiskUsed: ["incus", "diskUsedBytes"],
  incusRunning: ["incus", "running"],
  appToolsRunning: ["runners", "app", "tools", "running"],
  appToolsQueued: ["runners", "app", "tools", "queued"],
  appLargeRunning: ["runners", "app", "large", "running"],
  routinesToolsRunning: ["runners", "routines", "tools", "running"],
  routinesToolsQueued: ["runners", "routines", "tools", "queued"],
  chatRuns: ["fleet", "chatRuns"],
  routineRuns: ["fleet", "routineRuns"],
  queuedRuns: ["fleet", "queuedRuns"],
};

const SERIES_COLUMNS = Prisma.raw(
  INFRA_SERIES.map(
    (key) => `max(("data" #>> '{${SERIES_PATHS[key].join(",")}}')::float8) AS "${key}"`,
  ).join(",\n  "),
);

/** The newest reading of every server, runner and Incus, and each series' peaks over time. */
export async function infrastructure(
  deps: InfrastructureDeps,
  actorUserId: string,
  period: InfraPeriod,
  now = new Date(),
): Promise<Infrastructure> {
  await requireAdmin(deps, actorUserId);
  const since = new Date(now.getTime() - PERIOD_MINUTES[period] * 60_000);
  const bucketSeconds = BUCKET_MINUTES[period] * 60;
  const [latest, rows] = await runAsSystem("read infrastructure samples", () =>
    Promise.all([
      deps.prisma.infraSample.findFirst({
        orderBy: { sampledAt: "desc" },
        select: { sampledAt: true, data: true },
      }),
      deps.prisma.$queryRaw<Array<{ at: Date } & Record<InfraSeriesKey, number | null>>>`
        SELECT to_timestamp(floor(extract(epoch FROM "sampledAt") / ${bucketSeconds}) * ${bucketSeconds}) AS at,
          ${SERIES_COLUMNS}
        FROM infra_samples
        WHERE "sampledAt" >= ${since}
        GROUP BY 1
        ORDER BY 1`,
    ]),
  );
  const sample = latest ? InfraSampleSchema.safeParse(latest.data) : null;
  return {
    period,
    latest:
      latest && sample?.success
        ? { sampledAt: latest.sampledAt.toISOString(), sample: sample.data }
        : null,
    bucketMinutes: BUCKET_MINUTES[period],
    points: rows.map((row) => ({
      at: new Date(row.at).toISOString(),
      values: Object.fromEntries(
        INFRA_SERIES.map((key) => [key, row[key] === null ? null : Number(row[key])]),
      ) as Record<InfraSeriesKey, number | null>,
    })),
  };
}
