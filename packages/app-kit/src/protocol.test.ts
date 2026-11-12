import { describe, expect, it } from "vitest";
import { APP_REQUEST, readAppRequest, requestMessage, requestRef } from "./protocol.js";

describe("app requests", () => {
  it("keeps the message id when the request names a row or picture", () => {
    const update = requestMessage("r7", {
      op: "rows.update",
      table: "jobs",
      id: "row-1",
      patch: {},
    });
    expect(update).toMatchObject({ type: APP_REQUEST, id: "r7", ref: "row-1", op: "rows.update" });
    expect(requestRef(readAppRequest(update)!)).toBe("row-1");
    const asset = requestMessage("r8", { op: "asset", id: "icon-1" });
    expect(asset).toMatchObject({ id: "r8", ref: "icon-1" });
    expect(requestMessage("r9", { op: "init" })).not.toHaveProperty("ref");
  });

  it("reads the row from id for frames built before ref", () => {
    const older = readAppRequest({
      type: APP_REQUEST,
      id: "row-1",
      op: "rows.remove",
      table: "jobs",
    });
    expect(requestRef(older!)).toBe("row-1");
  });
});
