import type { PrismaClient } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";
import { storageRefusal } from "./file-retention.js";
import type { RunContext } from "./run-context.js";

/** The OCSC commands the ocsc tool runs; none of them needs a shell, the screen or the browser. */
export const OCSC_PROGRAMS: ReadonlySet<string> = new Set(["word", "pptx", "xlsx", "pdf", "video"]);

/** Video renders across the whole company at once; each one takes a computer's CPUs for minutes. */
export function videoRenderSlots(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env.RAKAZO_VIDEO_RENDER_SLOTS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

/** A render nobody asked about for this long has finished or died; its slot goes to the next. */
const STALE_RUNNING_MS = 45 * 60_000;
/** A queued render whose bot stopped asking gives up its place. */
const STALE_QUEUED_MS = 5 * 60_000;
const SLOT_LOCK = 7_342_119;
/** Steps that only look at existing work, so they still run when storage is full. */
const READ_ONLY_STEPS: ReadonlySet<string> = new Set(["status", "wait", "cancel", "read", "help"]);

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The command line for one OCSC command; in a conversation folder its files stay in that folder. */
export function ocscCommand(program: string, args: readonly string[], folder?: string): string {
  const run = [`ocsc-${program}`, ...args.map(shellQuote)].join(" ");
  if (!folder) return run;
  const dir = shellQuote(folder);
  return `mkdir -p ${dir} && cd ${dir} && WORKSPACE_DIR="$PWD" ${run}`;
}

type SlotRow = { key: string; userId: string; state: string };

/**
 * 0 when this job may start now, else its place in line from 1. Rows are oldest first; people
 * with no render running go ahead of people who already have one.
 */
export function videoQueuePlace(
  rows: readonly SlotRow[],
  job: { key: string; userId: string },
  slots: number,
): number {
  const running = rows.filter((row) => row.state === "running");
  if (running.some((row) => row.key === job.key)) return 0;
  const rendering = new Set(running.map((row) => row.userId));
  const line = rows.filter((row) => row.state === "queued");
  if (!line.some((row) => row.key === job.key)) line.push({ ...job, state: "queued" });
  const ordered = [
    ...line.filter((row) => !rendering.has(row.userId)),
    ...line.filter((row) => rendering.has(row.userId)),
  ];
  const place = ordered.findIndex((row) => row.key === job.key);
  const free = Math.max(slots - running.length, 0);
  return place < free ? 0 : place - free + 1;
}

export type VideoSlotClaim = { granted: true } | { granted: false; position: number };

/**
 * Takes a render slot, or a place in line. People with no render running go ahead of people
 * who already have one, so one person's renders never hold everyone else up.
 */
export async function claimVideoRenderSlot(
  prisma: PrismaClient,
  job: { key: string; userId: string; botId: string },
  slots = videoRenderSlots(),
  now = new Date(),
): Promise<VideoSlotClaim> {
  return runAsSystem("claim a video render slot", () =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SLOT_LOCK})`;
      await tx.heavyToolJob.deleteMany({
        where: {
          OR: [
            { state: "running", touchedAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) } },
            { state: "queued", touchedAt: { lt: new Date(now.getTime() - STALE_QUEUED_MS) } },
          ],
        },
      });
      const rows = await tx.heavyToolJob.findMany({
        orderBy: { createdAt: "asc" },
        select: { key: true, userId: true, state: true },
      });
      const mine = rows.find((row) => row.key === job.key);
      if (mine?.state === "running") {
        await tx.heavyToolJob.update({ where: { key: job.key }, data: { touchedAt: now } });
        return { granted: true } as const;
      }
      const place = videoQueuePlace(rows, job, slots);
      if (place === 0) {
        await tx.heavyToolJob.upsert({
          where: { key: job.key },
          create: { ...job, state: "running", startedAt: now, touchedAt: now },
          update: { state: "running", startedAt: now, touchedAt: now },
        });
        return { granted: true } as const;
      }
      await tx.heavyToolJob.upsert({
        where: { key: job.key },
        create: { ...job, state: "queued", touchedAt: now },
        update: { touchedAt: now },
      });
      return { granted: false, position: place } as const;
    }),
  );
}

export async function touchVideoRenderSlot(prisma: PrismaClient, key: string, jobRef?: string) {
  await runAsSystem("touch a video render slot", () =>
    prisma.heavyToolJob.updateMany({
      where: { key, state: "running" },
      data: { touchedAt: new Date(), ...(jobRef ? { jobRef } : {}) },
    }),
  );
}

export async function releaseVideoRenderSlot(prisma: PrismaClient, key: string) {
  await runAsSystem("release a video render slot", () =>
    prisma.heavyToolJob.deleteMany({ where: { key } }),
  );
}

export async function videoRenderLoad(prisma: PrismaClient) {
  const rows = await runAsSystem("read video render slots", () =>
    prisma.heavyToolJob.groupBy({ by: ["state"], _count: { _all: true } }),
  );
  const count = (state: string) => rows.find((row) => row.state === state)?._count._all ?? 0;
  return { rendering: count("running"), queued: count("queued") };
}

function renderSlotKey(ctx: RunContext): string {
  return `${ctx.bot.userId}:${ctx.bot.id}`;
}

/** The JSON an OCSC command printed, when its output is one JSON object. */
function printedJson(result: unknown): Record<string, unknown> | undefined {
  if (typeof result !== "object" || result === null || !("stdout" in result)) return undefined;
  const stdout = String((result as { stdout: unknown }).stdout ?? "").trim();
  const start = stdout.indexOf("{");
  if (start < 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(stdout.slice(start));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Before a command runs: a reason it may not run here, or a place in the render line.
 * Undefined lets it run.
 */
export async function ocscBeforeRun(
  ctx: RunContext,
  program: string,
  args: readonly string[],
): Promise<Record<string, unknown> | undefined> {
  if (!READ_ONLY_STEPS.has(args[0] ?? "")) {
    const full = await storageRefusal({
      prisma: ctx.deps.prisma,
      home: ctx.deps.home,
      dataDir: ctx.deps.dataDir,
      userId: ctx.bot.userId,
      computer: ctx.computer.stored,
    });
    if (full) return { error: full };
  }
  if (program !== "video") return undefined;
  if (ctx.computer.folder) {
    return {
      error:
        "Videos are not made on someone else's computer from a shared chat. Ask the person to use one of their own bots, which can make videos.",
    };
  }
  if (args[0] !== "render") return undefined;
  const claim = await claimVideoRenderSlot(ctx.deps.prisma, {
    key: renderSlotKey(ctx),
    userId: ctx.bot.userId,
    botId: ctx.bot.id,
  });
  if (claim.granted) return undefined;
  return {
    queued: true,
    position: claim.position,
    note: `The company's video renderers are busy; this render is number ${claim.position} in line. Tell the user it is queued, wait about 30 seconds, then call the same ocsc command again to take its turn.`,
  };
}

/** After a command ran: keep or free this folder's render slot. */
export async function ocscAfterRun(
  ctx: RunContext,
  program: string,
  args: readonly string[],
  result: unknown,
): Promise<void> {
  if (program !== "video" || ctx.computer.folder) return;
  const key = renderSlotKey(ctx);
  const printed = printedJson(result);
  const status = typeof printed?.status === "string" ? printed.status : undefined;
  const finished = status === "done" || status === "failed" || status === "cancelled";
  if (args[0] === "render") {
    if (printed?.ok === true && !finished) {
      await touchVideoRenderSlot(
        ctx.deps.prisma,
        key,
        typeof printed.job === "string" ? printed.job : undefined,
      );
    } else if (!(typeof result === "object" && result !== null && "running" in result)) {
      await releaseVideoRenderSlot(ctx.deps.prisma, key);
    }
    return;
  }
  if (args[0] === "cancel" || finished) await releaseVideoRenderSlot(ctx.deps.prisma, key);
  else if (args[0] === "wait" || args[0] === "status")
    await touchVideoRenderSlot(ctx.deps.prisma, key);
}
