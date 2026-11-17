/**
 * The IFC engine apps open models with. The files stay on the host, like the Python runtime, and an
 * app only asks for them when someone opens a model. Each file is pinned so a save keeps using the
 * engine it was built against.
 */

/** Where the web server serves the engine: <path>/<version>/<file>. */
export const IFC_RUNTIME_PATH = "/ifc";

export type IfcRuntimePin = {
  version: string;
  api: string;
  wasm: string;
  files: Record<string, { sha256: string; bytes: number }>;
};

const RUNTIME_0_0_71: IfcRuntimePin = {
  version: "0.0.71",
  api: "web-ifc-api.js",
  wasm: "web-ifc.wasm",
  files: {
    "web-ifc-api.js": {
      sha256: "1f07c3cfcad8309ac92556aa8e6811f7f6c331e9cbd1dfe5037dad5a36c0fe03",
      bytes: 5910077,
    },
    "web-ifc.wasm": {
      sha256: "f466be51ae179fdcbe55e36116bd1dc233f73e64b5a446af761f711c2ded4c3d",
      bytes: 1283491,
    },
  },
};

export const IFC_RUNTIMES: readonly IfcRuntimePin[] = [RUNTIME_0_0_71];

export const IFC_RUNTIME: IfcRuntimePin = IFC_RUNTIMES[0]!;

export function ifcRuntimePin(version: string): IfcRuntimePin | undefined {
  return IFC_RUNTIMES.find((pin) => pin.version === version);
}

/** A runtime version and file name as an app asks its host for them; anything else is refused. */
export function isIfcFileRequest(version: unknown, name: unknown): boolean {
  return (
    typeof version === "string" &&
    typeof name === "string" &&
    /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version) &&
    /^[A-Za-z0-9_][A-Za-z0-9_.+-]{0,199}$/.test(name)
  );
}

/** The largest model an app holds. Past this it stays a file the person opens, not a stored asset. */
export const MAX_IFC_BYTES = 20 * 1024 * 1024;

/** How many engine files one open app may ask the server for in a minute. Two files open a model. */
export const ENGINE_REQUESTS_PER_MINUTE = 8;

/** True until the minute's allowance is used. A repeat of a file already in flight does not count. */
export function allowEngineRequest(state: { windowStart: number; count: number }, now: number): boolean {
  if (now - state.windowStart >= 60_000) {
    state.windowStart = now;
    state.count = 0;
  }
  if (state.count >= ENGINE_REQUESTS_PER_MINUTE) return false;
  state.count += 1;
  return true;
}
