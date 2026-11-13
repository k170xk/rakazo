import { describe, expect, it } from "vitest";
import { QueryError, runAggregate, runQuery } from "./query.js";
import type { Row, TableSchema } from "./schema.js";

const schema: TableSchema = {
  name: "jobs",
  label: "Jobs",
  columns: [
    { key: "name", label: "Name", type: "text" },
    {
      key: "status",
      label: "Status",
      type: "enum",
      options: [{ value: "Open" }, { value: "Closed" }],
    },
    { key: "fee", label: "Fee", type: "currency" },
    { key: "due", label: "Due", type: "date" },
    { key: "urgent", label: "Urgent", type: "boolean" },
  ],
};

const rows: Row[] = [
  { _id: "a", name: "Café Dublin", status: "Open", fee: 1000, due: "2026-01-10", urgent: true },
  { _id: "b", name: "Cork Bridge", status: "Closed", fee: 2500, due: "2026-01-25" },
  { _id: "c", name: "Galway Quay", status: "Open", fee: null, due: "2026-02-03" },
  { _id: "d", name: "Dublin Port", status: "Open", fee: 400, due: "" },
];

describe("runQuery", () => {
  it("needs every search word, ignoring accents and order", () => {
    expect(runQuery(schema, rows, { search: "dublin cafe" }).rows.map((r) => r._id)).toEqual(["a"]);
    expect(runQuery(schema, rows, { search: "dublin" }).total).toBe(2);
  });

  it("filters, sorts with blanks last and pages", () => {
    const result = runQuery(schema, rows, {
      filters: [{ column: "status", op: "eq", value: "open" }],
      sort: { column: "fee", dir: "desc" },
      pageSize: 2,
    });
    expect(result.total).toBe(3);
    expect(result.rows.map((r) => r._id)).toEqual(["a", "d"]);
    expect(
      runQuery(schema, rows, { sort: { column: "fee" }, page: 1, pageSize: 2 }).rows.map(
        (r) => r._id,
      ),
    ).toEqual(["b", "c"]);
  });

  it("compares numbers and dates, and checks for blanks", () => {
    const ids = (filters: Parameters<typeof runQuery>[2]) =>
      runQuery(schema, rows, filters).rows.map((r) => r._id);
    expect(ids({ filters: [{ column: "fee", op: "gte", value: "1000" }] })).toEqual(["a", "b"]);
    expect(ids({ filters: [{ column: "due", op: "lt", value: "2026-02-01" }] })).toEqual([
      "a",
      "b",
    ]);
    expect(ids({ filters: [{ column: "fee", op: "empty" }] })).toEqual(["c"]);
    expect(ids({ filters: [{ column: "urgent", op: "eq", value: true }] })).toEqual(["a"]);
    expect(ids({ filters: [{ column: "status", op: "in", value: ["Closed"] }] })).toEqual(["b"]);
  });

  it("refuses unknown columns and ops", () => {
    expect(() => runQuery(schema, rows, { sort: { column: "nope" } })).toThrow(QueryError);
    expect(() =>
      runQuery(schema, rows, { filters: [{ column: "fee", op: "like" as never }] }),
    ).toThrow(QueryError);
  });
});

describe("runAggregate", () => {
  it("counts and sums by a column, biggest group first", () => {
    const result = runAggregate(schema, rows, {
      groupBy: "status",
      metrics: [{ op: "count" }, { op: "sum", column: "fee", as: "fees" }],
    });
    expect(result.total).toBe(4);
    expect(result.groups).toEqual([
      { key: "Open", values: { count: 3, fees: 1400 } },
      { key: "Closed", values: { count: 1, fees: 2500 } },
    ]);
  });

  it("buckets dates in order and keeps blanks as null", () => {
    const result = runAggregate(schema, rows, { groupBy: "due", bucket: "month" });
    expect(result.groups.map((group) => group.key)).toEqual(["2026-01", "2026-02", null]);
  });

  it("has one group without groupBy, and null for sums of nothing", () => {
    expect(
      runAggregate(schema, rows, {
        filters: [{ column: "fee", op: "empty" }],
        metrics: [{ op: "avg", column: "fee" }],
      }).groups,
    ).toEqual([{ key: "all", values: { avg_fee: null } }]);
  });
});
