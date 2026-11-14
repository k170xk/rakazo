import { provenEmail } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { companyTools } from "./company-policy.js";
import type { EvolvePluginsConnection } from "./evolve-plugins.js";
import { callEvolveDocumentLibrary } from "./evolve-plugins.js";
import { storageRefusal } from "./file-retention.js";
import type { RunContext } from "./run-context.js";

/** The OCSC commands the ocsc tool runs; none of them needs a shell, the screen or the browser. */
export const OCSC_PROGRAMS: ReadonlySet<string> = new Set(["word", "pptx", "xlsx", "pdf", "video"]);

/** The built-in skill for each program; an admin switching the skill off switches the program off. */
const PROGRAM_SKILLS: Readonly<Record<string, string>> = {
  word: "ocsc-word",
  pptx: "ocsc-slides",
  xlsx: "ocsc-excel",
  pdf: "ocsc-pdf",
  video: "ocsc-video",
};

/** The OCSC programs an admin has switched off for every account. */
export function switchedOffOcscPrograms(
  disabledSkills: readonly string[] = companyTools().disabledSkills,
): Set<string> {
  const off = new Set(disabledSkills.map((name) => name.toLowerCase()));
  return new Set([...OCSC_PROGRAMS].filter((program) => off.has(PROGRAM_SKILLS[program] ?? "")));
}

const PROGRAM_FILES: Readonly<Record<string, string>> = {
  word: "Word",
  pptx: "PowerPoint",
  xlsx: "Excel",
  pdf: "PDF",
  video: "video",
};

/** The kinds of file the ocsc tool may make, for instructions: "Word, PowerPoint and PDF files". */
export function ocscFileKinds(off: ReadonlySet<string> = switchedOffOcscPrograms()): string {
  const kinds = [...OCSC_PROGRAMS]
    .filter((program) => !off.has(program))
    .map((program) => PROGRAM_FILES[program]);
  if (kinds.length <= 1) return `${kinds[0] ?? "no"} files`;
  return `${kinds.slice(0, -1).join(", ")} and ${kinds.at(-1)} files`;
}

function switchedOffMessage(program: string): string {
  return `ocsc-${program} is switched off for this company by an administrator. Tell the person it is not available; do not make it another way.`;
}

/** Why the ocsc tool may not run this program, or undefined when it may. */
export function ocscProgramRefusal(
  program: string,
  off: ReadonlySet<string> = switchedOffOcscPrograms(),
): string | undefined {
  return off.has(program) ? switchedOffMessage(program) : undefined;
}

/** Why a shell command may not run: it calls a switched-off OCSC program directly. */
export function ocscShellRefusal(
  command: string,
  off: ReadonlySet<string> = switchedOffOcscPrograms(),
): string | undefined {
  for (const program of off) {
    if (new RegExp(`(^|[^\\w-])ocsc-${program}(?![\\w-])`).test(command))
      return switchedOffMessage(program);
  }
  return undefined;
}

/**
 * The ocsc tool as offered to a run: switched-off programs leave its program list, and the
 * tool goes when none is left.
 */
export function withOcscProgramsOffered<T extends { name: string; inputSchema?: unknown }>(
  tools: readonly T[],
  off: ReadonlySet<string> = switchedOffOcscPrograms(),
): T[] {
  if (off.size === 0) return [...tools];
  const on = [...OCSC_PROGRAMS].filter((program) => !off.has(program));
  return tools.flatMap((tool) => {
    if (tool.name !== "ocsc") return [tool];
    if (on.length === 0) return [];
    const schema = tool.inputSchema as
      | { properties?: Record<string, Record<string, unknown>> }
      | undefined;
    if (!schema?.properties?.program) return [tool];
    return [
      {
        ...tool,
        inputSchema: {
          ...schema,
          properties: { ...schema.properties, program: { ...schema.properties.program, enum: on } },
        },
      },
    ];
  });
}

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

/**
 * The command line for one OCSC command; in a conversation folder its files stay in that folder.
 * `author` names the person on tracked changes and review comments.
 */
export function ocscCommand(
  program: string,
  args: readonly string[],
  folder?: string,
  author?: string,
): string {
  const env = author ? `OCSC_AUTHOR=${shellQuote(author)} ` : "";
  const run = `${env}${[`ocsc-${program}`, ...args.map(shellQuote)].join(" ")}`;
  if (!folder) return run;
  const dir = shellQuote(folder);
  return `mkdir -p ${dir} && cd ${dir} && WORKSPACE_DIR="$PWD" ${run}`;
}

/** One line, so it is safe in an environment variable and readable in Word's review pane. */
function authorName(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Whose name OCSC documents record as the author of tracked changes and review comments: the
 * person whose request this run is, never the bot.
 */
export async function documentAuthor(ctx: RunContext): Promise<string | undefined> {
  try {
    const user = await runAsSystem("read document author", () =>
      ctx.deps.prisma.user.findUnique({
        where: { id: ctx.run.userId },
        select: { name: true, email: true },
      }),
    );
    return authorName(user?.name) || authorName(user?.email?.split("@")[0]) || undefined;
  } catch {
    return undefined;
  }
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function isWordDocument(name: string, mimeType: string | null | undefined): boolean {
  return mimeType === DOCX_MIME || name.toLowerCase().endsWith(".docx");
}

/** Passed to `ocsc word new` when the person asked for a brand-new document; removed before running. */
export const NEW_DOCUMENT_FLAG = "--new-document";

type LibraryTemplate = { title: string; fileUrl: string };

/** Kept briefly so each new document does not ask Evolve again; a miss is retried sooner. */
const libraryTemplates = new Map<string, { at: number; template: LibraryTemplate | null }>();
const LIBRARY_TEMPLATE_TTL_MS = 5 * 60_000;
const LIBRARY_TEMPLATE_MISS_TTL_MS = 60_000;

export function resetLibraryTemplateCache(): void {
  libraryTemplates.clear();
}

async function libraryTemplate(
  ctx: RunContext,
  connection: EvolvePluginsConnection,
  id: string,
): Promise<LibraryTemplate | null> {
  const cached = libraryTemplates.get(id);
  const age = cached ? Date.now() - cached.at : Number.POSITIVE_INFINITY;
  if (cached && age < (cached.template ? LIBRARY_TEMPLATE_TTL_MS : LIBRARY_TEMPLATE_MISS_TTL_MS))
    return cached.template;
  let template: LibraryTemplate | null = null;
  try {
    const user = await runAsSystem("read the run owner's email", () =>
      ctx.deps.prisma.user.findUnique({
        where: { id: ctx.run.userId },
        select: { email: true, emailVerified: true },
      }),
    );
    const email = provenEmail(user);
    if (email) {
      const found = await callEvolveDocumentLibrary<{ title?: unknown; fileUrl?: unknown }>(
        connection,
        email,
        { action: "template", id },
      );
      if (typeof found.fileUrl === "string" && found.fileUrl.startsWith("https://")) {
        template = {
          fileUrl: found.fileUrl,
          title: typeof found.title === "string" ? found.title : "",
        };
      }
    }
  } catch (error) {
    getLogger().warn("default word template unavailable", { id, error: String(error) });
  }
  libraryTemplates.set(id, { at: Date.now(), template });
  return template;
}

/**
 * `ocsc word new` without --template gets the Document Library template an admin made the
 * company default; ocsc-word uses its built-in OCSC report when it has none or cannot fetch it.
 */
export async function withDefaultWordTemplate(
  ctx: RunContext,
  program: string,
  args: readonly string[],
): Promise<string[]> {
  if (program !== "word" || args[0] !== "new" || args.includes("--template")) return [...args];
  const id = companyTools().defaultWordTemplateId;
  const connection = ctx.deps.evolvePlugins;
  if (!id || !connection) return [...args];
  const template = await libraryTemplate(ctx, connection, id);
  if (!template) return [...args];
  return [
    ...args,
    "--default-template-url",
    template.fileUrl,
    ...(template.title ? ["--default-template-name", template.title] : []),
  ];
}

/** The arguments the OCSC program receives. */
export function ocscProgramArgs(args: readonly string[]): string[] {
  return args.filter((arg) => arg !== NEW_DOCUMENT_FLAG);
}

/**
 * Why `ocsc word new` must not run: in a conversation that already has a Word document, or over
 * an existing file, making a new one would rebuild the person's document instead of editing it.
 * The bot passes NEW_DOCUMENT_FLAG only when the person asked for a brand-new document.
 */
export function wordRebuildRefusal(
  program: string,
  args: readonly string[],
  wordDocuments: readonly { name: string; path: string }[],
): string | undefined {
  if (program !== "word" || args[0] !== "new" || args.includes(NEW_DOCUMENT_FLAG)) return undefined;
  const overwriting = args.includes("--overwrite");
  if (!overwriting && wordDocuments.length === 0) return undefined;
  const listed = wordDocuments
    .slice(0, 5)
    .map((doc) => `"${doc.name}" (${doc.path})`)
    .join(", ");
  const existing = overwriting
    ? "This would replace an existing Word document."
    : `This conversation already has a Word document: ${listed}.`;
  return `${existing} To change a document, never make it again: run ocsc word read --in <its path>, then ocsc word edit --in <its path> --spec <edits>.json --out <new version>.docx, so the changes show as tracked changes. Only when the person explicitly asked for a brand-new, separate document (not changes to an existing one), run the same new command again with ${NEW_DOCUMENT_FLAG}.`;
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

/** The ocsc commands that write the document named in their output; the rest only look at one. */
const DOCUMENT_WRITES: Readonly<Record<string, readonly string[]>> = {
  word: ["new", "edit", "accept"],
  pptx: ["new", "edit"],
  xlsx: ["new", "edit"],
  pdf: ["convert"],
};

/** Records the document a successful ocsc command made or changed, for the unsent-file reminder. */
export function noteDocumentWrite(
  ctx: RunContext,
  program: string,
  args: readonly string[],
  result: unknown,
): void {
  if (!DOCUMENT_WRITES[program]?.includes(args[0] ?? "")) return;
  const printed = printedJson(result);
  if (printed?.ok !== true || typeof printed.path !== "string" || !printed.path) return;
  const { made } = ctx.state.documents;
  const at = made.indexOf(printed.path);
  if (at >= 0) made.splice(at, 1);
  made.push(printed.path);
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
      documentsApart: ctx.computer.documentsApart,
    });
    if (full) return { error: full };
  }
  if (program !== "video") return undefined;
  if (ctx.computer.folder) {
    return {
      error:
        "Videos are not made on someone else's computer from a shared chat. Ask the person to use one of their own agents, which can make videos.",
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
