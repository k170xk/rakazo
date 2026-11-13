import { describe, expect, it } from "vitest";
import type { AppInit } from "../protocol.js";
import type { TableSchema } from "../schema.js";
import { mergeDelta } from "./delta.js";

const jobs: TableSchema = {
  name: "jobs",
  label: "Jobs",
  columns: [{ key: "name", label: "Name", type: "text" }],
};
const log: TableSchema = { ...jobs, name: "log", label: "Log", large: true };
const row = (id: string, name: string) => ({ _id: id, _updatedAt: "2026-11-13", name });

describe("mergeDelta", () => {
  const held: AppInit["tables"] = {
    jobs: { schema: jobs, rows: [row("a", "Quay"), row("b", "Depot"), row("c", "School")] },
    old: { schema: { ...jobs, name: "old", label: "Old" }, rows: [row("z", "Gone")] },
  };

  it("removes, replaces in place and appends, keeping the order people see", () => {
    const merged = mergeDelta(held, {
      revision: 9,
      tables: { jobs: { schema: jobs } },
      rows: { jobs: [row("d", "Library"), row("b", "Depot 2")] },
      removed: { jobs: ["c"] },
    });
    expect(merged.jobs!.rows.map((item) => item.name)).toEqual(["Quay", "Depot 2", "Library"]);
    expect(merged).not.toHaveProperty("old");
  });

  it("keeps a large table empty with its count", () => {
    const merged = mergeDelta(held, {
      revision: 9,
      tables: { jobs: { schema: jobs }, log: { schema: log, count: 12_000 } },
      rows: {},
      removed: {},
    });
    expect(merged.log).toEqual({ schema: log, rows: [], count: 12_000 });
    expect(merged.jobs!.rows).toHaveLength(3);
  });
});
