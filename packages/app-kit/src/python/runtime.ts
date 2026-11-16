/**
 * The Python runtimes apps run on. Every file is pinned by size and SHA-256 and checked again
 * inside the app before it runs, so a calculation's answer depends only on its code and inputs.
 * To move apps to a new runtime, pin it with `tsx cli.ts pin <version>`, put it first in
 * PYTHON_RUNTIMES and keep the old pin after it: an app carries the pin it was built with and keeps
 * asking for that version's folder until it is saved again, so a deploy installs every pin listed.
 */

/** Where the web server serves the runtime: <path>/<version>/<file>. */
export const PYTHON_RUNTIME_PATH = "/python";

export { PYTHON_FIXTURE_URL } from "../protocol.js";

export const PYTHON_PACKAGES = ["numpy", "scipy", "pandas", "sympy"] as const;
export type PythonPackage = (typeof PYTHON_PACKAGES)[number];

export type PythonRuntimePin = {
  version: string;
  python: string;
  loader: string;
  module: string;
  lock: string;
  files: Record<string, { sha256: string; bytes: number }>;
  /** Each package's wheels with its dependencies, dependencies first. */
  packages: Record<PythonPackage, string[]>;
};

const RUNTIME_314_0_8: PythonRuntimePin = {
  version: "314.0.8",
  python: "3.14.2",
  loader: "pyodide.mjs",
  module: "pyodide.asm.mjs",
  lock: "pyodide-lock.json",
  files: {
    "pyodide.mjs": {
      sha256: "1bb8cc14f9405aaa7cd4e00c12edd0a8539de9cc026618d6ee5a9663f367dc70",
      bytes: 17758,
    },
    "pyodide.asm.mjs": {
      sha256: "22514b8be6980e28a02c8b1d6387ce8dfe666fc4edf8d547cff5dce29ff4d972",
      bytes: 1250259,
    },
    "pyodide.asm.wasm": {
      sha256: "e14d49ceca9b4a0e274ea918f3a898de2d3880b6e5573a6cfe1a2267ecc70329",
      bytes: 9597892,
    },
    "python_stdlib.zip": {
      sha256: "2bd3394a145bfbbe5bbc9d9d6ab9136abbb986c6fef6c142b3a2962227aa5c28",
      bytes: 2545550,
    },
    "pyodide-lock.json": {
      sha256: "5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010",
      bytes: 119077,
    },
    "numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl": {
      sha256: "a292c1f5d7d8a2208cd5e94fc467604c131cabcd2fc14fed6eefde121e7fabdf",
      bytes: 2960568,
    },
    "scipy-1.18.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl": {
      sha256: "17ee329a957863516d1bb6a6aaa0c60576fac027e9cd3d43de27f58b5b599b50",
      bytes: 14029750,
    },
    "six-1.17.0-py2.py3-none-any.whl": {
      sha256: "228c50f73aa7addf2c2ccf2979c256802a59ab69cad8152b31b9443cc8140f42",
      bytes: 11050,
    },
    "python_dateutil-2.9.0.post0-py2.py3-none-any.whl": {
      sha256: "9b13365edf9c188f570baf9c540bbb3029ada2a2dacb9694b3659941693ee9e5",
      bytes: 229892,
    },
    "pytz-2026.1.post1-py2.py3-none-any.whl": {
      sha256: "b8249d6450146e0b61e6d710dc02ebb35a904796c4c2f97fe87d4ac5872db36a",
      bytes: 510489,
    },
    "pandas-3.0.2-cp314-cp314-pyemscripten_2026_0_wasm32.whl": {
      sha256: "45ff57772cc2f366a8582c7d3097cc4e6676342ecd5a3c08184a43462d5a02ae",
      bytes: 4177749,
    },
    "mpmath-1.4.1-py3-none-any.whl": {
      sha256: "e5ebd537e74b9066341a5152e83b63ff2fc37a6388fa7351e766b6e4640f7eee",
      bytes: 430985,
    },
    "sympy-1.14.0-py3-none-any.whl": {
      sha256: "61ea8bb98049ba1c702ba3ad2607acb7ab94b9af0b6f97498741f50d3249f428",
      bytes: 4185567,
    },
  },
  packages: {
    numpy: ["numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl"],
    scipy: [
      "numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
      "scipy-1.18.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
    ],
    pandas: [
      "numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
      "six-1.17.0-py2.py3-none-any.whl",
      "python_dateutil-2.9.0.post0-py2.py3-none-any.whl",
      "pytz-2026.1.post1-py2.py3-none-any.whl",
      "pandas-3.0.2-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
    ],
    sympy: ["mpmath-1.4.1-py3-none-any.whl", "sympy-1.14.0-py3-none-any.whl"],
  },
};

/** The pin new builds use first, then every older pin a saved app may still ask for. */
export const PYTHON_RUNTIMES: readonly PythonRuntimePin[] = [RUNTIME_314_0_8];

export const PYTHON_RUNTIME: PythonRuntimePin = PYTHON_RUNTIMES[0]!;

export function pythonRuntimePin(version: string): PythonRuntimePin | undefined {
  return PYTHON_RUNTIMES.find((pin) => pin.version === version);
}

/** The interpreter's own files, loaded before any package. */
export const PYTHON_CORE_FILES = [
  PYTHON_RUNTIME.loader,
  PYTHON_RUNTIME.module,
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  PYTHON_RUNTIME.lock,
];

/** Every file a deploy serves for one pin. */
export function pythonFiles(pin: PythonRuntimePin = PYTHON_RUNTIME): string[] {
  return Object.keys(pin.files);
}

/** The files a calculation importing `packages` loads: the interpreter, then each wheel once. */
export function pythonFilesFor(packages: readonly string[]): string[] {
  const wheels = packages.flatMap((name) => PYTHON_RUNTIME.packages[name as PythonPackage] ?? []);
  return [...new Set([...PYTHON_CORE_FILES, ...wheels])];
}

/** A runtime version and file name as an app asks its host for them; anything else is refused. */
export function isPythonFileRequest(version: unknown, name: unknown): boolean {
  return (
    typeof version === "string" &&
    typeof name === "string" &&
    /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version) &&
    /^[A-Za-z0-9_][A-Za-z0-9_.+-]{0,199}$/.test(name)
  );
}
