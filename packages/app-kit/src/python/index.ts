import { useEffect, useState, useSyncExternalStore } from "react";
import { pythonRuntime, useApp } from "../sdk/index.js";
import type { PythonResult } from "./envelope.js";
import {
  isOutOfMemory,
  PYTHON_OUT_OF_MEMORY,
  PythonError,
  pythonPackages,
  pythonProblem,
  pythonRequest,
  readPythonResult,
} from "./envelope.js";
import { PYTHON_RUNNER } from "./runner.js";
import { PYTHON_CORE_FILES, PYTHON_RUNTIME } from "./runtime.js";
import type { FromPythonWorker, ToPythonWorker } from "./worker.js";
import { pythonWorker } from "./worker.js";

export type { PythonResult, PythonVersions } from "./envelope.js";
export type { PythonPackage } from "./runtime.js";
export { PythonError, pythonPackages, pythonProblem };

/**
 * @ocsc/python: deterministic Python calculations inside the app. The pinned interpreter runs in a
 * worker of the app's own frame, so the page stays responsive and the calculation has no network,
 * clock or outside state; the same code and inputs always give the same outputs and hash.
 */

const MAX_CACHED = 64;
const DEFAULT_TIMEOUT_MS = 300_000;
const UNAVAILABLE = "Python calculations aren't available here.";
const WORKER_SOURCE = `(${pythonWorker.toString()})();`;

let worker: Worker | null = null;
let nextRun = 0;
const runs = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>();
/** Envelopes by request text; a raised calculation is cached too, since it raises every time. */
const cache = new Map<string, Promise<string>>();
const loaded = new Set<string>();
let loadedVersion = 0;
const listeners = new Set<() => void>();

function notify() {
  loadedVersion += 1;
  for (const listener of listeners) listener();
}

/** Marks the page while calculations run, so a screenshot can wait for their answers. */
function markBusy() {
  if (typeof document !== "undefined")
    document.documentElement.toggleAttribute("data-python-busy", runs.size > 0);
}

function stop(error: Error) {
  worker?.terminate();
  worker = null;
  loaded.clear();
  notify();
  for (const run of runs.values()) run.reject(error);
  runs.clear();
  markBusy();
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(
    URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" })),
  );
  const tell = (message: ToPythonWorker) => created.postMessage(message);
  created.onmessage = ({ data }: MessageEvent<FromPythonWorker>) => {
    if (data.type === "file") {
      pythonRuntime.file(PYTHON_RUNTIME.version, data.name).then(
        (bytes) => tell({ type: "file", id: data.id, bytes }),
        (error: unknown) =>
          tell({
            type: "file",
            id: data.id,
            error: error instanceof Error ? error.message : UNAVAILABLE,
          }),
      );
    } else if (data.type === "progress") {
      loaded.add(data.name);
      notify();
    } else if (data.type === "error" && isOutOfMemory(data.message)) {
      // A failed allocation can leave the interpreter half-built; the next run starts afresh.
      stop(new PythonError(PYTHON_OUT_OF_MEMORY));
    } else {
      const run = runs.get(data.id);
      runs.delete(data.id);
      markBusy();
      if (data.type === "done") run?.resolve(data.text);
      else run?.reject(new PythonError(data.message));
    }
  };
  created.onerror = (event) => {
    event.preventDefault?.();
    const message = event.message ?? "";
    stop(
      new PythonError(
        isOutOfMemory(message)
          ? PYTHON_OUT_OF_MEMORY
          : message || "Python stopped unexpectedly. Close other tabs and try again.",
      ),
    );
  };
  tell({
    type: "init",
    config: {
      version: PYTHON_RUNTIME.version,
      loader: PYTHON_RUNTIME.loader,
      module: PYTHON_RUNTIME.module,
      lock: PYTHON_RUNTIME.lock,
      files: PYTHON_RUNTIME.files,
      runner: PYTHON_RUNNER,
    },
  });
  worker = created;
  return created;
}

function execute(request: string, packages: string[], timeoutMs: number): Promise<string> {
  const target = ensureWorker();
  nextRun += 1;
  const id = nextRun;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        stop(
          new PythonError(
            `The calculation ran for over ${Math.round(timeoutMs / 1000)} s and was stopped.`,
          ),
        ),
      timeoutMs,
    );
    runs.set(id, {
      resolve: (text) => {
        clearTimeout(timer);
        resolve(text);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    markBusy();
    target.postMessage({ type: "run", id, request, packages } satisfies ToPythonWorker);
  });
}

/**
 * Runs Python source that defines calc(inputs) and returns its outputs with stdout, versions and
 * hashes. Results are cached by code and inputs, so asking again answers at once. Rejects with a
 * PythonError naming the calc.py line when the calculation raises or reads anything but its inputs.
 */
export function runPython<T = Record<string, unknown>>(
  code: string,
  inputs: Record<string, unknown> = {},
  options: { timeoutMs?: number } = {},
): Promise<PythonResult<T>> {
  try {
    const problem = pythonProblem(code);
    if (problem) throw new PythonError(problem);
    if (!pythonRuntime.available()) throw new PythonError(UNAVAILABLE);
    const request = pythonRequest(code, inputs);
    let text = cache.get(request);
    if (text) {
      cache.delete(request);
    } else {
      text = execute(request, pythonPackages(code), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      text.catch(() => cache.delete(request));
    }
    cache.set(request, text);
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
    return text.then((value) => readPythonResult<T>(value));
  } catch (error) {
    return Promise.reject(error);
  }
}

export type PythonState<T> = {
  /** unavailable: this host can't run Python (offline previews, Evolve plugins). */
  status: "unavailable" | "running" | "ready" | "error";
  /** The latest answer, kept while a newer one is worked out. */
  result: PythonResult<T> | null;
  error: PythonError | null;
  /** 0-1 while the runtime and packages download the first time; null once they are here. */
  loading: number | null;
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** How much of the runtime one calculation needs has arrived, or null when all of it has. */
function loadingShare(code: string): number | null {
  const needed = new Set([
    ...PYTHON_CORE_FILES,
    ...pythonPackages(code).flatMap((name) => PYTHON_RUNTIME.packages[name]),
  ]);
  let total = 0;
  let have = 0;
  for (const name of needed) {
    const bytes = PYTHON_RUNTIME.files[name]?.bytes ?? 0;
    total += bytes;
    if (loaded.has(name)) have += bytes;
  }
  return have >= total ? null : have / total;
}

/**
 * Runs a calculation whenever its code or inputs change: `usePython(beamPy, {span, load})` with
 * `import beamPy from "./beam.py"`. Inputs are compared by value, so a new object with the same
 * numbers does not run again.
 */
export function usePython<T = Record<string, unknown>>(
  code: string,
  inputs: Record<string, unknown> = {},
): PythonState<T> {
  const app = useApp();
  const available = app.ready && pythonRuntime.available();
  let request: string | null = null;
  let invalid: PythonError | null = null;
  try {
    request = pythonRequest(code, inputs);
  } catch (error) {
    invalid = new PythonError(error instanceof Error ? error.message : String(error));
  }
  const [state, setState] = useState<Omit<PythonState<T>, "loading">>({
    status: "running",
    result: null,
    error: null,
  });
  useSyncExternalStore(
    subscribe,
    () => loadedVersion,
    () => 0,
  );

  useEffect(() => {
    if (!available || request === null) return;
    const { code: source, inputs: values } = JSON.parse(request) as {
      code: string;
      inputs: Record<string, unknown>;
    };
    let current = true;
    setState((previous) => ({ ...previous, status: "running" }));
    runPython<T>(source, values).then(
      (result) => {
        if (current) setState({ status: "ready", result, error: null });
      },
      (error: unknown) => {
        if (!current) return;
        const failure = error instanceof PythonError ? error : new PythonError(String(error));
        setState((previous) => ({ status: "error", result: previous.result, error: failure }));
      },
    );
    return () => {
      current = false;
    };
  }, [available, request]);

  if (invalid) return { status: "error", result: state.result, error: invalid, loading: null };
  if (app.ready && !available)
    return { status: "unavailable", result: null, error: null, loading: null };
  return { ...state, loading: state.status === "running" ? loadingShare(code) : null };
}
