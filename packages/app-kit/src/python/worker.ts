/** What the page tells the worker once, before any run. */
export type PythonWorkerConfig = {
  version: string;
  loader: string;
  module: string;
  lock: string;
  files: Record<string, { sha256: string; bytes: number }>;
  runner: string;
};

export type ToPythonWorker =
  | { type: "init"; config: PythonWorkerConfig }
  | { type: "file"; id: number; bytes?: Uint8Array; error?: string }
  | { type: "run"; id: number; request: string; packages: string[] };

export type FromPythonWorker =
  | { type: "file"; id: number; name: string }
  /** A runtime file arrived and matched its pin. */
  | { type: "progress"; name: string }
  | { type: "done"; id: number; text: string }
  | { type: "error"; id: number; message: string };

type Pyodide = {
  runPython(code: string): unknown;
  loadPackage(names: string[], options: Record<string, unknown>): Promise<unknown>;
  globals: { get(name: string): (...args: unknown[]) => unknown };
};

/**
 * The worker's whole program, started from its source text inside the app's frame. The frame has
 * no network, so the interpreter's own fetches are answered here: each file comes from the page
 * (which asks the host) and must match its pinned size and SHA-256 before Python sees it. Runs
 * queue one after another, because the interpreter and its seeds are shared.
 */
export function pythonWorker() {
  const BASE = "https://runtime.invalid/";
  const scope = self as unknown as {
    postMessage(message: FromPythonWorker): void;
    onmessage: ((event: { data: ToPythonWorker }) => void) | null;
    fetch: typeof fetch;
  };
  let config: PythonWorkerConfig | null = null;
  let python: Promise<Pyodide> | null = null;
  let queue: Promise<void> = Promise.resolve();
  let asked = 0;
  const waiting = new Map<
    number,
    { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }
  >();

  // crypto.subtle needs a secure context, and a worker started from a sandboxed frame is not one.
  const ROUND = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  function sha256(bytes: Uint8Array): string {
    const state = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
      0x5be0cd19,
    ]);
    const w = new Uint32Array(64);
    const block = (data: Uint8Array, at: number) => {
      for (let i = 0; i < 16; i++) {
        const j = at + i * 4;
        w[i] = (data[j]! << 24) | (data[j + 1]! << 16) | (data[j + 2]! << 8) | data[j + 3]!;
      }
      for (let i = 16; i < 64; i++) {
        const x = w[i - 15]!;
        const y = w[i - 2]!;
        const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = Array.from(state);
      for (let i = 0; i < 64; i++) {
        const s1 =
          ((e! >>> 6) | (e! << 26)) ^ ((e! >>> 11) | (e! << 21)) ^ ((e! >>> 25) | (e! << 7));
        const t1 = (h! + s1 + ((e! & f!) ^ (~e! & g!)) + ROUND[i]! + w[i]!) | 0;
        const s0 =
          ((a! >>> 2) | (a! << 30)) ^ ((a! >>> 13) | (a! << 19)) ^ ((a! >>> 22) | (a! << 10));
        const t2 = (s0 + ((a! & b!) ^ (a! & c!) ^ (b! & c!))) | 0;
        h = g;
        g = f;
        f = e;
        e = (d! + t1) | 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) | 0;
      }
      state[0]! += a!;
      state[1]! += b!;
      state[2]! += c!;
      state[3]! += d!;
      state[4]! += e!;
      state[5]! += f!;
      state[6]! += g!;
      state[7]! += h!;
    };
    const whole = bytes.length - (bytes.length % 64);
    for (let at = 0; at < whole; at += 64) block(bytes, at);
    const tail = new Uint8Array(bytes.length - whole < 56 ? 64 : 128);
    tail.set(bytes.subarray(whole));
    tail[bytes.length - whole] = 0x80;
    const view = new DataView(tail.buffer);
    view.setUint32(tail.length - 8, Math.floor(bytes.length / 0x20000000));
    view.setUint32(tail.length - 4, (bytes.length * 8) >>> 0);
    for (let at = 0; at < tail.length; at += 64) block(tail, at);
    return Array.from(state, (word) => word.toString(16).padStart(8, "0")).join("");
  }

  async function checked(name: string): Promise<Uint8Array> {
    const pin = config?.files[name];
    if (!pin) throw new Error(`${name} is not part of the Python runtime.`);
    asked += 1;
    const id = asked;
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      scope.postMessage({ type: "file", id, name });
    });
    if (bytes.byteLength !== pin.bytes || sha256(bytes) !== pin.sha256) {
      throw new Error(`${name} does not match the pinned Python runtime.`);
    }
    scope.postMessage({ type: "progress", name });
    return bytes;
  }

  const importBytes = (bytes: Uint8Array) =>
    import(
      URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "text/javascript" }))
    );

  scope.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(BASE)) throw new TypeError("Python calculations have no network.");
    const name = url.slice(BASE.length);
    const bytes = await checked(name);
    const type = name.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
    return new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { "content-type": type } });
  };

  async function start(settings: PythonWorkerConfig): Promise<Pyodide> {
    const [loader, module, lock] = await Promise.all([
      checked(settings.loader),
      checked(settings.module),
      checked(settings.lock),
    ]);
    const { loadPyodide } = await importBytes(loader);
    const { default: createPyodideModule } = await importBytes(module);
    const runtime = (await loadPyodide({
      indexURL: BASE,
      packageBaseUrl: BASE,
      lockFileContents: JSON.parse(new TextDecoder().decode(lock)),
      createPyodideModule,
      env: { PYTHONHASHSEED: "0" },
      stdout: () => {},
      stderr: () => {},
    })) as Pyodide;
    runtime.runPython(settings.runner);
    return runtime;
  }

  async function run(id: number, request: string, packages: string[]) {
    if (!config) throw new Error("The Python worker was not set up.");
    const settings = config;
    python ??= start(settings).catch((error: unknown) => {
      python = null;
      throw error;
    });
    const runtime = await python;
    if (packages.length) {
      let failure = "";
      await runtime.loadPackage(packages, {
        messageCallback: () => {},
        errorCallback: (message: string) => {
          failure ||= message;
        },
      });
      if (failure) throw new Error(failure);
    }
    const text = runtime.globals.get("_ocsc_run")(request, settings.version);
    scope.postMessage({ type: "done", id, text: String(text) });
  }

  scope.onmessage = ({ data }) => {
    if (data.type === "init") {
      config = data.config;
    } else if (data.type === "file") {
      const pending = waiting.get(data.id);
      waiting.delete(data.id);
      if (data.bytes) pending?.resolve(data.bytes);
      else pending?.reject(new Error(data.error || "The Python runtime could not be loaded."));
    } else if (data.type === "run") {
      queue = queue.then(() =>
        run(data.id, data.request, data.packages).catch((error: unknown) => {
          scope.postMessage({
            type: "error",
            id: data.id,
            message: error instanceof Error ? error.message : String(error),
          });
        }),
      );
    }
  };
}
