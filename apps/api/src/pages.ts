import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { SecretStore } from "@rakazo/adapter-kit";
import { forgetPageShareSecrets } from "@rakazo/adapters";
import type {
  Actor,
  PageDetail,
  PageStateValues,
  PageSummary,
  PageVisibility,
  SharedPage,
} from "@rakazo/contracts";
import {
  PAGE_SOURCE_MAX_BYTES,
  PAGE_STATE_KEY,
  PAGE_STATE_MAX_BYTES,
  PAGE_STATE_MAX_KEYS,
  type BoardItem,
  boardSource,
  pageShareTokenFromSlug,
  pageShareUrl,
  pageSourceBytes,
  shownPageKind,
} from "@rakazo/contracts";
import type { PageShareSecret, PrismaClient } from "@rakazo/db";
import { IsolationError, Prisma, recordAuditEvent, runAsSystem } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";

const PAGE_SHARE_SECRET_KIND = "page_share";
const PAGE_SHARE_PASSWORD_SECRET_KIND = "page_share_password";
const DEFAULT_LIST_LIMIT = 30;

type PageDeps = { prisma: PrismaClient; secrets: SecretStore; webOrigin: string };

const summarySelect = {
  id: true,
  title: true,
  kind: true,
  botId: true,
  groupId: true,
  visibility: true,
  currentVersion: true,
  pinnedAt: true,
  iconAssetId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PageSelect;

type SummaryRow = Prisma.PageGetPayload<{ select: typeof summarySelect }>;

function pageSummary(row: SummaryRow): PageSummary {
  return {
    id: row.id,
    title: row.title,
    kind: shownPageKind(row.kind),
    botId: row.botId,
    groupId: row.groupId,
    visibility: shownVisibility(row.visibility),
    currentVersion: row.currentVersion,
    pinned: row.pinnedAt !== null,
    ...(row.kind === "app" ? { icon: row.iconAssetId } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function shownVisibility(stored: string): PageVisibility {
  return stored === "link" || stored === "public" ? stored : "private";
}

// No 0/O or 1/I/L, so a password read aloud or from a screen is typed right first time.
const PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Twelve characters in three groups, such as K7M4-9QXT-2HPW: about 59 bits. */
function newSharePassword(): string {
  const bytes = randomBytes(12);
  const chars = [...bytes].map((byte) => PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8)].map((g) => g.join("")).join("-");
}

/** Case, spaces and dashes do not count, so "k7m4 9qxt 2hpw" opens the page too. */
function normalSharePassword(password: string): string {
  return password.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function hashSharePassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(normalSharePassword(password), salt, 32);
  return `scrypt:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

export function sharePasswordMatches(stored: string, given: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(
    normalSharePassword(given.slice(0, 200)),
    Buffer.from(salt, "base64url"),
    32,
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashPageShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A page deleted between the ownership read and the write, by another tab, reads as gone. */
async function stillThere<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new IsolationError();
    }
    throw error;
  }
}

async function requirePage(prisma: PrismaClient, actor: Actor, pageId: string) {
  const row = await prisma.page.findFirst({
    where: { id: pageId, spaceId: actor.spaceId, userId: actor.userId },
    select: {
      ...summarySelect,
      shareSecretId: true,
      sharePasswordSecretId: true,
      frozenAt: true,
    },
  });
  if (!row) throw new IsolationError();
  return row;
}

/** A company admin froze the page, so it stays private until they unfreeze it. */
export class PageFrozenError extends Error {
  constructor() {
    super("A company admin has frozen this page, so it can't be shared until they unfreeze it.");
  }
}

export class PageListCursorError extends Error {
  constructor() {
    super("Invalid page list cursor");
  }
}

type ListCursor = { pinnedAt: string | null; updatedAt: string; id: string };

function encodeCursor(row: SummaryRow): string {
  const cursor: ListCursor = {
    pinnedAt: row.pinnedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    id: row.id,
  };
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string): ListCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as ListCursor;
    const valid =
      typeof parsed.id === "string" &&
      !Number.isNaN(Date.parse(parsed.updatedAt)) &&
      (parsed.pinnedAt === null || !Number.isNaN(Date.parse(parsed.pinnedAt)));
    if (valid) return parsed;
  } catch {}
  throw new PageListCursorError();
}

/** Rows after the cursor in (pinned first by pin time, then newest update, then id) order. */
function afterCursor(cursor: ListCursor): Prisma.PageWhereInput {
  const updatedAt = new Date(cursor.updatedAt);
  const sameUpdate: Prisma.PageWhereInput = {
    OR: [{ updatedAt: { lt: updatedAt } }, { updatedAt, id: { lt: cursor.id } }],
  };
  if (cursor.pinnedAt === null) return { pinnedAt: null, ...sameUpdate };
  const pinnedAt = new Date(cursor.pinnedAt);
  return {
    OR: [{ pinnedAt: null }, { pinnedAt: { lt: pinnedAt } }, { pinnedAt, ...sameUpdate }],
  };
}

export async function listPages(
  prisma: PrismaClient,
  actor: Actor,
  input: { botId?: string; groupId?: string; cursor?: string; limit?: number; query?: string },
) {
  const limit = input.limit ?? DEFAULT_LIST_LIMIT;
  const where: Prisma.PageWhereInput = {
    spaceId: actor.spaceId,
    userId: actor.userId,
    ...(input.groupId ? { groupId: input.groupId } : {}),
    ...(input.botId ? { botId: input.botId, ...(input.groupId ? {} : { groupId: null }) } : {}),
    ...(input.cursor ? { AND: [afterCursor(decodeCursor(input.cursor))] } : {}),
    ...(input.query ? { title: { contains: input.query, mode: "insensitive" } } : {}),
  };
  const rows = await prisma.page.findMany({
    where,
    select: summarySelect,
    orderBy: [{ pinnedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(pageSummary),
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  };
}

async function shareUrlFor(
  deps: PageDeps,
  row: { title: string; visibility: string; shareSecretId: string | null },
): Promise<string | null> {
  if (shownVisibility(row.visibility) === "private") return null;
  return linkUrlFor(deps, row);
}

/** The link the page's sealed token makes, whatever its visibility is set to just now. */
async function linkUrlFor(
  deps: PageDeps,
  row: { title: string; shareSecretId: string | null },
): Promise<string | null> {
  if (!row.shareSecretId) return null;
  const secret = await deps.prisma.secret.findUnique({
    where: { id: row.shareSecretId },
    select: { id: true, ciphertext: true },
  });
  if (!secret) return null;
  const token = await deps.secrets.load(secret.ciphertext, { recordId: secret.id });
  return pageShareUrl(deps.webOrigin, row.title, token);
}

async function sharePasswordFor(
  deps: PageDeps,
  row: { visibility: string; sharePasswordSecretId: string | null },
): Promise<string | null> {
  if (row.visibility !== "public" || !row.sharePasswordSecretId) return null;
  const secret = await deps.prisma.secret.findUnique({
    where: { id: row.sharePasswordSecretId },
    select: { id: true, ciphertext: true },
  });
  if (!secret) return null;
  return deps.secrets.load(secret.ciphertext, { recordId: secret.id });
}

/** Removes the page's password, so the link opens for signed-in people only (or not at all). */
async function clearSharePassword(deps: PageDeps, pageId: string) {
  const removed = await deps.prisma.$transaction(async (tx) => {
    const current = await tx.page.findUnique({
      where: { id: pageId },
      select: { sharePasswordSecretId: true },
    });
    if (!current?.sharePasswordSecretId) return null;
    await tx.page.update({
      where: { id: pageId },
      data: { sharePasswordHash: null, sharePasswordSecretId: null },
    });
    const secret = await tx.secret.findUnique({
      where: { id: current.sharePasswordSecretId },
      select: { id: true, ciphertext: true },
    });
    await tx.secret.deleteMany({ where: { id: current.sharePasswordSecretId } });
    return secret;
  });
  if (removed) await forgetPageShareSecrets(deps.secrets, [removed]);
}

/** The page's password, made now when it has none it can read or when asked for a new one. */
async function ensureSharePassword(
  deps: PageDeps,
  actor: Actor,
  pageId: string,
  renew: boolean,
  signal: AbortSignal,
): Promise<string> {
  const current = await deps.prisma.page.findUnique({
    where: { id: pageId },
    select: { visibility: true, sharePasswordSecretId: true },
  });
  if (!current) throw new IsolationError();
  if (!renew && current.sharePasswordSecretId) {
    const existing = await sharePasswordFor(deps, { ...current, visibility: "public" }).catch(
      (error: unknown) => {
        getLogger().error("page password load", error);
        return null;
      },
    );
    if (existing) {
      if (current.visibility !== "public") {
        await deps.prisma.page.update({ where: { id: pageId }, data: { visibility: "public" } });
      }
      return existing;
    }
  }
  const password = newSharePassword();
  const stored = await deps.secrets.put(password, {
    operationId: `page-password:${pageId}`,
    traceId: `page-password:${pageId}`,
    spaceId: actor.spaceId,
    userId: actor.userId,
    signal,
  });
  let replaced: PageShareSecret | null = null;
  try {
    replaced = await deps.prisma.$transaction(async (tx) => {
      const before = await tx.page.findUnique({
        where: { id: pageId },
        select: { sharePasswordSecretId: true },
      });
      if (!before) throw new IsolationError();
      await tx.secret.create({
        data: {
          id: stored.id,
          userId: actor.userId,
          spaceId: actor.spaceId,
          kind: PAGE_SHARE_PASSWORD_SECRET_KIND,
          ciphertext: stored.ciphertext,
        },
      });
      await tx.page.update({
        where: { id: pageId },
        data: {
          visibility: "public",
          sharePasswordHash: hashSharePassword(password),
          sharePasswordSecretId: stored.id,
        },
      });
      if (!before.sharePasswordSecretId) return null;
      const old = await tx.secret.findUnique({
        where: { id: before.sharePasswordSecretId },
        select: { id: true, ciphertext: true },
      });
      await tx.secret.deleteMany({ where: { id: before.sharePasswordSecretId } });
      return old;
    });
  } catch (error) {
    await forgetPageShareSecrets(deps.secrets, [stored]);
    throw error;
  }
  if (replaced) await forgetPageShareSecrets(deps.secrets, [replaced]);
  return password;
}

export async function getPage(
  deps: PageDeps,
  actor: Actor,
  input: { pageId: string; version?: number; link?: boolean },
): Promise<PageDetail> {
  const row = await requirePage(deps.prisma, actor, input.pageId);
  const version = input.version ?? row.currentVersion;
  const [stored, owner] = await Promise.all([
    deps.prisma.pageVersion.findUnique({
      where: { pageId_version: { pageId: row.id, version } },
      select: { code: true },
    }),
    deps.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { name: true, image: true },
    }),
  ]);
  if (!stored) throw new IsolationError();
  return {
    ...pageSummary(row),
    version,
    code: stored.code,
    owner: { name: owner?.name ?? "", image: owner?.image ?? null },
    // Cards skip the secret store; a token it cannot read hides only the link.
    shareUrl: input.link
      ? await shareUrlFor(deps, row).catch((error: unknown) => {
          getLogger().error("page link token load", error);
          return null;
        })
      : null,
    sharePassword: input.link
      ? await sharePasswordFor(deps, row).catch((error: unknown) => {
          getLogger().error("page password load", error);
          return null;
        })
      : null,
  };
}

/** The board changed after this edit was made, so the save did not land. */
export class BoardChangedError extends Error {
  constructor() {
    super("The whiteboard changed. Read it again.");
  }
}

/** A board save that cannot be stored, such as a page that is not a whiteboard. */
export class BoardSaveError extends Error {}

/** The person's own edits, saved as the next version when they still match the board they changed. */
export async function saveWhiteboard(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; baseVersion: number; items: BoardItem[] },
): Promise<{ version: number }> {
  const row = await requirePage(prisma, actor, input.pageId);
  if (row.frozenAt) throw new PageFrozenError();
  if (row.kind !== "whiteboard") throw new BoardSaveError("That is not a whiteboard.");
  const source = boardSource(input.items);
  if (pageSourceBytes(source) > PAGE_SOURCE_MAX_BYTES) {
    throw new BoardSaveError("That whiteboard is too large.");
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const version = row.currentVersion + 1;
      const moved = await tx.page.updateMany({
        where: { id: row.id, currentVersion: input.baseVersion },
        data: { currentVersion: version, updatedAt: new Date() },
      });
      if (moved.count === 0) throw new BoardChangedError();
      await tx.pageVersion.create({
        data: {
          pageId: row.id,
          version,
          title: row.title,
          source,
          code: source,
          authorId: actor.userId,
          via: "board",
        },
      });
      return { version };
    });
  } catch (error) {
    if (error instanceof BoardChangedError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new BoardChangedError();
    }
    throw error;
  }
}

export async function renamePage(
  prisma: PrismaClient,
  actor: Actor,
  pageId: string,
  title: string,
) {
  await requirePage(prisma, actor, pageId);
  return pageSummary(
    await stillThere(
      prisma.page.update({
        where: { id: pageId },
        data: { title, updatedAt: new Date() },
        select: summarySelect,
      }),
    ),
  );
}

export async function pinPage(prisma: PrismaClient, actor: Actor, pageId: string, pinned: boolean) {
  const row = await requirePage(prisma, actor, pageId);
  if ((row.pinnedAt !== null) === pinned) return pageSummary(row);
  return pageSummary(
    await stillThere(
      prisma.page.update({
        where: { id: pageId },
        data: { pinnedAt: pinned ? new Date() : null },
        select: summarySelect,
      }),
    ),
  );
}

export class PageShareConflictError extends Error {
  constructor() {
    super("The page's sharing changed at the same time; try again");
  }
}

/**
 * Compare-and-swap on the link, so concurrent changes never both win or orphan a sealed token.
 * Turning on a page that already has a link keeps that link (`kept`), so two turn-ons at once
 * both hand out the one URL that works, unless that link is `next.unreadable`: its token can't
 * be loaded, so it is replaced. `replaced` is the secret a swap deleted, for the caller to remove
 * from the secret store once committed.
 */
async function swapPageShare(
  prisma: PrismaClient,
  pageId: string,
  next: {
    tokenHash: string;
    secret: { id: string; data: Prisma.SecretUncheckedCreateInput };
    unreadable: string | null;
  } | null,
): Promise<{ kept: boolean; replaced: PageShareSecret | null }> {
  for (let attempt = 0; ; attempt++) {
    const outcome = await prisma
      .$transaction(async (tx) => {
        const current = await tx.page.findUnique({
          where: { id: pageId },
          select: { shareSecretId: true },
        });
        if (!current) throw new IsolationError();
        if (next && current.shareSecretId && current.shareSecretId !== next.unreadable) {
          return { kept: true, replaced: null };
        }
        if (next) await tx.secret.create({ data: next.secret.data });
        const moved = await tx.page.updateMany({
          where: { id: pageId, shareSecretId: current.shareSecretId },
          data: next
            ? { shareTokenHash: next.tokenHash, shareSecretId: next.secret.id }
            : { visibility: "private", shareTokenHash: null, shareSecretId: null },
        });
        // Rolling back drops the new secret with the failed swap.
        if (moved.count === 0) throw new PageShareConflictError();
        if (!current.shareSecretId) return { kept: false, replaced: null };
        const replaced = await tx.secret.findUnique({
          where: { id: current.shareSecretId },
          select: { id: true, ciphertext: true },
        });
        await tx.secret.deleteMany({ where: { id: current.shareSecretId } });
        return { kept: false, replaced };
      })
      .catch((error: unknown) => {
        if (error instanceof PageShareConflictError && attempt === 0) return null;
        throw error;
      });
    if (outcome) return outcome;
  }
}

/**
 * A fresh token when the page has no live link, so a link shared before it was turned off stays
 * dead. Turning on a page that already has a link returns that link, or replaces it when its
 * token can't be read, so the owner always gets a link they can copy.
 */
export async function setPageVisibility(
  deps: PageDeps,
  actor: Actor,
  input: { pageId: string; visibility: PageVisibility; renewPassword?: boolean },
  signal: AbortSignal,
): Promise<{ visibility: PageVisibility; shareUrl: string | null; sharePassword: string | null }> {
  const row = await requirePage(deps.prisma, actor, input.pageId);
  const audit = () =>
    recordAuditEvent({
      action: "page.visibility_changed",
      actor: { type: "user", id: actor.userId },
      spaceId: actor.spaceId,
      target: { type: shownPageKind(row.kind), id: row.id, label: row.title },
      metadata: {
        from: shownVisibility(row.visibility),
        to: input.visibility,
        renewPassword: input.renewPassword === true,
      },
    });
  if (input.visibility === "private") {
    await clearSharePassword(deps, row.id);
    const { replaced } = await swapPageShare(deps.prisma, row.id, null);
    if (replaced) await forgetPageShareSecrets(deps.secrets, [replaced]);
    await audit();
    return { visibility: "private", shareUrl: null, sharePassword: null };
  }
  if (row.frozenAt) throw new PageFrozenError();
  const shareUrl = await ensureShareLink(deps, actor, row, signal);
  if (input.visibility === "link") {
    await clearSharePassword(deps, row.id);
    await deps.prisma.page.update({ where: { id: row.id }, data: { visibility: "link" } });
    await audit();
    return { visibility: "link", shareUrl, sharePassword: null };
  }
  const sharePassword = await ensureSharePassword(
    deps,
    actor,
    row.id,
    input.renewPassword === true,
    signal,
  );
  await audit();
  return { visibility: "public", shareUrl, sharePassword };
}

/** The page's live link, made now when it has none that can be read. */
async function ensureShareLink(
  deps: PageDeps,
  actor: Actor,
  row: Awaited<ReturnType<typeof requirePage>>,
  signal: AbortSignal,
): Promise<string> {
  let unreadable: string | null = null;
  const existing = await linkUrlFor(deps, row).catch((error: unknown) => {
    getLogger().error("page link token load", error);
    unreadable = row.shareSecretId;
    return null;
  });
  if (existing) return existing;
  const token = randomBytes(32).toString("base64url");
  const stored = await deps.secrets.put(token, {
    operationId: `page-share:${row.id}`,
    traceId: `page-share:${row.id}`,
    spaceId: actor.spaceId,
    userId: actor.userId,
    signal,
  });
  let swapped: Awaited<ReturnType<typeof swapPageShare>>;
  try {
    swapped = await swapPageShare(deps.prisma, row.id, {
      tokenHash: hashPageShareToken(token),
      secret: {
        id: stored.id,
        data: {
          id: stored.id,
          userId: actor.userId,
          spaceId: actor.spaceId,
          kind: PAGE_SHARE_SECRET_KIND,
          ciphertext: stored.ciphertext,
        },
      },
      unreadable,
    });
  } catch (error) {
    await forgetPageShareSecrets(deps.secrets, [stored]);
    throw error;
  }
  if (swapped.kept) {
    // Another turn-on won while this one sealed its token: both callers get the winner's link.
    await forgetPageShareSecrets(deps.secrets, [stored]);
    const winner = await linkUrlFor(deps, await requirePage(deps.prisma, actor, row.id));
    if (winner) return winner;
    throw new PageShareConflictError();
  }
  if (swapped.replaced) await forgetPageShareSecrets(deps.secrets, [swapped.replaced]);
  return pageShareUrl(deps.webOrigin, row.title, token);
}

export async function removePage(deps: PageDeps, actor: Actor, pageId: string) {
  const row = await requirePage(deps.prisma, actor, pageId);
  const removed = await deps.prisma.$transaction(async (tx) => {
    // The deleted row's link, not the one read before: a share may have swapped it since.
    const deleted = await stillThere(
      tx.page.delete({
        where: { id: row.id },
        select: { shareSecretId: true, sharePasswordSecretId: true },
      }),
    );
    const ids = [deleted.shareSecretId, deleted.sharePasswordSecretId].filter((id): id is string =>
      Boolean(id),
    );
    if (ids.length === 0) return [];
    const secrets = await tx.secret.findMany({
      where: { id: { in: ids } },
      select: { id: true, ciphertext: true },
    });
    await tx.secret.deleteMany({ where: { id: { in: ids } } });
    return secrets;
  });
  if (removed.length) await forgetPageShareSecrets(deps.secrets, removed);
  return { ok: true as const };
}

/** The current version of a page shared by link, or null for any token that does not open one. */
export async function readSharedPage(
  prisma: PrismaClient,
  token: string,
): Promise<{
  page: Omit<SharedPage, "canSaveState" | "canEditData">;
  pageId: string;
  visibility: "link" | "public";
  passwordHash: string | null;
  dataAccess: string;
  ownerId: string;
} | null> {
  if (pageShareTokenFromSlug(token) !== token) return null;
  const page = await runAsSystem("page share link", () =>
    prisma.page.findUnique({
      where: { shareTokenHash: hashPageShareToken(token) },
      select: {
        visibility: true,
        title: true,
        kind: true,
        dataAccess: true,
        currentVersion: true,
        updatedAt: true,
        id: true,
        shareSecretId: true,
        sharePasswordHash: true,
        frozenAt: true,
        userId: true,
      },
    }),
  );
  // A link lives only while its sealed token does, whatever removed the token, and never while
  // an admin has frozen the page.
  const visibility = page ? shownVisibility(page.visibility) : "private";
  if (!page || visibility === "private" || !page.shareSecretId || page.frozenAt) return null;
  const version = await runAsSystem("page share link", () =>
    prisma.pageVersion.findUnique({
      where: { pageId_version: { pageId: page.id, version: page.currentVersion } },
      select: { code: true },
    }),
  );
  if (!version) return null;
  return {
    page: {
      title: page.title,
      kind: shownPageKind(page.kind),
      code: version.code,
      version: page.currentVersion,
      updatedAt: page.updatedAt.toISOString(),
    },
    pageId: page.id,
    visibility,
    passwordHash: visibility === "public" ? page.sharePasswordHash : null,
    dataAccess: page.dataAccess,
    ownerId: page.userId,
  };
}

/** A page's saved value was too large, or the page already keeps as many keys as it may. */
export class PageStateRefusedError extends Error {}

export async function readStateRows(
  prisma: PrismaClient,
  pageId: string,
): Promise<PageStateValues> {
  const rows = await prisma.pageState.findMany({
    where: { pageId },
    select: { key: true, value: true },
    orderBy: { key: "asc" },
  });
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export async function writeStateRow(
  prisma: PrismaClient,
  pageId: string,
  key: string,
  value: unknown,
  userId: string | null,
) {
  if (!PAGE_STATE_KEY.test(key)) throw new PageStateRefusedError("That key cannot be saved");
  if (value === null || value === undefined) {
    await prisma.pageState.deleteMany({ where: { pageId, key } });
    return;
  }
  const json = JSON.stringify(value);
  if (json === undefined || json.length > PAGE_STATE_MAX_BYTES) {
    throw new PageStateRefusedError("That value is too large to save");
  }
  const stored = JSON.parse(json) as Prisma.InputJsonValue;
  const existing = await prisma.pageState.findUnique({
    where: { pageId_key: { pageId, key } },
    select: { id: true },
  });
  if (existing) {
    await prisma.pageState.update({
      where: { id: existing.id },
      data: { value: stored, updatedBy: userId },
    });
    return;
  }
  if ((await prisma.pageState.count({ where: { pageId } })) >= PAGE_STATE_MAX_KEYS) {
    throw new PageStateRefusedError("This page keeps as many values as it can");
  }
  await prisma.pageState
    .create({ data: { pageId, key, value: stored, updatedBy: userId } })
    .catch(async (error: unknown) => {
      // Two readers saving a new key at once: the later save wins, as for an existing key.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        await prisma.pageState.update({
          where: { pageId_key: { pageId, key } },
          data: { value: stored, updatedBy: userId },
        });
        return;
      }
      throw error;
    });
}

export async function getPageState(prisma: PrismaClient, actor: Actor, pageId: string) {
  await requirePage(prisma, actor, pageId);
  return { values: await readStateRows(prisma, pageId) };
}

export async function savePageState(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; key: string; value: unknown },
) {
  await requirePage(prisma, actor, input.pageId);
  await writeStateRow(prisma, input.pageId, input.key, input.value, actor.userId);
  return { ok: true as const };
}

/** For a shared link, whose reader the link (and password, or sign-in) already admitted. */
export function readSharedPageState(prisma: PrismaClient, pageId: string) {
  return runAsSystem("page share state", () => readStateRows(prisma, pageId));
}

/** Only for someone signed in to the page's company; a password reader cannot save. */
export function saveSharedPageState(
  prisma: PrismaClient,
  pageId: string,
  key: string,
  value: unknown,
  userId: string | null,
) {
  return runAsSystem("page share state", () => writeStateRow(prisma, pageId, key, value, userId));
}
