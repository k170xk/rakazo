import type { MemberRole, WorkspaceCurrent, WorkspaceRole } from "@rakazo/app-kit/workspace";
import { MEMBER_ROLES, workspaceName } from "@rakazo/app-kit/workspace";
import type { PrismaClient } from "./generated/prisma/client.js";
import { Prisma } from "./generated/prisma/client.js";

/**
 * An app's workspaces and who is in each. People are added by work email, so a colleague who has
 * never signed in can be added; their account is linked the first time they open the app with that
 * verified email. Callers check who may do what (see @rakazo/app-kit/workspace) and run these as
 * system calls.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export const MAX_WORKSPACES_PER_APP = 500;
export const MAX_MEMBERS_PER_WORKSPACE = 200;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export class AppWorkspaceError extends Error {}

/** Someone the app knows by account, by verified email, or both. */
export type WorkspacePerson = { userId: string | null; email: string | null };

export type WorkspaceSetting = {
  label: string | null;
  create: "anyone" | "owner";
  ownerId: string;
};

export type MyWorkspace = { id: string; name: string; role: WorkspaceRole; archived: boolean };

export type WorkspaceMember = {
  id: string;
  email: string;
  name: string | null;
  role: MemberRole;
  /** Has opened the app since being added. */
  joined: boolean;
};

const ROLE_RANK: Record<string, number> = { viewer: 1, member: 2, lead: 3 };

export const memberRole = (value: unknown): MemberRole | null =>
  MEMBER_ROLES.includes(value as MemberRole) ? (value as MemberRole) : null;

export function normalEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return EMAIL.test(email) ? email : null;
}

export async function readWorkspaceSetting(
  db: Db,
  pageId: string,
): Promise<WorkspaceSetting | null> {
  const page = await db.page.findUnique({
    where: { id: pageId },
    select: { workspaceLabel: true, workspaceCreate: true, userId: true },
  });
  if (!page) return null;
  return {
    label: page.workspaceLabel,
    create: page.workspaceCreate === "owner" ? "owner" : "anyone",
    ownerId: page.userId,
  };
}

/** Rows that are this person: linked to their account, or added by their email and not yet linked. */
function memberMatch(person: WorkspacePerson): Prisma.AppWorkspaceMemberWhereInput[] {
  return [
    ...(person.userId ? [{ userId: person.userId }] : []),
    ...(person.email ? [{ email: person.email, userId: null }] : []),
  ];
}

/** Links places someone was added by email to their account, once they open the app signed in. */
export async function claimWorkspaceInvites(db: Db, pageId: string, person: WorkspacePerson) {
  if (!person.userId || !person.email) return;
  await db.appWorkspaceMember.updateMany({
    where: { pageId, email: person.email, userId: null },
    data: { userId: person.userId },
  });
}

/** The workspaces someone may open: every one for the owner, their own for anyone else. */
export async function listMyWorkspaces(
  db: Db,
  pageId: string,
  person: WorkspacePerson,
  isOwner: boolean,
): Promise<MyWorkspace[]> {
  if (isOwner) {
    const all = await db.appWorkspace.findMany({
      where: { pageId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, archivedAt: true },
    });
    return all.map((space) => ({
      id: space.id,
      name: space.name,
      role: "owner",
      archived: space.archivedAt !== null,
    }));
  }
  const match = memberMatch(person);
  if (!match.length) return [];
  const rows = await db.appWorkspaceMember.findMany({
    where: { pageId, OR: match, workspace: { archivedAt: null } },
    select: { role: true, workspace: { select: { id: true, name: true } } },
  });
  const best = new Map<string, MyWorkspace>();
  for (const row of rows) {
    const role = memberRole(row.role) ?? "viewer";
    const known = best.get(row.workspace.id);
    if (known && (ROLE_RANK[known.role] ?? 0) >= (ROLE_RANK[role] ?? 0)) continue;
    best.set(row.workspace.id, { ...row.workspace, role, archived: false });
  }
  return [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The workspace someone has open: the one they last chose while they still belong to it, else
 * (for anyone but the owner) the first of theirs. The owner starts on every workspace at once.
 */
export async function openWorkspace(
  db: Db,
  pageId: string,
  person: WorkspacePerson,
  isOwner: boolean,
  mine: MyWorkspace[],
): Promise<WorkspaceCurrent | null> {
  const choice = person.userId
    ? await db.appWorkspaceChoice.findUnique({
        where: { pageId_userId: { pageId, userId: person.userId } },
        select: { workspaceId: true },
      })
    : null;
  const pick = (space: MyWorkspace | undefined) =>
    space ? { id: space.id, name: space.name, role: space.role } : null;
  if (choice?.workspaceId) {
    const chosen = mine.find((space) => space.id === choice.workspaceId);
    if (chosen) return pick(chosen);
  }
  if (isOwner) return null;
  return pick(mine.find((space) => !space.archived));
}

/** Remembers the workspace someone opened; null is the owner's view of every workspace. */
export async function chooseWorkspace(
  db: Db,
  pageId: string,
  userId: string,
  workspaceId: string | null,
) {
  await db.appWorkspaceChoice.upsert({
    where: { pageId_userId: { pageId, userId } },
    update: { workspaceId, chosenAt: new Date() },
    create: { pageId, userId, workspaceId },
  });
}

function duplicateName(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Starts a workspace; whoever started it (unless it is the owner) leads it. */
export async function createWorkspace(
  db: PrismaClient,
  pageId: string,
  input: { name: unknown; by: WorkspacePerson; lead: boolean },
): Promise<{ id: string; name: string }> {
  const name = workspaceName(input.name);
  if (!name) throw new AppWorkspaceError("Give it a name.");
  try {
    return await db.$transaction(async (tx) => {
      const count = await tx.appWorkspace.count({ where: { pageId } });
      if (count >= MAX_WORKSPACES_PER_APP)
        throw new AppWorkspaceError(`An app can have at most ${MAX_WORKSPACES_PER_APP}.`);
      const created = await tx.appWorkspace.create({
        data: { pageId, name, createdBy: input.by.userId },
        select: { id: true, name: true },
      });
      if (input.lead && input.by.email) {
        await tx.appWorkspaceMember.create({
          data: {
            workspaceId: created.id,
            pageId,
            email: input.by.email,
            userId: input.by.userId,
            role: "lead",
            addedBy: input.by.userId,
          },
        });
      }
      return created;
    });
  } catch (error) {
    if (duplicateName(error)) throw new AppWorkspaceError(`There is already one called ${name}.`);
    throw error;
  }
}

async function ownWorkspace(db: Db, pageId: string, workspaceId: string) {
  const found = await db.appWorkspace.findFirst({
    where: { id: workspaceId, pageId },
    select: { id: true, name: true, archivedAt: true },
  });
  if (!found) throw new AppWorkspaceError("That workspace is no longer there.");
  return found;
}

export async function renameWorkspace(db: Db, pageId: string, workspaceId: string, value: unknown) {
  const name = workspaceName(value);
  if (!name) throw new AppWorkspaceError("Give it a name.");
  await ownWorkspace(db, pageId, workspaceId);
  try {
    await db.appWorkspace.update({ where: { id: workspaceId }, data: { name } });
  } catch (error) {
    if (duplicateName(error)) throw new AppWorkspaceError(`There is already one called ${name}.`);
    throw error;
  }
}

/** Hides a workspace from its members (its rows stay); the owner can bring it back. */
export async function archiveWorkspace(
  db: Db,
  pageId: string,
  workspaceId: string,
  archived: boolean,
) {
  await ownWorkspace(db, pageId, workspaceId);
  await db.appWorkspace.update({
    where: { id: workspaceId },
    data: { archivedAt: archived ? new Date() : null },
  });
}

export async function listWorkspaceMembers(
  db: Db,
  pageId: string,
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  await ownWorkspace(db, pageId, workspaceId);
  const rows = await db.appWorkspaceMember.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, userId: true, role: true },
  });
  const ids = rows.flatMap((row) => (row.userId ? [row.userId] : []));
  const users = ids.length
    ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const names = new Map(users.map((user) => [user.id, user.name]));
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.userId ? (names.get(row.userId) ?? null) : null,
    role: memberRole(row.role) ?? "viewer",
    joined: row.userId !== null,
  }));
}

/** Adds someone by work email (or changes their role if they are already in it). */
export async function addWorkspaceMember(
  db: PrismaClient,
  pageId: string,
  workspaceId: string,
  input: { email: string; role: MemberRole; addedBy: string | null },
) {
  await ownWorkspace(db, pageId, workspaceId);
  const count = await db.appWorkspaceMember.count({ where: { workspaceId } });
  const known = await db.appWorkspaceMember.findUnique({
    where: { workspaceId_email: { workspaceId, email: input.email } },
    select: { id: true },
  });
  if (!known && count >= MAX_MEMBERS_PER_WORKSPACE)
    throw new AppWorkspaceError(
      `A workspace can have at most ${MAX_MEMBERS_PER_WORKSPACE} people.`,
    );
  const user = await db.user.findFirst({
    where: { email: { equals: input.email, mode: "insensitive" }, emailVerified: true },
    select: { id: true },
  });
  await db.appWorkspaceMember.upsert({
    where: { workspaceId_email: { workspaceId, email: input.email } },
    update: { role: input.role },
    create: {
      workspaceId,
      pageId,
      email: input.email,
      userId: user?.id ?? null,
      role: input.role,
      addedBy: input.addedBy,
    },
  });
}

async function leadsLeft(db: Db, workspaceId: string, without: string) {
  return db.appWorkspaceMember.count({
    where: { workspaceId, role: "lead", id: { not: without } },
  });
}

/**
 * Changes someone's role or takes them out. Only the owner may leave a workspace without a lead,
 * so a lead cannot lock everyone else out of managing it by accident.
 */
export async function changeWorkspaceMember(
  db: PrismaClient,
  pageId: string,
  workspaceId: string,
  input: { memberId: string; role: MemberRole | null; byOwner: boolean },
) {
  await ownWorkspace(db, pageId, workspaceId);
  await db.$transaction(async (tx) => {
    const member = await tx.appWorkspaceMember.findFirst({
      where: { id: input.memberId, workspaceId },
      select: { id: true, role: true },
    });
    if (!member) throw new AppWorkspaceError("They are no longer in it.");
    const losesLead = member.role === "lead" && input.role !== "lead";
    if (losesLead && !input.byOwner && (await leadsLeft(tx, workspaceId, member.id)) === 0)
      throw new AppWorkspaceError("Make someone else a lead first.");
    if (input.role) {
      await tx.appWorkspaceMember.update({ where: { id: member.id }, data: { role: input.role } });
    } else {
      await tx.appWorkspaceMember.delete({ where: { id: member.id } });
    }
  });
}

/**
 * Puts rows that belong to no workspace (entered before workspaces were turned on) into one, in
 * every table that is not shared. Open copies pick the change up with the next revision.
 */
export async function fileUnfiledRows(db: PrismaClient, pageId: string, workspaceId: string) {
  return db.$transaction(async (tx) => {
    await ownWorkspace(tx, pageId, workspaceId);
    const tables = await tx.appTable.findMany({
      where: { pageId },
      select: { id: true, schema: true },
    });
    const scoped = tables
      .filter((table) => (table.schema as { shared?: unknown } | null)?.shared !== true)
      .map((table) => table.id);
    if (!scoped.length) return 0;
    const moved = await tx.appRow.updateMany({
      where: { pageId, tableId: { in: scoped }, workspaceId: null },
      data: { workspaceId },
    });
    if (moved.count)
      await tx.page.update({
        where: { id: pageId },
        data: { dataRevision: { increment: 1 } },
      });
    return moved.count;
  });
}

/** How many rows of tables that are not shared belong to no workspace. */
export async function countUnfiledRows(db: Db, pageId: string) {
  const tables = await db.appTable.findMany({
    where: { pageId },
    select: { id: true, schema: true },
  });
  const scoped = tables
    .filter((table) => (table.schema as { shared?: unknown } | null)?.shared !== true)
    .map((table) => table.id);
  if (!scoped.length) return 0;
  return db.appRow.count({ where: { pageId, tableId: { in: scoped }, workspaceId: null } });
}
