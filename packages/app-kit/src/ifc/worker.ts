export type ToIfcWorker =
  | { type: "init"; api: Uint8Array; wasm: Uint8Array }
  | { type: "open"; id: number; model: Uint8Array };

export type FromIfcWorker =
  | { type: "ready" }
  | { type: "opened"; id: number; products: number; positions: Float32Array }
  | { type: "error"; id: number; message: string };

const BASE = "https://runtime.invalid/";

type IfcApi = {
  SetWasmPath(path: string, absolute?: boolean): void;
  Init(locate?: unknown, singleThread?: boolean): Promise<void>;
  OpenModel(data: Uint8Array, settings?: { COORDINATE_TO_ORIGIN?: boolean }): number;
  CloseModel(modelID: number): void;
  StreamAllMeshes(
    modelID: number,
    callback: (mesh: {
      geometries: { size(): number; get(index: number): { geometryExpressID: number; flatTransformation: number[] } };
      delete(): void;
    }) => void,
  ): void;
  GetGeometry(modelID: number, id: number): {
    GetVertexData(): number;
    GetVertexDataSize(): number;
    delete(): void;
  };
  GetVertexArray(ptr: number, size: number): Float32Array;
};

/**
 * Opens one IFC model off the page thread. The frame has no network, so the engine's own fetch for
 * its WebAssembly file is answered from the bytes the page already checked.
 */
export function ifcWorker() {
  const scope = self as unknown as {
    postMessage(message: FromIfcWorker, transfer?: Transferable[]): void;
    onmessage: ((event: { data: ToIfcWorker }) => void) | null;
    fetch: typeof fetch;
  };
  let wasm = new Uint8Array();
  let api: IfcApi | null = null;
  let starting: Promise<IfcApi> | null = null;

  scope.onmessage = (event) => {
    const message = event.data;
    if (message.type === "init") {
      wasm = message.wasm;
      starting = start(message.api).then(
        (created) => {
          api = created;
          scope.postMessage({ type: "ready" });
          return created;
        },
        (error: unknown) => {
          starting = null;
          scope.postMessage({ type: "error", id: 0, message: text(error) });
          throw error;
        },
      );
      return;
    }
    void open(message.id, message.model);
  };

  function text(error: unknown): string {
    return error instanceof Error ? error.message : "The model could not be opened.";
  }

  async function start(apiBytes: Uint8Array): Promise<IfcApi> {
    scope.fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith(BASE)) throw new TypeError("The IFC engine has no network.");
      return new Response(wasm as Uint8Array<ArrayBuffer>, {
        headers: { "content-type": "application/wasm" },
      });
    };
    const module = await import(
      URL.createObjectURL(new Blob([apiBytes as Uint8Array<ArrayBuffer>], { type: "text/javascript" }))
    );
    const created = new module.IfcAPI() as IfcApi;
    created.SetWasmPath(BASE, true);
    await created.Init(undefined, true);
    return created;
  }

  function place(matrix: number[], x: number, y: number, z: number): [number, number, number] {
    return [
      matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
      matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
      matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
    ];
  }

  async function open(id: number, model: Uint8Array) {
    try {
      const engine = api ?? (await starting);
      if (!engine) throw new Error("The IFC engine is not ready.");
      const modelID = engine.OpenModel(model, { COORDINATE_TO_ORIGIN: true });
      const positions: number[] = [];
      let products = 0;
      try {
        engine.StreamAllMeshes(modelID, (mesh) => {
          products += 1;
          const count = mesh.geometries.size();
          for (let index = 0; index < count; index += 1) {
            const placed = mesh.geometries.get(index);
            const geometry = engine.GetGeometry(modelID, placed.geometryExpressID);
            const vertices = engine.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
            const stride = Math.max(1, Math.floor(vertices.length / 6 / 24));
            for (let vertex = 0; vertex < vertices.length / 6; vertex += stride) {
              const at = vertex * 6;
              positions.push(...place(placed.flatTransformation, vertices[at]!, vertices[at + 1]!, vertices[at + 2]!));
            }
            geometry.delete();
          }
          mesh.delete();
        });
      } finally {
        engine.CloseModel(modelID);
      }
      const packed = new Float32Array(positions);
      scope.postMessage({ type: "opened", id, products, positions: packed }, [packed.buffer]);
    } catch (error) {
      scope.postMessage({ type: "error", id, message: text(error) });
    }
  }
}
