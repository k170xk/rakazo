import { describe, expect, it, vi } from "vitest";
import { appChangeNeedsPerson, appChangeOf } from "./app-change-gate.js";
import type { RunContext } from "./run-context.js";

function ctxWith(
  page: { visibility: string; evolvePluginSlug: string | null } | null,
  colleagueRow = false,
  tables: Array<{ schema: unknown }> = [],
) {
  const appRow = { findFirst: vi.fn(async () => (colleagueRow ? { id: "row-1" } : null)) };
  const appTable = { findMany: vi.fn(async () => tables) };
  const prisma = { page: { findFirst: vi.fn(async () => page) }, appRow, appTable };
  const ctx = {
    deps: { prisma },
    run: { spaceId: "space-1", userId: "owner-1" },
  } as unknown as RunContext;
  return { ctx, prisma };
}

describe("appChangeOf", () => {
  it("ignores new apps and pages, which start private", () => {
    expect(appChangeOf("save_app", { title: "New", files: { "App.tsx": "x" } })).toBeNull();
    expect(appChangeOf("save_page", { title: "New", source: "x" })).toBeNull();
  });

  it("separates what readers see from data refreshes", () => {
    expect(appChangeOf("save_app", { appId: "a", edits: [{ find: "a", replace: "b" }] })).toEqual({
      pageId: "a",
      code: true,
      wipes: [],
      unprivate: [],
    });
    expect(appChangeOf("save_page", { pageId: "p", data: { rows: [] } })?.code).toBe(false);
    expect(appChangeOf("save_page", { pageId: "p", source: "x" })?.code).toBe(true);
    expect(appChangeOf("app_asset", { appId: "a", url: "u" })?.code).toBe(true);
    expect(appChangeOf("app_data", { appId: "a", action: "insert", table: "t" })).toEqual({
      pageId: "a",
      code: false,
      wipes: [],
      unprivate: [],
    });
    expect(appChangeOf("save_app", { appId: "a", edits: [] })?.code).toBe(false);
  });

  it("names the tables a call would empty", () => {
    expect(
      appChangeOf("app_data", { appId: "a", action: "replace", table: "jobs" })?.wipes,
    ).toEqual(["jobs"]);
    expect(appChangeOf("app_data", { appId: "a", action: "drop", table: "jobs" })?.wipes).toEqual([
      "jobs",
    ]);
    const tables = [
      { schema: { name: "jobs" }, rows: [] },
      { schema: { name: "log" }, rows: [], mode: "append" },
      { schema: { name: "kept" } },
    ];
    expect(appChangeOf("save_app", { appId: "a", tables })).toEqual({
      pageId: "a",
      code: false,
      wipes: ["jobs"],
      unprivate: [],
    });
    // A workbook merges into an existing app's tables (upsert or append), like a data refresh.
    expect(appChangeOf("save_app", { appId: "a", workbook: { path: "x.xlsx" } })).toEqual({
      pageId: "a",
      code: false,
      wipes: [],
      unprivate: [],
    });
  });
});

describe("appChangeNeedsPerson", () => {
  it("asks before code changes to a shared or published app", async () => {
    const edit = { appId: "a", edits: [{ find: "a", replace: "b" }] };
    expect(
      await appChangeNeedsPerson(
        ctxWith({ visibility: "link", evolvePluginSlug: null }).ctx,
        "save_app",
        edit,
      ),
    ).toBe(true);
    expect(
      await appChangeNeedsPerson(
        ctxWith({ visibility: "private", evolvePluginSlug: "tracker" }).ctx,
        "save_app",
        edit,
      ),
    ).toBe(true);
    expect(
      await appChangeNeedsPerson(
        ctxWith({ visibility: "private", evolvePluginSlug: null }).ctx,
        "save_app",
        edit,
      ),
    ).toBe(false);
  });

  it("lets a routine refresh a shared app's own rows", async () => {
    const shared = ctxWith({ visibility: "link", evolvePluginSlug: null });
    expect(
      await appChangeNeedsPerson(shared.ctx, "app_data", {
        appId: "a",
        action: "replace",
        table: "jobs",
      }),
    ).toBe(false);
    expect(
      await appChangeNeedsPerson(shared.ctx, "save_page", { pageId: "p", data: { jobs: [] } }),
    ).toBe(false);
  });

  it("asks before emptying a table colleagues wrote in", async () => {
    const { ctx, prisma } = ctxWith({ visibility: "private", evolvePluginSlug: null }, true);
    expect(
      await appChangeNeedsPerson(ctx, "app_data", { appId: "a", action: "drop", table: "jobs" }),
    ).toBe(true);
    expect(prisma.appRow.findFirst).toHaveBeenCalledWith({
      where: {
        pageId: "a",
        createdBy: { not: null, notIn: ["owner-1"] },
        table: { name: { in: ["jobs"] } },
      },
      select: { id: true },
    });
  });

  it("asks before a personal table is opened to everyone", async () => {
    const unprivate = { appId: "a", tables: [{ schema: { name: "visits", personal: false } }] };
    expect(appChangeOf("save_app", unprivate)?.unprivate).toEqual(["visits"]);
    const personal = ctxWith({ visibility: "private", evolvePluginSlug: null }, false, [
      { schema: { name: "visits", personal: true } },
    ]);
    expect(await appChangeNeedsPerson(personal.ctx, "save_app", unprivate)).toBe(true);
    expect(personal.prisma.appTable.findMany).toHaveBeenCalledWith({
      where: { pageId: "a", name: { in: ["visits"] } },
      select: { schema: true },
    });
    const already = ctxWith({ visibility: "private", evolvePluginSlug: null }, false, [
      { schema: { name: "visits" } },
    ]);
    expect(await appChangeNeedsPerson(already.ctx, "save_app", unprivate)).toBe(false);
    // A schema sent without the flag keeps the table personal, so it is a plain refresh.
    expect(
      appChangeOf("save_app", { appId: "a", tables: [{ schema: { name: "visits" } }] })?.unprivate,
    ).toEqual([]);
  });

  it("only looks at the run owner's own apps", async () => {
    const { ctx, prisma } = ctxWith(null);
    expect(await appChangeNeedsPerson(ctx, "app_asset", { appId: "a", url: "u" })).toBe(false);
    expect(prisma.page.findFirst).toHaveBeenCalledWith({
      where: { id: "a", spaceId: "space-1", userId: "owner-1" },
      select: { visibility: true, evolvePluginSlug: true },
    });
  });
});
