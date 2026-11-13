import { describe, expect, it } from "vitest";
import type { TableSchema } from "./schema.js";
import type { Looker, WorkspaceRole, WorkspaceView } from "./workspace.js";
import {
  addsRow,
  editsAnything,
  editsRow,
  narrowsRows,
  seesRow,
  workspaceName,
} from "./workspace.js";

const table = (extra: Partial<TableSchema> = {}): TableSchema => ({
  name: "inspections",
  label: "Inspections",
  columns: [{ key: "note", label: "Note", type: "text" }],
  ...extra,
});
const plain = table();
const personal = table({ personal: true });
const shared = table({ shared: true });

const view = (current: { id: string; role: WorkspaceRole } | null): WorkspaceView => ({
  label: "Bridge",
  create: "anyone",
  current: current ? { ...current, name: current.id } : null,
  canCreate: true,
});
const owner = (open: string | null = null): Looker => ({
  userId: "owner",
  isOwner: true,
  view: view(open ? { id: open, role: "owner" } : null),
});
const person = (userId: string, role: WorkspaceRole | null, open = "athlone"): Looker => ({
  userId,
  isOwner: false,
  view: view(role ? { id: open, role } : null),
});
const row = (workspaceId: string | null, createdBy: string | null = null) => ({
  workspaceId,
  createdBy,
});

describe("seesRow", () => {
  it("shows the owner every workspace, narrowed to the one they open", () => {
    expect(seesRow(owner(), plain, row("athlone"))).toBe(true);
    expect(seesRow(owner(), plain, row("kells"))).toBe(true);
    expect(seesRow(owner("athlone"), plain, row("kells"))).toBe(false);
    expect(seesRow(owner("athlone"), shared, row(null))).toBe(true);
  });

  it("shows others only the workspace they have open", () => {
    const bob = person("bob", "member");
    expect(seesRow(bob, plain, row("athlone"))).toBe(true);
    expect(seesRow(bob, plain, row("kells"))).toBe(false);
    expect(seesRow(bob, plain, row(null))).toBe(false);
    expect(seesRow(person("dan", null), plain, row("athlone"))).toBe(false);
  });

  it("keeps shared tables app-wide", () => {
    expect(seesRow(person("dan", null), shared, row(null))).toBe(true);
  });

  it("shows a personal table's rows to whoever added them and the workspace's leads", () => {
    expect(seesRow(person("bob", "member"), personal, row("athlone", "bob"))).toBe(true);
    expect(seesRow(person("bob", "member"), personal, row("athlone", "cara"))).toBe(false);
    expect(seesRow(person("alice", "lead"), personal, row("athlone", "cara"))).toBe(true);
  });

  it("keeps the old rules when the app has no workspaces", () => {
    const solo: Looker = { userId: "bob", isOwner: false, view: null };
    expect(seesRow(solo, plain, row(null))).toBe(true);
    expect(seesRow(solo, personal, row(null, "cara"))).toBe(false);
    expect(seesRow(solo, personal, row(null, "bob"))).toBe(true);
  });
});

describe("editsRow", () => {
  it("follows the workspace role", () => {
    const mine = row("athlone", "bob");
    const theirs = row("athlone", "cara");
    expect(editsRow(person("alice", "lead"), plain, theirs, "owner")).toBe(true);
    expect(editsRow(person("bob", "member"), plain, theirs, "company")).toBe(true);
    expect(editsRow(person("bob", "member"), plain, theirs, "contribute")).toBe(false);
    expect(editsRow(person("bob", "member"), plain, mine, "contribute")).toBe(true);
    expect(editsRow(person("cara", "viewer"), plain, row("athlone", "cara"), "company")).toBe(
      false,
    );
  });

  it("never reaches into another workspace", () => {
    expect(editsRow(person("alice", "lead"), plain, row("kells"), "company")).toBe(false);
  });

  it("lets shared tables follow the app's setting", () => {
    expect(editsRow(person("alice", "lead"), shared, row(null, "x"), "owner")).toBe(false);
    expect(editsRow(person("bob", "member"), shared, row(null, "x"), "company")).toBe(true);
  });
});

describe("addsRow", () => {
  it("waits for the owner to open a workspace", () => {
    expect(addsRow(owner(), plain, "owner")).toBe("Open a bridge to add to it.");
    expect(addsRow(owner("athlone"), plain, "owner")).toBe(true);
    expect(addsRow(owner(), shared, "owner")).toBe(true);
  });

  it("lets leads and members add, not viewers", () => {
    expect(addsRow(person("alice", "lead"), plain, "owner")).toBe(true);
    expect(addsRow(person("bob", "member"), plain, "owner")).toBe(true);
    expect(addsRow(person("cara", "viewer"), plain, "company")).toBe(
      "You can view this bridge but not add to it.",
    );
    expect(addsRow({ userId: null, isOwner: false, view: null }, plain, "company")).toBe(
      "Sign in to add to this app.",
    );
  });
});

describe("narrowsRows and editsAnything", () => {
  it("hides counts wherever someone sees part of a table", () => {
    expect(narrowsRows(owner(), plain)).toBe(false);
    expect(narrowsRows(owner("athlone"), plain)).toBe(true);
    expect(narrowsRows(person("bob", "member"), shared)).toBe(false);
    expect(narrowsRows(person("bob", "member"), plain)).toBe(true);
  });

  it("counts workspace roles as being able to change things", () => {
    expect(editsAnything(person("bob", "member"), "owner")).toBe(true);
    expect(editsAnything(person("cara", "viewer"), "owner")).toBe(false);
    expect(editsAnything(person("cara", "viewer"), "contribute")).toBe(true);
  });
});

it("tidies workspace names", () => {
  expect(workspaceName("  Athlone   Bridge ")).toBe("Athlone Bridge");
  expect(workspaceName("   ")).toBeNull();
  expect(workspaceName(3)).toBeNull();
  expect(workspaceName("x".repeat(100))?.length).toBe(80);
});
