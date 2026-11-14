import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { AgentHomeStore, ArtifactStore, SandboxProvider } from "@rakazo/adapter-kit";
import { createAdapterContext } from "@rakazo/adapter-kit";
import type { ToolRunnerClient } from "@rakazo/adapters";
import {
  computerAccessFor,
  ensureToolRunnerFolder,
  folderFiles,
  runnerHomePath,
  storageRefusal,
  TOOL_RUNNER_COMPUTER,
  toolRunnersShareHome,
  toolRunnerWorkspace,
} from "@rakazo/adapters";
import type { Auth } from "@rakazo/auth";
import type {
  Actor,
  DocumentCreated,
  DocumentFormat,
  DocumentRevision,
  DocumentSaved,
  DocumentSummary,
} from "@rakazo/contracts";
import {
  ARTIFACT_NAME_MAX_LENGTH,
  attachmentMaxBytes,
  attachmentSizeLabel,
  DOCUMENT_LIST_MAX_LIMIT,
  DOCUMENT_MIME_TYPES,
  DOCUMENT_VERSIONS_MAX,
  DOCUMENTS_UPLOAD_PATH,
  DocumentFormatSchema,
  documentFormatForMimeType,
} from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import {
  IsolationError,
  Prisma,
  parseComputerMode,
  runAsTenant,
  withResolvedArtifactVersion,
} from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { strFromU8, unzipSync } from "fflate";
import type { Hono } from "hono";
import { DRAFT_DOWNLOAD_PREFIX } from "./artifact-download.js";
import { cancelBody, readBoundedBytes } from "./http-body.js";

export type DocumentDeps = {
  prisma: PrismaClient;
  artifacts: ArtifactStore;
  home: AgentHomeStore;
  dataDir: string | undefined;
  sandbox: Pick<SandboxProvider, "describe">;
  toolRunner?: ToolRunnerClient;
  maxUploadSizeBytes?: number;
};

/** A refusal the studio can act on; `code` is stable, `message` is for the person. */
export class DocumentError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DocumentError";
  }
}

const RUNNER_PROGRAM: Readonly<Record<DocumentFormat, string>> = {
  docx: "word",
  pptx: "pptx",
  xlsx: "xlsx",
};

/** The part `[Content_Types].xml` names for each format's main document; macro files differ. */
const MAIN_PART: Readonly<Record<DocumentFormat, string>> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
};
const CONTENT_TYPES = "[Content_Types].xml";
const CONTENT_TYPES_MAX_BYTES = 1024 * 1024;
const CREATE_TIMEOUT_MS = 2 * 60_000;
const STORAGE_FULL_MESSAGE =
  "There is no room to save this. Open Manage storage from your account menu, or ask an admin.";

/** Which Office format these bytes are, read from the zip's content types; null when neither. */
export function officeFormatOf(bytes: Uint8Array): DocumentFormat | null {
  let xml: string;
  try {
    const entry = unzipSync(bytes, {
      filter: (file) => file.name === CONTENT_TYPES && file.originalSize <= CONTENT_TYPES_MAX_BYTES,
    })[CONTENT_TYPES];
    if (!entry) return null;
    xml = strFromU8(entry);
  } catch {
    return null;
  }
  return DocumentFormatSchema.options.find((format) => xml.includes(MAIN_PART[format])) ?? null;
}

const familyVersionSelect = {
  id: true,
  rootArtifactId: true,
  botId: true,
  groupId: true,
  name: true,
  mimeType: true,
  size: true,
  version: true,
  createdAt: true,
  source: true,
} as const;

/** The caller's file family holding `artifactId`, newest version first. */
export async function documentFamily(
  prisma: Pick<PrismaClient, "artifact">,
  actor: Pick<Actor, "spaceId" | "userId">,
  artifactId: string,
) {
  const anchor = await prisma.artifact.findFirst({
    where: { id: artifactId, spaceId: actor.spaceId, userId: actor.userId },
    select: { id: true, rootArtifactId: true },
  });
  if (!anchor) throw new IsolationError();
  const rootArtifactId = anchor.rootArtifactId ?? anchor.id;
  const versions = await prisma.artifact.findMany({
    where: {
      spaceId: actor.spaceId,
      userId: actor.userId,
      OR: [{ id: rootArtifactId }, { rootArtifactId }],
    },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    take: DOCUMENT_VERSIONS_MAX,
    select: familyVersionSelect,
  });
  const latest = versions[0];
  if (!latest) throw new IsolationError();
  const format = documentFormatForMimeType(latest.mimeType);
  if (!format) {
    throw new DocumentError(
      "UNSUPPORTED_MEDIA_TYPE",
      415,
      "Only Word, PowerPoint and Excel files open here.",
    );
  }
  return { rootArtifactId, format, latest, versions };
}

export async function documentRevision(
  prisma: Pick<PrismaClient, "artifact">,
  actor: Pick<Actor, "spaceId" | "userId">,
  artifactId: string,
): Promise<DocumentSaved> {
  const { version, artifactId: latestId } = await familyRevision(prisma, actor, artifactId);
  return { artifactId: latestId, version };
}

async function familyRevision(
  prisma: Pick<PrismaClient, "artifact">,
  actor: Pick<Actor, "spaceId" | "userId">,
  artifactId: string,
) {
  const anchor = await prisma.artifact.findFirst({
    where: { id: artifactId, spaceId: actor.spaceId, userId: actor.userId },
    select: { id: true, rootArtifactId: true },
  });
  if (!anchor) throw new IsolationError();
  const rootArtifactId = anchor.rootArtifactId ?? anchor.id;
  const latest = await prisma.artifact.findFirst({
    where: {
      spaceId: actor.spaceId,
      userId: actor.userId,
      OR: [{ id: rootArtifactId }, { rootArtifactId }],
    },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    select: { id: true, version: true },
  });
  if (!latest) throw new IsolationError();
  return { rootArtifactId, artifactId: latest.id, version: latest.version };
}

/**
 * `documentRevision` plus the assistant's live draft when it is newer than every version. A draft
 * whose base a newer version has passed is removed. `draftSeen` skips the token for a loaded draft.
 */
export async function documentRevisionWithDraft(
  deps: {
    prisma: Pick<PrismaClient, "artifact" | "documentDraft">;
    artifacts: Pick<ArtifactStore, "remove">;
    auth: Pick<Auth, "issueArtifactDownloadToken">;
  },
  actor: Pick<Actor, "spaceId" | "userId">,
  input: { rootArtifactId: string; draftSeen?: string },
): Promise<DocumentRevision> {
  const { rootArtifactId, ...revision } = await familyRevision(
    deps.prisma,
    actor,
    input.rootArtifactId,
  );
  const draft = await deps.prisma.documentDraft.findFirst({
    where: { spaceId: actor.spaceId, userId: actor.userId, rootArtifactId },
    select: { id: true, storageKey: true, baseVersion: true, botId: true, updatedAt: true },
  });
  if (!draft) return revision;
  if (draft.baseVersion < revision.version) {
    await deps.prisma.documentDraft
      .deleteMany({ where: { id: draft.id, updatedAt: draft.updatedAt } })
      .then(({ count }) =>
        count > 0
          ? deps.artifacts.remove(
              draft.storageKey,
              createAdapterContext(actor, draft.botId ?? rootArtifactId, `draft-clear:${draft.id}`),
            )
          : undefined,
      )
      .catch((error: unknown) => {
        getLogger().warn("stale document draft not cleared", { error: String(error) });
      });
    return revision;
  }
  const updatedAt = draft.updatedAt.toISOString();
  const downloadToken =
    input.draftSeen === updatedAt
      ? undefined
      : await deps.auth.issueArtifactDownloadToken({
          spaceId: actor.spaceId,
          userId: actor.userId,
          artifactId: `${DRAFT_DOWNLOAD_PREFIX}${draft.id}`,
        });
  return {
    ...revision,
    draft: {
      updatedAt,
      baseVersion: draft.baseVersion,
      ...(downloadToken ? { downloadToken } : {}),
    },
  };
}

type SummaryRow = {
  id: string;
  rootId: string;
  name: string;
  mimeType: string;
  version: number;
  size: number;
  createdAt: Date;
  source: string | null;
};

/** The newest version of each of the caller's Office files in this space, latest change first. */
export async function listDocuments(
  prisma: Pick<PrismaClient, "$queryRaw">,
  actor: Pick<Actor, "spaceId" | "userId">,
  input: { format?: DocumentFormat; limit?: number },
): Promise<DocumentSummary[]> {
  const mimeTypes = input.format
    ? [DOCUMENT_MIME_TYPES[input.format]]
    : DocumentFormatSchema.options.map((format) => DOCUMENT_MIME_TYPES[format]);
  const take = Math.min(Math.max(input.limit ?? 20, 1), DOCUMENT_LIST_MAX_LIMIT);
  const rows = await prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
    SELECT * FROM (
      SELECT DISTINCT ON (COALESCE("rootArtifactId", id))
        id, COALESCE("rootArtifactId", id) AS "rootId", name, "mimeType", version, size,
        "createdAt", source
      FROM "artifacts"
      WHERE "spaceId" = ${actor.spaceId} AND "userId" = ${actor.userId}
        AND "mimeType" IN (${Prisma.join(mimeTypes)})
      ORDER BY COALESCE("rootArtifactId", id), version DESC
    ) latest
    ORDER BY "createdAt" DESC, id DESC
    LIMIT ${take}
  `);
  return rows.flatMap((row) => {
    const format = documentFormatForMimeType(row.mimeType);
    return format
      ? [
          {
            rootArtifactId: row.rootId,
            artifactId: row.id,
            name: row.name,
            format,
            version: row.version,
            size: row.size,
            updatedAt: row.createdAt.toISOString(),
            source: versionSource(row.source),
          },
        ]
      : [];
  });
}

export function versionSource(value: string | null): "assistant" | "studio" | null {
  return value === "assistant" || value === "studio" ? value : null;
}

async function documentStorageRefusal(
  deps: DocumentDeps,
  userId: string,
  computer: { id: string; homeKey: string; homeBytesAt: Date | null } | null,
) {
  if (!computer) return null;
  const sharesHome = toolRunnersShareHome(
    await computerAccessFor(deps.prisma, userId),
    deps.sandbox.describe().capabilities.persistentHome !== false,
  );
  return storageRefusal({
    prisma: deps.prisma,
    home: deps.home,
    dataDir: deps.dataDir,
    userId,
    computer,
    documentsApart: !sharesHome,
  });
}

/**
 * Saves a studio edit as the family's next version, under the family's own name and scope so the
 * assistant's next attach_file of that name continues it. Refused unless `baseVersion` is still
 * the newest, so an edit never silently replaces a version the person has not seen.
 */
export async function saveDocumentVersion(
  deps: DocumentDeps,
  actor: Pick<Actor, "spaceId" | "userId">,
  input: {
    artifactId: string;
    baseVersion: number;
    format: DocumentFormat;
    bytes: Uint8Array;
    clientNonce?: string;
  },
): Promise<DocumentSaved> {
  const family = await documentFamily(deps.prisma, actor, input.artifactId);
  if (input.clientNonce) {
    const replayed = await findReplay(deps.prisma, actor, family.rootArtifactId, input.clientNonce);
    if (replayed) return replayed;
  }
  if (family.format !== input.format) {
    throw new DocumentError(
      "UNSUPPORTED_MEDIA_TYPE",
      415,
      "This file is a different type of document.",
    );
  }
  if (officeFormatOf(input.bytes) !== input.format) {
    throw new DocumentError(
      "UNSUPPORTED_MEDIA_TYPE",
      415,
      "This file could not be read as that type of document.",
    );
  }
  const { latest } = family;
  if (input.baseVersion !== latest.version) throw staleBase(latest);
  const botId = latest.botId;
  if (!botId) {
    throw new DocumentError(
      "GONE",
      410,
      "The agent that made this file was deleted, so it cannot take new versions.",
    );
  }
  const bot = await deps.prisma.bot.findFirst({
    where: { id: botId, spaceId: actor.spaceId, userId: actor.userId },
    select: { computer: { select: { id: true, homeKey: true, homeBytesAt: true } } },
  });
  if (await documentStorageRefusal(deps, actor.userId, bot?.computer ?? null)) {
    throw new DocumentError("STORAGE_FULL", 507, STORAGE_FULL_MESSAGE);
  }

  const context = createAdapterContext(actor, botId, `document-save:${family.rootArtifactId}`);
  const stored = await deps.artifacts.put(
    { name: latest.name, mimeType: latest.mimeType, bytes: input.bytes },
    context,
  );
  const hash = createHash("sha256").update(input.bytes).digest("hex");
  const outcome = await withResolvedArtifactVersion(
    deps.prisma,
    {
      spaceId: actor.spaceId,
      userId: actor.userId,
      botId,
      groupId: latest.groupId,
      name: latest.name,
    },
    async (tx, next) => {
      if (input.clientNonce) {
        const raced = await findReplay(tx, actor, family.rootArtifactId, input.clientNonce);
        if (raced) return { saved: raced, replay: true };
      }
      if (next.rootArtifactId !== family.rootArtifactId || next.version !== input.baseVersion + 1) {
        const newest = await tx.artifact.findFirst({
          where: { OR: [{ id: family.rootArtifactId }, { rootArtifactId: family.rootArtifactId }] },
          orderBy: [{ version: "desc" }, { createdAt: "desc" }],
          select: { id: true, version: true },
        });
        throw staleBase(newest ?? latest);
      }
      const row = await tx.artifact.create({
        data: {
          spaceId: actor.spaceId,
          userId: actor.userId,
          botId,
          groupId: latest.groupId,
          name: latest.name,
          mimeType: latest.mimeType,
          size: input.bytes.byteLength,
          hash,
          storageKey: stored.id,
          rootArtifactId: family.rootArtifactId,
          version: next.version,
          source: "studio",
          clientNonce: input.clientNonce,
        },
        select: { id: true, version: true },
      });
      return { saved: { artifactId: row.id, version: row.version }, replay: false };
    },
  ).catch(async (error: unknown) => {
    await deps.artifacts.remove(stored.id, context).catch(() => undefined);
    throw error;
  });
  if (outcome.replay) await deps.artifacts.remove(stored.id, context).catch(() => undefined);
  return outcome.saved;
}

function staleBase(latest: { id: string; version: number }) {
  return new DocumentError(
    "CONFLICT",
    409,
    "A newer version of this file was saved. Load it and make the change again.",
    { latestVersion: latest.version, artifactId: latest.id },
  );
}

/** The version an earlier save with this nonce made; a nonce from another file is refused. */
async function findReplay(
  db: Pick<Prisma.TransactionClient, "artifact">,
  actor: Pick<Actor, "spaceId" | "userId">,
  rootArtifactId: string,
  clientNonce: string,
): Promise<DocumentSaved | null> {
  const row = await db.artifact.findFirst({
    where: { spaceId: actor.spaceId, userId: actor.userId, clientNonce },
    select: { id: true, rootArtifactId: true, version: true },
  });
  if (!row) return null;
  if ((row.rootArtifactId ?? row.id) !== rootArtifactId) throw new IsolationError();
  return { artifactId: row.id, version: row.version };
}

/**
 * The agent a new file joins: the one asked for (usually the chat beside the studio) when it has a
 * folder, else the person's first agent here with a folder.
 */
async function documentBot(
  prisma: PrismaClient,
  actor: Pick<Actor, "spaceId" | "userId">,
  botId: string | undefined,
) {
  const owned = { spaceId: actor.spaceId, userId: actor.userId, archivedAt: null };
  const select = {
    id: true,
    computer: { select: { id: true, scope: true, homeKey: true, homeBytesAt: true } },
  } as const;
  const asked = botId
    ? await prisma.bot.findFirst({ where: { ...owned, id: botId }, select })
    : null;
  if (asked?.computer) return asked;
  const bot =
    (await prisma.bot.findFirst({
      where: { ...owned, computerId: { not: null } },
      orderBy: { createdAt: "asc" },
      select,
    })) ?? asked;
  if (!bot) throw new IsolationError();
  return bot;
}

function blankSpec(format: DocumentFormat, title: string, office: string | undefined) {
  if (format === "docx") return { title, ...(office ? { office } : {}), blocks: [] };
  if (format === "pptx") return { title, slides: [{ layout: "cover", title }] };
  return { title, sheets: [{ name: "Sheet1" }] };
}

/** The JSON an OCSC command printed, when its output is one JSON object. */
function printedJson(stdout: string): Record<string, unknown> | undefined {
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
 * A blank file built from the OCSC template by `ocsc <program> new` on the document runners, so
 * it carries the same branding as one the assistant makes. Runs in the agent's own runner folder
 * (its `work/` folder, which cleanup empties), then joins that agent's files.
 */
export async function createDocument(
  deps: DocumentDeps,
  actor: Pick<Actor, "spaceId" | "userId">,
  input: { format: DocumentFormat; title: string; botId?: string; office?: string },
  signal: AbortSignal,
): Promise<DocumentCreated> {
  if (!deps.toolRunner || !deps.dataDir) {
    throw new DocumentError(
      "PRECONDITION_FAILED",
      412,
      "New documents need the document runners, which this server does not have.",
    );
  }
  if (input.format === "docx" && !input.office) {
    throw new DocumentError("OFFICE_REQUIRED", 400, "Choose which office the document is from.");
  }
  const bot = await documentBot(deps.prisma, actor, input.botId);
  const computer = bot.computer;
  if (!computer) {
    throw new DocumentError(
      "PRECONDITION_FAILED",
      412,
      "This agent has no folder for documents yet.",
    );
  }
  const sharesHome = toolRunnersShareHome(
    await computerAccessFor(deps.prisma, actor.userId),
    deps.sandbox.describe().capabilities.persistentHome !== false,
  );
  const workspace = toolRunnerWorkspace({
    dataDir: deps.dataDir,
    homePath: runnerHomePath({
      home: deps.home,
      dataDir: deps.dataDir,
      homeKey: computer.homeKey,
      sharesHome,
    }),
    mode: parseComputerMode(computer.scope),
    botId: bot.id,
    folder: undefined,
  });
  if (!workspace) {
    throw new DocumentError(
      "PRECONDITION_FAILED",
      412,
      "This agent has no folder for documents yet.",
    );
  }
  const full = await storageRefusal({
    prisma: deps.prisma,
    home: deps.home,
    dataDir: deps.dataDir,
    userId: actor.userId,
    computer,
    documentsApart: !sharesHome,
  });
  if (full) throw new DocumentError("STORAGE_FULL", 507, STORAGE_FULL_MESSAGE);

  await ensureToolRunnerFolder(workspace);
  const files = folderFiles(workspace.base);
  const context = createAdapterContext(actor, bot.id, `document-create:${bot.id}`);
  const id = randomUUID();
  const spec = `work/studio/${id}.json`;
  const out = `work/studio/${id}.${input.format}`;
  const inFolder = (relative: string) => path.posix.join(workspace.cwd, relative);
  await files.writeFile(
    TOOL_RUNNER_COMPUTER,
    {
      path: inFolder(spec),
      content: new TextEncoder().encode(
        JSON.stringify(blankSpec(input.format, input.title, input.office)),
      ),
    },
    context,
  );
  const result = await deps.toolRunner.run({
    workspace,
    program: RUNNER_PROGRAM[input.format],
    args: ["new", "--spec", spec, "--out", out],
    owner: actor.userId,
    timeoutMs: CREATE_TIMEOUT_MS,
    signal,
  });
  const printed = printedJson(result.stdout);
  if (result.code !== 0 || printed?.ok !== true) {
    getLogger().warn("studio document was not made", {
      format: input.format,
      code: result.code,
      reason: (typeof printed?.error === "string" ? printed.error : result.stderr).slice(-500),
    });
    throw new DocumentError(
      "CREATE_FAILED",
      502,
      "The blank document could not be made. Try again.",
    );
  }
  const bytes = await files.readFile(TOOL_RUNNER_COMPUTER, inFolder(out), context, {
    maxBytes: attachmentMaxBytes(deps),
  });
  return addNewFamily(deps, actor, {
    botId: bot.id,
    format: input.format,
    title: input.title,
    bytes,
    context,
  });
}

/** `name` without folders, control characters or the format's extension; "Untitled" when empty. */
export function documentStem(name: string, format: DocumentFormat): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const stem = base
    .replace(/[\p{Cc}\u2028\u2029\s]+/gu, " ")
    .trim()
    .replace(new RegExp(`\\.${format}$`, "i"), "")
    .trim()
    .slice(0, ARTIFACT_NAME_MAX_LENGTH - 10)
    .trim();
  return stem || "Untitled";
}

/** Saves `bytes` as version 1 of a new family under the first free `<stem>[ (n)].<format>` name. */
async function addNewFamily(
  deps: DocumentDeps,
  actor: Pick<Actor, "spaceId" | "userId">,
  input: {
    botId: string;
    format: DocumentFormat;
    title: string;
    bytes: Uint8Array;
    context: ReturnType<typeof createAdapterContext>;
  },
): Promise<DocumentCreated> {
  const { bytes, context } = input;
  const bot = { id: input.botId };
  const mimeType = DOCUMENT_MIME_TYPES[input.format];
  const stem = documentStem(input.title, input.format);
  const stored = await deps.artifacts.put(
    { name: `${stem}.${input.format}`, mimeType, bytes },
    context,
  );
  const hash = createHash("sha256").update(bytes).digest("hex");
  try {
    // A name already in use would make this a new version of that file, so take the next free one.
    for (let n = 1; n <= 50; n += 1) {
      const name = n === 1 ? `${stem}.${input.format}` : `${stem} (${n}).${input.format}`;
      const row = await withResolvedArtifactVersion(
        deps.prisma,
        { spaceId: actor.spaceId, userId: actor.userId, botId: bot.id, name },
        async (tx, next) =>
          next.version !== 1
            ? null
            : tx.artifact.create({
                data: {
                  spaceId: actor.spaceId,
                  userId: actor.userId,
                  botId: bot.id,
                  name,
                  mimeType,
                  size: bytes.byteLength,
                  hash,
                  storageKey: stored.id,
                  version: 1,
                  source: "studio",
                },
                select: { id: true },
              }),
      );
      if (row) return { rootArtifactId: row.id, artifactId: row.id, version: 1 };
    }
    throw new DocumentError("CONFLICT", 409, "Choose another name for this document.");
  } catch (error) {
    await deps.artifacts.remove(stored.id, context).catch(() => undefined);
    throw error;
  }
}

/**
 * A file from the person's computer as version 1 of a new family, joining the same agent's files
 * `createDocument` would pick. Only real files of `format` are taken, and only while there is room.
 */
export async function uploadDocument(
  deps: DocumentDeps,
  actor: Pick<Actor, "spaceId" | "userId">,
  input: { format: DocumentFormat; name: string; botId?: string; bytes: Uint8Array },
): Promise<DocumentCreated> {
  if (officeFormatOf(input.bytes) !== input.format) {
    throw new DocumentError(
      "UNSUPPORTED_MEDIA_TYPE",
      415,
      "This file could not be read as that type of document.",
    );
  }
  const bot = await documentBot(deps.prisma, actor, input.botId);
  if (await documentStorageRefusal(deps, actor.userId, bot.computer)) {
    throw new DocumentError("STORAGE_FULL", 507, STORAGE_FULL_MESSAGE);
  }
  return addNewFamily(deps, actor, {
    botId: bot.id,
    format: input.format,
    title: input.name,
    bytes: input.bytes,
    context: createAdapterContext(actor, bot.id, `document-upload:${bot.id}`),
  });
}

/** The HTTP answer for a refused save. */
function refusal(error: unknown): { body: Record<string, unknown>; status: number } | null {
  if (error instanceof DocumentError) {
    return {
      body: { error: error.message, code: error.code, ...error.data },
      status: error.status,
    };
  }
  if (error instanceof IsolationError) {
    return { body: { error: "File not found", code: "NOT_FOUND" }, status: 404 };
  }
  return null;
}

function tooLargeBody(deps: DocumentDeps) {
  const maxBytes = attachmentMaxBytes(deps);
  return {
    error: `This file is too large. Upload limit: ${attachmentSizeLabel(maxBytes)} per file.`,
    code: "PAYLOAD_TOO_LARGE",
    maxBytes,
  };
}

/**
 * `POST /api/v1/documents/:rootId/versions?baseVersion=&format=[&clientNonce=]` with the file as
 * the body, sent as the format's own content type. Answers `{ artifactId, version }`; 409 carries
 * the newest `latestVersion` and `artifactId` when `baseVersion` is no longer the newest.
 */
export function mountDocumentVersionsRoute(
  app: Hono,
  deps: DocumentDeps,
  authenticate: (request: Request) => Promise<Actor | null>,
): void {
  // `POST /api/v1/documents?format=&name=[&botId=]` with the file as the body starts a new family
  // and answers `{ rootArtifactId, artifactId, version: 1 }`.
  app.post(DOCUMENTS_UPLOAD_PATH, async (c) => {
    const request = c.req.raw;
    const actor = await authenticate(request);
    if (!actor) {
      cancelBody(request.body);
      return c.json({ error: "Unauthorized" }, 401);
    }
    const format = DocumentFormatSchema.safeParse(c.req.query("format"));
    const name = c.req.query("name") ?? "";
    const botId = c.req.query("botId") || undefined;
    if (!format.success || name.length > 1000 || (botId !== undefined && botId.length > 100)) {
      cancelBody(request.body);
      return c.json({ error: "Send format, name and the file.", code: "BAD_REQUEST" }, 400);
    }
    const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== DOCUMENT_MIME_TYPES[format.data]) {
      cancelBody(request.body);
      return c.json(
        {
          error: `Send the file as ${DOCUMENT_MIME_TYPES[format.data]}.`,
          code: "UNSUPPORTED_MEDIA_TYPE",
        },
        415,
      );
    }
    const bytes = await readBoundedBytes(request, attachmentMaxBytes(deps));
    if (!bytes) return c.json(tooLargeBody(deps), 413);
    if (bytes.byteLength === 0) {
      return c.json({ error: "The file is empty.", code: "BAD_REQUEST" }, 400);
    }
    try {
      const created = await runAsTenant(actor, () =>
        uploadDocument(deps, actor, { format: format.data, name, botId, bytes }),
      );
      return c.json(created, 201, { "cache-control": "no-store" });
    } catch (error) {
      const refused = refusal(error);
      if (refused) return c.json(refused.body, refused.status as 400);
      getLogger().error("document upload failed", error);
      return c.json({ error: "The file was not saved." }, 500);
    }
  });

  app.post("/api/v1/documents/:rootId/versions", async (c) => {
    const request = c.req.raw;
    const actor = await authenticate(request);
    if (!actor) {
      cancelBody(request.body);
      return c.json({ error: "Unauthorized" }, 401);
    }
    const format = DocumentFormatSchema.safeParse(c.req.query("format"));
    const baseVersion = Number(c.req.query("baseVersion"));
    const clientNonce = c.req.query("clientNonce") || undefined;
    if (
      !format.success ||
      !Number.isSafeInteger(baseVersion) ||
      baseVersion < 1 ||
      (clientNonce !== undefined && clientNonce.length > 200)
    ) {
      cancelBody(request.body);
      return c.json({ error: "Send format, baseVersion and the file.", code: "BAD_REQUEST" }, 400);
    }
    // The format's own content type is never a simple one, so another site cannot post a form here.
    const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== DOCUMENT_MIME_TYPES[format.data]) {
      cancelBody(request.body);
      return c.json(
        {
          error: `Send the file as ${DOCUMENT_MIME_TYPES[format.data]}.`,
          code: "UNSUPPORTED_MEDIA_TYPE",
        },
        415,
      );
    }
    const bytes = await readBoundedBytes(request, attachmentMaxBytes(deps));
    if (!bytes) return c.json(tooLargeBody(deps), 413);
    if (bytes.byteLength === 0) {
      return c.json({ error: "The file is empty.", code: "BAD_REQUEST" }, 400);
    }
    try {
      const saved = await runAsTenant(actor, () =>
        saveDocumentVersion(deps, actor, {
          artifactId: c.req.param("rootId"),
          baseVersion,
          format: format.data,
          bytes,
          clientNonce,
        }),
      );
      return c.json(saved, 200, { "cache-control": "no-store" });
    } catch (error) {
      const refused = refusal(error);
      if (refused) return c.json(refused.body, refused.status as 400);
      getLogger().error("document save failed", error);
      return c.json({ error: "The file was not saved." }, 500);
    }
  });
}
