import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApp } from "../build/index.js";
import { matchesPin, sha256Hex } from "./hash.js";
import { modelKey, remember, shouldLoadModel } from "./load.js";
import { allowEngineRequest, ENGINE_REQUESTS_PER_MINUTE, isIfcFileRequest } from "./runtime.js";
import { ifcWorker } from "./worker.js";

describe("IFC engine", () => {
  it("checks a file with the same SHA-256 as the platform", () => {
    const bytes = new TextEncoder().encode("abc");
    const hash = createHash("sha256").update(bytes).digest("hex");
    expect(sha256Hex(bytes)).toBe(hash);
    expect(matchesPin(bytes, { sha256: hash, bytes: bytes.length })).toBe(true);
    expect(matchesPin(bytes, { sha256: hash, bytes: bytes.length + 1 })).toBe(false);
  });

  it("refuses a runtime file that is not a plain name", () => {
    expect(isIfcFileRequest("0.0.71", "web-ifc.wasm")).toBe(true);
    expect(isIfcFileRequest("0.0.71", "../web-ifc.wasm")).toBe(false);
    expect(isIfcFileRequest("latest", "web-ifc.wasm")).toBe(false);
    expect(isIfcFileRequest("0.0.71", "web-ifc.wasm?x=1")).toBe(false);
  });

  it("does not ask the server again for a file it already has, and stops a burst", async () => {
    const cache = new Map<string, Promise<string>>();
    let loads = 0;
    const load = () => {
      loads += 1;
      return Promise.resolve("engine");
    };
    await Promise.all([remember(cache, "wasm", load), remember(cache, "wasm", load)]);
    expect(loads).toBe(1);
    expect(await remember(cache, "wasm", load)).toBe("engine");
    expect(loads).toBe(1);
    const failing = new Map<string, Promise<string>>();
    await expect(remember(failing, "missing", () => Promise.reject(new Error("down")))).rejects.toThrow("down");
    await expect(remember(failing, "missing", () => Promise.resolve("back"))).resolves.toBe("back");

    const same = new Uint8Array([1, 2, 3, 4]);
    expect(modelKey(same)).toBe(modelKey(new Uint8Array(same)));
    expect(shouldLoadModel("", undefined)).toBe(false);
    expect(shouldLoadModel("", "asset-1")).toBe(true);

    const budget = { windowStart: 0, count: 0 };
    for (let n = 0; n < ENGINE_REQUESTS_PER_MINUTE; n += 1) expect(allowEngineRequest(budget, 1_000)).toBe(true);
    expect(allowEngineRequest(budget, 1_000)).toBe(false);
    expect(allowEngineRequest(budget, 61_000)).toBe(true);
    expect(ifcWorker.toString()).not.toContain("PRODUCT_CAP");
    expect(ifcWorker.toString()).toContain("StreamAllMeshes");
  });

  it("keeps the viewer out of the app bundle", async () => {
    const built = await buildApp({
      "App.tsx": `import { IfcView } from "@ocsc/ifc";
import { AppShell, Theme } from "@ocsc/ui";
export default function App() {
  return <><Theme preset="evolve" /><AppShell title="Model"><IfcView /></AppShell></>;
}`,
    });
    expect(built.ok ? [] : built.errors).toEqual([]);
    if (!built.ok) return;
    expect(built.bytes).toBeLessThan(2_000_000);
    expect(built.js).not.toContain("__getOwnPropNames");
    expect(built.js).toContain("web-ifc.wasm");
  });
});
