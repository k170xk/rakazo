import type { AppDelta, AppInit } from "../protocol.js";
import { isLargeTable } from "../schema.js";

/**
 * The tables after others' changes: every table the delta names (tables it leaves out were
 * dropped), removed rows gone, changed rows replaced where they stand and new rows at the end.
 * A large table holds no rows here; its count comes along instead.
 */
export function mergeDelta(tables: AppInit["tables"], delta: AppDelta): AppInit["tables"] {
  const merged: AppInit["tables"] = {};
  for (const [name, { schema, count }] of Object.entries(delta.tables)) {
    const gone = new Set(delta.removed[name] ?? []);
    const changedRows = delta.rows[name] ?? [];
    let rows = isLargeTable(schema) ? [] : (tables[name]?.rows ?? []);
    if (gone.size) rows = rows.filter((row) => !gone.has(row._id));
    if (changedRows.length) {
      const byId = new Map(changedRows.map((row) => [row._id, row]));
      rows = rows.map((row) => {
        const next = byId.get(row._id);
        if (next) byId.delete(row._id);
        return next ?? row;
      });
      rows = [...rows, ...byId.values()];
    }
    merged[name] = { schema, rows, ...(count === undefined ? {} : { count }) };
  }
  return merged;
}
