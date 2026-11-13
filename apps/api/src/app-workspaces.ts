import type { Looker, MemberRole, WorkspaceView } from "@rakazo/app-kit/workspace";
import { MAX_WORKSPACE_LABEL, managesWorkspace } from "@rakazo/app-kit/workspace";
import { provenEmail } from "@rakazo/core";
import type { MyWorkspace, PrismaClient, WorkspacePerson } from "@rakazo/db";
import {
  AppWorkspaceError,
  addWorkspaceMember,
  archiveWorkspace,
  changeWorkspaceMember,
  chooseWorkspace,
  claimWorkspaceInvites,
  countUnfiledRows,
  createWorkspace,
  fileUnfiledRows,
  listMyWorkspaces,
  listWorkspaceMembers,
  memberRole,
  normalEmail,
  openWorkspace,
  readWorkspaceSetting,
  renameWorkspace,
  runAsSystem,
} from "@rakazo/db";
import { sameCompanyEmail } from "./company-email.js";

/**
 * Who is looking at an app with workspaces, and the workspace management requests (open, start,
 * rename, archive, members). Every route that admits someone (the owner's session, a shared link,
 * Evolve's signed call) resolves a Looker here, and the row rules in @rakazo/app-kit/workspace
 * then decide what they see and change.
 */

export class WorkspaceRefused extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 = 400,
  ) {
    super(message);
  }
}

/** Someone a route admitted: their account (null for a visitor) and, from Evolve, their email. */
export type Admitted = { pageId: string; userId: string | null; email?: string | null };

export type ResolvedLooker = Looker & {
  person: WorkspacePerson;
  ownerId: string;
  /** Every workspace they may open; empty when the app has none. */
  mine: MyWorkspace[];
};

async function personOf(prisma: PrismaClient, admitted: Admitted): Promise<WorkspacePerson> {
  if (admitted.email !== undefined || !admitted.userId)
    return { userId: admitted.userId, email: normalEmail(admitted.email ?? null) };
  const userId = admitted.userId;
  const user = await runAsSystem("app viewer's email for workspaces", () =>
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerified: true } }),
  );
  return { userId, email: normalEmail(provenEmail(user)) };
}

/** The looker for someone a route admitted: owner or not, and the workspace they have open. */
export async function resolveLooker(
  prisma: PrismaClient,
  admitted: Admitted,
): Promise<ResolvedLooker> {
  const setting = await runAsSystem("app workspace setting", () =>
    readWorkspaceSetting(prisma, admitted.pageId),
  );
  if (!setting) throw new WorkspaceRefused("This app is no longer here.", 404);
  const isOwner = admitted.userId !== null && admitted.userId === setting.ownerId;
  const base = { userId: admitted.userId, isOwner, ownerId: setting.ownerId };
  if (!setting.label) {
    return { ...base, view: null, person: { userId: admitted.userId, email: null }, mine: [] };
  }
  const label = setting.label;
  const person = await personOf(prisma, admitted);
  const { mine, current } = await runAsSystem("app workspaces for a viewer", async () => {
    await claimWorkspaceInvites(prisma, admitted.pageId, person);
    const mine = await listMyWorkspaces(prisma, admitted.pageId, person, isOwner);
    return { mine, current: await openWorkspace(prisma, admitted.pageId, person, isOwner, mine) };
  });
  const view: WorkspaceView = {
    label,
    create: setting.create,
    current,
    canCreate: isOwner || (setting.create === "anyone" && admitted.userId !== null),
  };
  return { ...base, view, person, mine };
}

/** What the kit shows in its workspace bar. */
export function workspaceSummary(looker: ResolvedLooker) {
  if (!looker.view) return null;
  return {
    ...looker.view,
    workspaces: looker.mine
      .filter((space) => looker.isOwner || !space.archived)
      .map((space) => ({
        id: space.id,
        name: space.name,
        role: space.role,
        ...(space.archived ? { archived: true } : {}),
      })),
  };
}

const objectOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const idOf = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;

/** The workspace a request names, with the role this looker has in it. */
function named(looker: ResolvedLooker, value: unknown) {
  const id = idOf(value);
  const space = id ? looker.mine.find((entry) => entry.id === id) : undefined;
  if (!space) throw new WorkspaceRefused("That workspace is not one of yours.", 404);
  return space;
}

function manager(looker: ResolvedLooker, value: unknown) {
  const space = named(looker, value);
  if (!managesWorkspace(space.role))
    throw new WorkspaceRefused("Only its leads and the app's owner can do that.", 403);
  return space;
}

async function ownerEmail(prisma: PrismaClient, ownerId: string) {
  const owner = await runAsSystem("app owner's email", () =>
    prisma.user.findUnique({ where: { id: ownerId }, select: { email: true } }),
  );
  return owner?.email ?? null;
}

export const WORKSPACE_OPS = new Set([
  "workspaces.list",
  "workspaces.open",
  "workspaces.save",
  "workspaces.members",
  "workspaces.member",
]);

/**
 * One workspace request. Opening one is remembered for the person; starting one follows the
 * app's setting; renaming, archiving and choosing members are for its leads and the owner, and
 * only colleagues at the owner's company can be added.
 */
export async function workspaceOp(
  prisma: PrismaClient,
  admitted: Admitted,
  op: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const looker = await resolveLooker(prisma, admitted);
  if (!looker.view) throw new WorkspaceRefused("This app has no workspaces.", 404);
  const pageId = admitted.pageId;
  const request = objectOf(input);
  const system = <T>(reason: string, fn: () => Promise<T>) => runAsSystem(reason, fn);
  try {
    if (op === "workspaces.list") return workspaceSummary(looker);
    if (!looker.userId) throw new WorkspaceRefused("Sign in to do that.", 403);
    const userId = looker.userId;

    if (op === "workspaces.open") {
      const id = request.workspace === null ? null : named(looker, request.workspace).id;
      if (id === null && !looker.isOwner)
        throw new WorkspaceRefused("Choose one of your workspaces.", 400);
      await system("open an app workspace", () => chooseWorkspace(prisma, pageId, userId, id));
      return workspaceSummary(await resolveLooker(prisma, admitted));
    }

    if (op === "workspaces.save") {
      if (request.workspace === undefined) {
        if (!looker.view.canCreate)
          throw new WorkspaceRefused("Only the app's owner starts new ones here.", 403);
        const created = await system("start an app workspace", () =>
          createWorkspace(prisma, pageId, {
            name: request.name,
            by: looker.person,
            lead: !looker.isOwner,
          }),
        );
        await system("open an app workspace", () =>
          chooseWorkspace(prisma, pageId, userId, created.id),
        );
        return workspaceSummary(await resolveLooker(prisma, admitted));
      }
      const space = manager(looker, request.workspace);
      if (request.name !== undefined)
        await system("rename an app workspace", () =>
          renameWorkspace(prisma, pageId, space.id, request.name),
        );
      if (typeof request.archived === "boolean") {
        if (!request.archived && !looker.isOwner)
          throw new WorkspaceRefused("Only the app's owner can bring one back.", 403);
        await system("archive an app workspace", () =>
          archiveWorkspace(prisma, pageId, space.id, request.archived === true),
        );
      }
      return workspaceSummary(await resolveLooker(prisma, admitted));
    }

    if (op === "workspaces.members") {
      const space = named(looker, request.workspace);
      const members = await system("app workspace members", () =>
        listWorkspaceMembers(prisma, pageId, space.id),
      );
      const manages = managesWorkspace(space.role);
      // Viewers and members see who else is in it, but not the email addresses.
      return members.map((member) => ({
        id: member.id,
        name: member.name ?? (manages ? null : "Invited colleague"),
        role: member.role,
        joined: member.joined,
        ...(manages ? { email: member.email } : {}),
        ...(member.email === looker.person.email ? { me: true } : {}),
      }));
    }

    if (op === "workspaces.member") {
      const space = manager(looker, request.workspace);
      const role: MemberRole | null = request.remove === true ? null : memberRole(request.role);
      if (request.remove !== true && !role)
        throw new WorkspaceRefused("Choose lead, member or viewer.");
      if (typeof request.memberId === "string") {
        const memberId = idOf(request.memberId);
        if (!memberId) throw new WorkspaceRefused("Choose someone in it.");
        await system("change an app workspace member", () =>
          changeWorkspaceMember(prisma, pageId, space.id, {
            memberId,
            role,
            byOwner: looker.isOwner,
          }),
        );
      } else {
        const email = normalEmail(request.email);
        if (!email || !role) throw new WorkspaceRefused("Enter a work email address.");
        const owner = await ownerEmail(prisma, looker.ownerId);
        if (!owner || !sameCompanyEmail(email, owner))
          throw new WorkspaceRefused("Only colleagues at your company can be added.");
        await system("add an app workspace member", () =>
          addWorkspaceMember(prisma, pageId, space.id, { email, role, addedBy: userId }),
        );
      }
      return workspaceOp(prisma, admitted, "workspaces.members", { workspace: space.id });
    }
  } catch (error) {
    if (error instanceof AppWorkspaceError) throw new WorkspaceRefused(error.message);
    throw error;
  }
  throw new WorkspaceRefused("That is not a workspace request.", 404);
}

/** The owner's setting: workspaces off (null label) or on, and who may start them. */
export async function setAppWorkspaces(
  prisma: PrismaClient,
  pageId: string,
  input: { label: string | null; create: "anyone" | "owner"; fileInto?: string | null },
) {
  const label = input.label?.replace(/\s+/g, " ").trim().slice(0, MAX_WORKSPACE_LABEL) || null;
  await prisma.page.update({
    where: { id: pageId },
    data: { workspaceLabel: label, workspaceCreate: input.create },
  });
  let filed = 0;
  if (label && input.fileInto) {
    const name = input.fileInto;
    filed = await runAsSystem("file an app's rows into a workspace", async () => {
      const found = await prisma.appWorkspace.findFirst({
        where: { pageId, name },
        select: { id: true },
      });
      const id =
        found?.id ??
        (
          await createWorkspace(prisma, pageId, {
            name,
            by: { userId: null, email: null },
            lead: false,
          })
        ).id;
      return fileUnfiledRows(prisma, pageId, id);
    });
  }
  const unfiled = label
    ? await runAsSystem("count an app's unfiled rows", () => countUnfiledRows(prisma, pageId))
    : 0;
  return { label, create: input.create, filed, unfiled };
}

export async function readAppWorkspaceSettings(prisma: PrismaClient, pageId: string) {
  const setting = await runAsSystem("app workspace setting", () =>
    readWorkspaceSetting(prisma, pageId),
  );
  const [workspaces, unfiled] = setting?.label
    ? await runAsSystem("app workspaces", () =>
        Promise.all([
          prisma.appWorkspace.count({ where: { pageId } }),
          countUnfiledRows(prisma, pageId),
        ]),
      )
    : [0, 0];
  return {
    label: setting?.label ?? null,
    create: setting?.create ?? "anyone",
    workspaces,
    unfiled,
  };
}
