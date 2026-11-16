import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp, checkFiles } from "../build/index.js";
import { APP_KIT_GUIDE } from "../guide.js";
import { install } from "./cli.js";
import {
  isOutOfMemory,
  PYTHON_OUT_OF_MEMORY,
  PythonError,
  pythonPackages,
  pythonProblem,
  pythonRequest,
  readPythonResult,
  toPythonJson,
} from "./envelope.js";
import { PYTHON_RUNNER } from "./runner.js";
import {
  isPythonFileRequest,
  PYTHON_CORE_FILES,
  PYTHON_PACKAGES,
  PYTHON_RUNTIME,
  PYTHON_RUNTIMES,
  pythonFilesFor,
  pythonRuntimePin,
} from "./runtime.js";

describe("pythonPackages", () => {
  it("finds the hosted packages a calculation imports, in pinned order", () => {
    const code = [
      "import math, numpy as np",
      "from scipy import optimize",
      "def calc(inputs):",
      "    import sympy",
      "    return {}",
      "import numpyro",
    ].join("\n");
    expect(pythonPackages(code)).toEqual(["numpy", "scipy", "sympy"]);
    expect(pythonPackages("def calc(inputs):\n    return {'pandas': 1}")).toEqual([]);
  });
});

describe("pythonProblem", () => {
  it("refuses anything that would change the answer between runs", () => {
    const refused = {
      "import time\nt = time.time()": "reads the clock",
      "from datetime import datetime\nnow = datetime.now()": "reads the clock",
      "import os\nsalt = os.urandom(8)": "unseeded randomness",
      "import secrets": "unseeded randomness",
      "rng = np.random.default_rng()": "without a seed",
      "import js": "reaches outside",
      "from pyodide.http import pyfetch": "reaches outside",
      "import urllib.request": "reaches outside",
      "    import threading": "reaches outside",
    };
    for (const [code, reason] of Object.entries(refused)) {
      expect(pythonProblem(code, "calc.py")).toContain(reason);
    }
    expect(pythonProblem("x = 1\n\ny = time.time()", "beam.py")).toMatch(
      /^beam\.py line 3 reads the clock/,
    );
  });

  it("allows seeded generators, the json module and comments about the clock", () => {
    const code = [
      "import json",
      "import numpy as np",
      "# never call time.time() here",
      "rng = np.random.default_rng(42)",
      "def calc(inputs):",
      "    return {'x': rng.normal()}",
    ].join("\n");
    expect(pythonProblem(code)).toBeNull();
  });
});

describe("toPythonJson and pythonRequest", () => {
  it("keeps every number exact and sends non-finite ones in a form Python reads back", () => {
    expect(
      toPythonJson({
        b: [0.1, Number.NaN, undefined],
        a: Number.POSITIVE_INFINITY,
        c: new Float64Array([1.5, -0]),
        d: new Date(Date.UTC(2026, 0, 2)),
        skip: undefined,
      }),
    ).toEqual({
      a: { $float: "inf" },
      b: [0.1, { $float: "nan" }, null],
      c: [1.5, -0],
      d: "2026-01-02T00:00:00.000Z",
    });
    expect(() => toPythonJson({ f: () => 1 })).toThrow(/inputs\.f can't be passed/);
    expect(() => toPythonJson({ m: new Map() })).toThrow(/inputs\.m/);
  });

  it("names the same request the same way whatever order the inputs were built in", () => {
    const code = "import numpy\ndef calc(inputs):\n    return inputs";
    const one = pythonRequest(code, { span: 6, load: { dead: 1.35, live: 1.5 } });
    const two = pythonRequest(code, { load: { live: 1.5, dead: 1.35 }, span: 6 });
    expect(one).toBe(two);
    expect(JSON.parse(one)).toEqual({
      code,
      inputs: { load: { dead: 1.35, live: 1.5 }, span: 6 },
      packages: ["numpy"],
    });
    expect(pythonRequest(code, { span: 6.000000000000001 })).not.toBe(
      pythonRequest(code, { span: 6 }),
    );
  });
});

describe("readPythonResult", () => {
  it("revives non-finite numbers and keeps the runner's output order", () => {
    const result = readPythonResult(
      JSON.stringify({
        stdout: "ok\n",
        stderr: "",
        versions: { python: "3.14.2", runtime: "314.0.8", packages: {} },
        key: "k",
        outputs: { z: 1, a: { $float: "-inf" }, n: [{ $float: "nan" }, 0.30000000000000004] },
        hash: "h",
      }),
    );
    expect(Object.keys(result.outputs)).toEqual(["z", "a", "n"]);
    expect(result.outputs).toEqual({
      z: 1,
      a: Number.NEGATIVE_INFINITY,
      n: [Number.NaN, 0.30000000000000004],
    });
  });

  it("turns a raised calculation into a PythonError with its output", () => {
    const text = JSON.stringify({
      stdout: "before\n",
      stderr: "",
      versions: {},
      key: "k",
      error: "calc.py line 3: ZeroDivisionError: division by zero",
    });
    expect(() => readPythonResult(text)).toThrow(PythonError);
    try {
      readPythonResult(text);
    } catch (error) {
      expect((error as PythonError).message).toBe(
        "calc.py line 3: ZeroDivisionError: division by zero",
      );
      expect((error as PythonError).stdout).toBe("before\n");
    }
  });
});

describe("isOutOfMemory", () => {
  it("recognises the engine running short of memory, not a calculation's own MemoryError", () => {
    for (const message of [
      "RangeError: Array buffer allocation failed",
      "Aborted(OOM)",
      "Cannot enlarge memory arrays to size 2147483648 bytes (OOM).",
      "RangeError: WebAssembly.Memory(): could not allocate memory",
      "RuntimeError: memory access out of bounds",
      "Out of memory",
    ]) {
      expect(isOutOfMemory(message), message).toBe(true);
    }
    expect(isOutOfMemory("calc.py line 4: MemoryError: out of memory")).toBe(false);
    expect(isOutOfMemory("calc.py line 2: ValueError: span must be positive")).toBe(false);
    expect(PYTHON_OUT_OF_MEMORY).toMatch(/ran out of memory/);
  });
});

describe("retained runtime pins", () => {
  it("puts the pin new builds use first and keeps every version once", () => {
    expect(PYTHON_RUNTIMES[0]).toBe(PYTHON_RUNTIME);
    expect(new Set(PYTHON_RUNTIMES.map((pin) => pin.version)).size).toBe(PYTHON_RUNTIMES.length);
    for (const pin of PYTHON_RUNTIMES) {
      expect(pythonRuntimePin(pin.version)).toBe(pin);
      expect(isPythonFileRequest(pin.version, pin.loader)).toBe(true);
      for (const name of [
        pin.loader,
        pin.module,
        pin.lock,
        ...Object.values(pin.packages).flat(),
      ]) {
        expect(pin.files[name], `${pin.version}/${name}`).toBeDefined();
      }
    }
    expect(pythonRuntimePin("0.0.1")).toBeUndefined();
  });

  it("loads only the packages a calculation imports", () => {
    expect(pythonFilesFor([])).toEqual(PYTHON_CORE_FILES);
    const scipy = pythonFilesFor(["scipy"]);
    expect(scipy).toEqual([...PYTHON_CORE_FILES, ...PYTHON_RUNTIME.packages.scipy]);
    expect(scipy.some((name) => name.startsWith("pandas") || name.startsWith("sympy"))).toBe(false);
    const both = pythonFilesFor(["scipy", "pandas"]);
    expect(both.filter((name) => name.startsWith("numpy"))).toHaveLength(1);
  });

  it("installs a pin's files, keeps ones already right and refuses any that differ", async () => {
    const from = await mkdtemp(path.join(tmpdir(), "python-from-"));
    const out = await mkdtemp(path.join(tmpdir(), "python-out-"));
    const bytes = { "pyodide.mjs": "loader", "extra.whl": "wheel" };
    const files = Object.fromEntries(
      Object.entries(bytes).map(([name, text]) => [
        name,
        { sha256: createHash("sha256").update(text).digest("hex"), bytes: text.length },
      ]),
    );
    const pin = { ...PYTHON_RUNTIME, version: "9.9.9", files };
    try {
      for (const [name, text] of Object.entries(bytes))
        await writeFile(path.join(from, name), text);
      await install(pin, from, out);
      expect(await readFile(path.join(out, "9.9.9", "extra.whl"), "utf8")).toBe("wheel");
      await writeFile(path.join(from, "extra.whl"), "tampered");
      await install(pin, from, out);
      await rm(path.join(out, "9.9.9", "extra.whl"));
      await expect(install(pin, from, out)).rejects.toThrow(
        "extra.whl does not match the pinned hash",
      );
      expect(await readdir(path.join(out, "9.9.9"))).toEqual(["pyodide.mjs"]);
    } finally {
      await rm(from, { recursive: true, force: true });
      await rm(out, { recursive: true, force: true });
    }
  });
});

describe("the pinned runtime", () => {
  it("pins every file it serves by size and hash, and every package's wheels", () => {
    for (const name of PYTHON_CORE_FILES) expect(PYTHON_RUNTIME.files[name]).toBeDefined();
    for (const name of PYTHON_PACKAGES) {
      expect(PYTHON_RUNTIME.packages[name].length).toBeGreaterThan(0);
      for (const file of PYTHON_RUNTIME.packages[name])
        expect(PYTHON_RUNTIME.files[file]).toBeDefined();
    }
    for (const pin of Object.values(PYTHON_RUNTIME.files)) {
      expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(pin.bytes).toBeGreaterThan(0);
    }
    for (const name of Object.keys(PYTHON_RUNTIME.files)) {
      expect(isPythonFileRequest(PYTHON_RUNTIME.version, name)).toBe(true);
    }
  });

  it("lets a host serve only a version folder's own files", () => {
    for (const [version, name] of [
      ["314.0.8", "../secrets.json"],
      ["314.0.8", "a/b.whl"],
      ["314.0.8", ".env"],
      ["../314", "pyodide.mjs"],
      ["latest", "pyodide.mjs"],
      [314, "pyodide.mjs"],
    ]) {
      expect(isPythonFileRequest(version, name)).toBe(false);
    }
  });

  it("starts every run from the same state", () => {
    expect(PYTHON_RUNNER).toContain("random.seed(0)");
    expect(PYTHON_RUNNER).toContain("numpy.random.seed(0)");
    expect(PYTHON_RUNNER).toContain('warnings.simplefilter("always")');
    expect(PYTHON_RUNNER).toContain("decimal.setcontext(decimal.Context())");
    expect(PYTHON_RUNNER).toContain("sort_keys=True");
  });
});

describe("apps with Python files", () => {
  const guide = /## @ocsc\/python[\s\S]*?```py\n([\s\S]*?)```\n```tsx\n([\s\S]*?)```/.exec(
    APP_KIT_GUIDE,
  );

  it("builds the guide's example, bundling the .py file as text and the runtime pins", async () => {
    expect(guide).toBeTruthy();
    const [, py, tsx] = guide!;
    const app = `import BeamCheck from "./BeamCheck";\nexport default function App() {\n  return <BeamCheck />;\n}\n`;
    const files = { "App.tsx": app, "BeamCheck.tsx": tsx!, "beam.py": py! };
    expect(checkFiles(files)).toBeNull();
    const built = await buildApp(files, { title: "Beam" });
    expect(built.ok ? [] : built.errors).toEqual([]);
    if (!built.ok) return;
    expect(built.js).toContain("K[i : i + 2, i : i + 2] += k");
    expect(built.js).toContain(PYTHON_RUNTIME.files["pyodide.asm.wasm"]!.sha256);
    expect(built.js).toContain("PYTHONHASHSEED");
    expect(built.weight.map((part) => part.part)).toContain("@ocsc/python");
  });

  it("refuses a .py file that would not give the same answer twice", () => {
    expect(
      checkFiles({
        "App.tsx": "export default () => null;",
        "calc/site.py": "import time\nstamp = time.time()",
      }),
    ).toBe(
      "calc/site.py line 2 reads the clock; a calculation must give the same answer for the same inputs.",
    );
    expect(checkFiles({ "App.tsx": "", "calc.pyc": "" })).toMatch(/\.md or \.py\./);
  });
});
