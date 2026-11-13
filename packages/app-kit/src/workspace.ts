import type { TableSchema } from "./schema.js";
import { isPersonalTable } from "./schema.js";

/**
 * Workspaces split one app's data by bridge, project or client: the same screens for everyone,
 * but each person sees only the workspaces they belong to. Tables marked shared stay one list for
 * the whole app. These rules decide what a person sees and may change; the server applies them to
 * every read and write, and the kit uses the same ones to show or hide buttons.
 */

/** The app's owner sees and manages every workspace; the rest are a workspace's members. */
export type WorkspaceRole = "owner" | "lead" | "member" | "viewer";

export const MEMBER_ROLES = ["lead", "member", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export type WorkspaceCurrent = { id: string; name: string; role: WorkspaceRole };

/** An app's workspaces as one person sees them; null when the app keeps a single dataset. */
export type WorkspaceView = {
  /** What one workspace is called: "Bridge", "Project". */
  label: string;
  /** Who may start a workspace. */
  create: "anyone" | "owner";
  /** The workspace they have open; null is the owner looking at all, or someone with none yet. */
  current: WorkspaceCurrent | null;
  canCreate: boolean;
};

/** What an app is told at start: the view and every workspace this person may open. */
export type WorkspaceSummary = WorkspaceView & {
  workspaces: Array<{ id: string; name: string; role: WorkspaceRole; archived?: boolean }>;
};

/** One person reading or writing: who they are, whether they own the app, and their workspace. */
export type Looker = {
  userId: string | null;
  isOwner: boolean;
  view: WorkspaceView | null;
};

/** What the rules need to know about a row. */
export type RowFacts = { workspaceId: string | null; createdBy: string | null };

/** The app's setting for who besides the owner changes rows outside workspaces. */
export type DataAccess = "owner" | "contribute" | "company" | string;

/** Whether a table's rows belong to workspaces in this app. */
export const inWorkspaces = (
  view: WorkspaceView | null | undefined,
  schema: Pick<TableSchema, "shared"> | null | undefined,
): view is WorkspaceView => Boolean(view) && schema?.shared !== true;

export const MAX_WORKSPACE_NAME = 80;
export const MAX_WORKSPACE_LABEL = 30;

export function workspaceName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim().slice(0, MAX_WORKSPACE_NAME);
  return name || null;
}

/**
 * Whether someone sees a row. Outside workspaces, a personal table shows each person only their
 * own rows. Inside, only rows of the workspace they have open, and a personal table's rows only
 * to whoever added them and the workspace's leads. The owner sees everything, narrowed to one
 * workspace when they open one.
 */
export function seesRow(looker: Looker, schema: TableSchema, row: RowFacts): boolean {
  const scoped = inWorkspaces(looker.view, schema);
  if (looker.isOwner) {
    const open = scoped ? looker.view?.current : null;
    return !open || row.workspaceId === open.id;
  }
  const own = looker.userId !== null && row.createdBy === looker.userId;
  if (!scoped) return !isPersonalTable(schema) || own;
  const open = looker.view?.current;
  if (!open || row.workspaceId !== open.id) return false;
  return !isPersonalTable(schema) || open.role === "lead" || own;
}

/** Whether a table shows this person fewer rows than it holds (so its row count stays hidden). */
export function narrowsRows(looker: Looker, schema: TableSchema): boolean {
  if (inWorkspaces(looker.view, schema)) return !looker.isOwner || looker.view.current !== null;
  return isPersonalTable(schema) && !looker.isOwner;
}

const colleaguesWrite = (access: DataAccess) => access === "company" || access === "contribute";

/**
 * Whether someone may change or remove a row they can see. Outside workspaces the app's setting
 * decides (everyone, only their own rows, or only the owner). Inside, the workspace role does:
 * leads change any row, members any row unless the app or table keeps people to their own, and
 * viewers none.
 */
export function editsRow(
  looker: Looker,
  schema: TableSchema,
  row: RowFacts,
  access: DataAccess,
): boolean {
  if (!seesRow(looker, schema, row)) return false;
  if (looker.isOwner) return true;
  if (looker.userId === null) return false;
  const own = row.createdBy === looker.userId;
  if (!inWorkspaces(looker.view, schema)) {
    if (isPersonalTable(schema)) return own && colleaguesWrite(access);
    return access === "company" || (access === "contribute" && own);
  }
  const role = looker.view?.current?.role;
  if (role === "lead") return true;
  if (role !== "member") return false;
  return access === "contribute" || isPersonalTable(schema) ? own : true;
}

/** Whether someone may add rows to a table, and why not when they may not. */
export function addsRow(looker: Looker, schema: TableSchema, access: DataAccess): true | string {
  const scoped = inWorkspaces(looker.view, schema);
  const label = looker.view?.label.toLowerCase() ?? "workspace";
  if (scoped && !looker.view?.current) return `Open a ${label} to add to it.`;
  if (looker.isOwner) return true;
  if (looker.userId === null) return "Sign in to add to this app.";
  if (!scoped) return colleaguesWrite(access) ? true : "Only the app's owner can add to this.";
  const role = looker.view?.current?.role;
  return role === "lead" || role === "member"
    ? true
    : `You can view this ${label} but not add to it.`;
}

/** Whether someone may change anything in the app: rows outside workspaces, or in the open one. */
export function editsAnything(looker: Looker, access: DataAccess): boolean {
  if (looker.isOwner) return true;
  if (looker.userId === null) return false;
  const role = looker.view?.current?.role;
  return colleaguesWrite(access) || role === "lead" || role === "member";
}

/** Who may rename a workspace, archive it and choose its members: its leads and the app's owner. */
export const managesWorkspace = (role: WorkspaceRole | null | undefined) =>
  role === "owner" || role === "lead";
