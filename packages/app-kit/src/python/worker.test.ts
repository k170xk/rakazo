import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FromPythonWorker, ToPythonWorker } from "./worker.js";
import { pythonWorker } from "./worker.js";

/**
 * The page and the worker together, with a stand-in interpreter: the loader module records how it
 * was started and answers runs from `python.answer`, so no real runtime is downloaded.
 */
const python = await vi.hoisted(async () => {
  const { createHash } = await import("node:crypto");
  const loader = `export async function loadPyodide(options) {
  const python = globalThis.__python;
  python.options = options;
  await (await self.fetch(options.indexURL + "pyodide.asm.wasm")).arrayBuffer();
  return {
    runPython(code) { python.runner = code; },
    async loadPackage(names) {
      for (const name of names) {
        python.loadedPackages.push(name);
        for (const file of python.wheels[name] ?? []) await self.fetch(options.packageBaseUrl + file);
      }
    },
    globals: { get: () => (request, version) => python.answer(request, version) },
  };
}`;
  const text = (value: string) => new TextEncoder().encode(value);
  const files: Record<string, Uint8Array> = {
    "loader.mjs": text(loader),
    "module.mjs": text("export default function createPyodideModule() {}"),
    "lock.json": text('{"info":{"python":"3.14.2"},"packages":{}}'),
    "pyodide.asm.wasm": new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
    "numpy.whl": text("numpy wheel"),
  };
  const edges = [0, 55, 56, 63, 64, 65, 119, 120, 1_000_003];
  for (const size of edges) {
    files[`edge-${size}.whl`] = Uint8Array.from({ length: size }, (_, i) => (i * 131 + size) % 251);
  }
  const pins = Object.fromEntries(
    Object.entries(files).map(([name, bytes]) => [
      name,
      { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length },
    ]),
  );
  const state = {
    files,
    pins,
    available: true,
    tampered: null as string | null,
    asked: [] as string[],
    options: null as Record<string, unknown> | null,
    runner: "",
    loadedPackages: [] as string[],
    wheels: { numpy: ["numpy.whl", ...edges.map((size) => `edge-${size}.whl`)] } as Record<
      string,
      string[]
    >,
    answers: 0,
    memory: false,
    answer(request: string, version: string) {
      state.answers += 1;
      const { code, inputs } = JSON.parse(request) as {
        code: string;
        inputs: Record<string, number>;
      };
      const base = {
        stdout: "",
        stderr: "",
        versions: { python: "3.14.2", runtime: version, packages: {} },
        key: "k",
      };
      if (code.includes("huge") && !state.memory) {
        state.memory = true;
        throw new RangeError("Array buffer allocation failed");
      }
      if (code.includes("raise"))
        return JSON.stringify({
          ...base,
          error: "calc.py line 2: ValueError: span must be positive",
        });
      return JSON.stringify({
        ...base,
        outputs: { total: (inputs.a ?? 0) + (inputs.b ?? 0), limit: { $float: "inf" } },
        hash: "h",
      });
    },
  };
  return state;
});

vi.mock("./runtime.js", () => ({
  PYTHON_PACKAGES: ["numpy", "scipy", "pandas", "sympy"],
  PYTHON_RUNTIME: {
    version: "1.2.3",
    loader: "loader.mjs",
    module: "module.mjs",
    lock: "lock.json",
    files: python.pins,
    packages: { numpy: ["numpy.whl"], scipy: [], pandas: [], sympy: [] },
  },
  PYTHON_CORE_FILES: ["loader.mjs", "module.mjs", "pyodide.asm.wasm", "lock.json"],
}));

vi.mock("../sdk/index.js", () => ({
  useApp: () => ({ ready: true }),
  pythonRuntime: {
    available: () => python.available,
    async file(version: string, name: string) {
      python.asked.push(`${version}/${name}`);
      const bytes = python.files[name];
      if (!bytes) throw new Error("missing");
      return name === python.tampered ? new Uint8Array([...bytes, 0]) : bytes;
    },
  },
}));

const { PythonError, runPython } = await import("./index.js");
const { PYTHON_RUNNER } = await import("./runner.js");

/** Runs the worker's program in this process, wired to the page like a real Worker. */
class FakeWorker {
  static last: FakeWorker | null = null;
  static terminated = 0;
  onmessage: ((event: { data: FromPythonWorker }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  readonly scope = {
    postMessage: (data: FromPythonWorker) => queueMicrotask(() => this.onmessage?.({ data })),
    onmessage: null as ((event: { data: ToPythonWorker }) => void) | null,
    fetch: null as unknown as typeof fetch,
  };
  constructor() {
    vi.stubGlobal("self", this.scope);
    pythonWorker();
    FakeWorker.last = this;
  }
  postMessage(data: ToPythonWorker) {
    queueMicrotask(() => this.scope.onmessage?.({ data }));
  }
  terminate() {
    FakeWorker.terminated += 1;
  }
}

/** Blob URLs become data: URLs so Node can import the modules the worker makes from bytes. */
class FakeBlob {
  constructor(readonly parts: Array<string | Uint8Array>) {}
}

beforeEach(() => {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("Blob", FakeBlob);
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    const part = (blob as unknown as FakeBlob).parts[0]!;
    const bytes = typeof part === "string" ? new TextEncoder().encode(part) : part;
    return `data:text/javascript;base64,${Buffer.from(bytes).toString("base64")}`;
  });
  (globalThis as Record<string, unknown>).__python = python;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const SUM = "import numpy\ndef calc(inputs):\n    return {'total': inputs['a'] + inputs['b']}";

describe("runPython", () => {
  it("refuses a runtime file that does not match its pin, then recovers once it does", async () => {
    python.tampered = "module.mjs";
    await expect(runPython(SUM, { a: 1, b: 2 })).rejects.toThrow(
      "module.mjs does not match the pinned Python runtime.",
    );
    expect(python.answers).toBe(0);
    python.tampered = null;
    const result = await runPython(SUM, { a: 1, b: 2 });
    expect(result.outputs).toEqual({ total: 3, limit: Number.POSITIVE_INFINITY });
  });

  it("starts the interpreter offline, seeded and with the pinned files only", async () => {
    expect(python.options).toMatchObject({
      indexURL: "https://runtime.invalid/",
      packageBaseUrl: "https://runtime.invalid/",
      lockFileContents: { info: { python: "3.14.2" }, packages: {} },
      env: { PYTHONHASHSEED: "0" },
    });
    expect(typeof python.options?.createPyodideModule).toBe("function");
    expect(python.runner).toBe(PYTHON_RUNNER);
    expect(python.loadedPackages).toEqual(["numpy"]);
    expect(python.asked).toEqual(
      expect.arrayContaining([
        "1.2.3/loader.mjs",
        "1.2.3/module.mjs",
        "1.2.3/lock.json",
        "1.2.3/pyodide.asm.wasm",
        "1.2.3/numpy.whl",
      ]),
    );
    const scope = FakeWorker.last!.scope;
    await expect(scope.fetch("https://example.com/data.csv")).rejects.toThrow("no network");
    await expect(scope.fetch("https://runtime.invalid/other.whl")).rejects.toThrow(
      "not part of the Python runtime",
    );
  });

  it("answers the same code and inputs from the cache, whatever order the inputs came in", async () => {
    const before = python.answers;
    const first = await runPython(SUM, { a: 1.5, b: 2 });
    const again = await runPython(SUM, { b: 2, a: 1.5 });
    expect(again).toEqual(first);
    expect(python.answers).toBe(before + 1);
    await runPython(SUM, { a: 1.5, b: 2.5 });
    expect(python.answers).toBe(before + 2);
  });

  it("reports a raised calculation by line, and raises it again without rerunning", async () => {
    const code = "def calc(inputs):\n    raise ValueError('span must be positive')";
    await expect(runPython(code, { span: -1 })).rejects.toThrow(PythonError);
    const before = python.answers;
    await expect(runPython(code, { span: -1 })).rejects.toThrow(
      "calc.py line 2: ValueError: span must be positive",
    );
    expect(python.answers).toBe(before);
  });

  it("refuses code that reads the clock before it reaches the interpreter", async () => {
    const before = python.answers;
    await expect(
      runPython("import time\ndef calc(inputs):\n    return {'t': time.time()}"),
    ).rejects.toThrow("reads the clock");
    expect(python.answers).toBe(before);
  });

  it("says plainly when the device runs out of memory, and starts afresh for the next try", async () => {
    const code = "import numpy\ndef calc(inputs):\n    return {'huge': inputs['n']}";
    const terminated = FakeWorker.terminated;
    const before = FakeWorker.last;
    await expect(runPython(code, { n: 1e9 })).rejects.toThrow(/ran out of memory/);
    expect(FakeWorker.terminated).toBe(terminated + 1);
    const result = await runPython(code, { n: 1e9 });
    expect(FakeWorker.last).not.toBe(before);
    expect(result.outputs).toEqual({ total: 0, limit: Number.POSITIVE_INFINITY });
  });

  it("says so when the host has no Python", async () => {
    python.available = false;
    await expect(runPython(SUM, { a: 9, b: 9 })).rejects.toThrow("aren't available here");
    python.available = true;
  });
});
