import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { PYTHON_RUNTIME_PATH, PYTHON_RUNTIMES } from "@rakazo/app-kit/python/runtime";
import { describe, expect, it, vi } from "vitest";
import { pythonRuntimeMiddleware } from "./python-runtime";

const dir = path.resolve("/srv/dist/python");
const pins: Array<{ version: string; files: Record<string, { bytes: number }> }> = [
  { version: "2.0.0", files: { "pyodide.asm.wasm": { bytes: 10 }, "numpy.whl": { bytes: 4 } } },
  { version: "1.0.0", files: { "pyodide.asm.wasm": { bytes: 8 } } },
];
const onDisk = new Map([
  [path.join(dir, "2.0.0", "pyodide.asm.wasm"), 10],
  [path.join(dir, "2.0.0", "numpy.whl"), 3],
  [path.join(dir, "1.0.0", "pyodide.asm.wasm"), 8],
  [path.join(dir, "0.9.0", "pyodide.asm.wasm"), 8],
  [path.join(dir, "2.0.0", "notes.txt"), 1],
]);

function request(url: string, method = "HEAD") {
  const headers = new Map<string, string>();
  const res = {
    statusCode: 0,
    setHeader: vi.fn((name: string, value: string) => headers.set(name, value)),
    end: vi.fn(),
  };
  const next = vi.fn();
  pythonRuntimeMiddleware(
    dir,
    "/python",
    pins,
    (file) => onDisk.get(file) ?? null,
  )({ url, method } as IncomingMessage, res as unknown as ServerResponse, next);
  return { status: res.statusCode, headers, next };
}

describe("python runtime middleware", () => {
  it("serves every retained pin's files for a year without revalidation", () => {
    for (const url of ["/python/2.0.0/pyodide.asm.wasm", "/python/1.0.0/pyodide.asm.wasm?x=1"]) {
      const { status, headers, next } = request(url);
      expect(next).not.toHaveBeenCalled();
      expect(status).toBe(200);
      expect(headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(headers.get("content-type")).toBe("application/wasm");
    }
  });

  it("answers 404, never the app shell, for anything that is not a pinned file of a kept version", () => {
    for (const url of [
      "/python/0.9.0/pyodide.asm.wasm",
      "/python/2.0.0/notes.txt",
      "/python/2.0.0/numpy.whl",
      "/python/2.0.0/missing.whl",
      "/python/2.0.0/../1.0.0/pyodide.asm.wasm",
      "/python/2.0.0/",
      "/python/",
    ]) {
      const { status, headers, next } = request(url);
      expect(next, url).not.toHaveBeenCalled();
      expect(status, url).toBe(404);
      expect(headers.get("cache-control")).toBe("no-store");
    }
    expect(request("/python/2.0.0/pyodide.asm.wasm", "POST").status).toBe(404);
  });

  it("leaves every other path to the rest of the server", () => {
    expect(request("/pythonic").next).toHaveBeenCalled();
    expect(request("/assets/index.js").next).toHaveBeenCalled();
  });

  it("is mounted at the path the app frame asks, for every pin the deploy installs", () => {
    expect(PYTHON_RUNTIME_PATH).toBe("/python");
    expect(PYTHON_RUNTIMES.length).toBeGreaterThan(0);
    expect(new Set(PYTHON_RUNTIMES.map((pin) => pin.version)).size).toBe(PYTHON_RUNTIMES.length);
  });
});
