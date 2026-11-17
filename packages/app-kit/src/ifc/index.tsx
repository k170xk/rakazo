import { useEffect, useRef, useState } from "react";
import { ifcRuntime } from "../sdk/index.js";
import { matchesPin } from "./hash.js";
import { modelKey, shouldLoadModel } from "./load.js";
import { IFC_RUNTIME } from "./runtime.js";
import { ifcWorker, type FromIfcWorker, type ToIfcWorker } from "./worker.js";

export { IFC_RUNTIME_PATH, isIfcFileRequest, MAX_IFC_BYTES } from "./runtime.js";

const UNAVAILABLE = "IFC viewing isn't available here.";
const MAX_VIEWERS = 2;
const WORKER_SOURCE = `(${ifcWorker.toString()})();`;
let viewers = 0;

type View = { positions: Float32Array; products: number };

/**
 * Opens an IFC model. The engine stays on the host and is loaded only when a model is opened, so
 * the app itself stays small. Pass bytes, an asset id from app_asset, or leave both out and the
 * person drops a file.
 */
export function IfcView({
  bytes,
  asset,
  className,
}: {
  bytes?: Uint8Array;
  asset?: string;
  className?: string;
}) {
  const [status, setStatus] = useState<"empty" | "loading" | "ready" | "error" | "unavailable">("empty");
  const [message, setMessage] = useState("");
  const [view, setView] = useState<View | null>(null);
  const [dropped, setDropped] = useState<Uint8Array | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const angles = useRef({ yaw: 0.6, pitch: 0.5 });

  const model = bytes ?? dropped;
  const key = modelKey(model);
  const modelRef = useRef(model);
  modelRef.current = model;

  useEffect(() => {
    if (!ifcRuntime.available()) {
      setStatus("unavailable");
      setMessage(UNAVAILABLE);
      return;
    }
    if (!shouldLoadModel(key, asset)) {
      setStatus("empty");
      setView(null);
      return;
    }
    if (viewers >= MAX_VIEWERS) {
      setStatus("error");
      setMessage("Close another model before opening this one.");
      return;
    }
    viewers += 1;
    let cancelled = false;
    let released = false;
    let worker: Worker | null = null;
    const release = () => {
      if (released) return;
      released = true;
      viewers = Math.max(0, viewers - 1);
    };
    const fail = (text: string) => {
      release();
      if (!cancelled) {
        setStatus("error");
        setMessage(text);
      }
    };
    const run = async () => {
      let source = modelRef.current;
      if (!source && asset) {
        setStatus("loading");
        setMessage("Reading the model");
        source = await ifcRuntime.asset(asset);
      }
      if (!source) return;
      setStatus("loading");
      setMessage("Loading the viewer");
      const [api, wasm] = await Promise.all([
        ifcRuntime.file(IFC_RUNTIME.version, IFC_RUNTIME.api),
        ifcRuntime.file(IFC_RUNTIME.version, IFC_RUNTIME.wasm),
      ]);
      if (!matchesPin(api, IFC_RUNTIME.files[IFC_RUNTIME.api]!) || !matchesPin(wasm, IFC_RUNTIME.files[IFC_RUNTIME.wasm]!)) {
        throw new Error("The IFC engine on this server does not match the one this app expects.");
      }
      if (cancelled) return;
      const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
      worker = new Worker(url);
      URL.revokeObjectURL(url);
      const apiCopy = new Uint8Array(api);
      const wasmCopy = new Uint8Array(wasm);
      const modelCopy = new Uint8Array(source);
      worker.onmessage = (event: MessageEvent<FromIfcWorker>) => {
        const reply = event.data;
        if (reply.type === "ready") {
          setMessage("Opening the model");
          worker?.postMessage({ type: "open", id: 1, model: modelCopy } satisfies ToIfcWorker);
        } else if (reply.type === "opened") {
          worker?.terminate();
          release();
          setView({ positions: reply.positions, products: reply.products });
          setStatus(reply.positions.length ? "ready" : "error");
          setMessage(reply.positions.length ? `${reply.products} elements` : "This model has no geometry to draw.");
        } else if (reply.type === "error") {
          worker?.terminate();
          fail(reply.message);
        }
      };
      worker.postMessage({ type: "init", api: apiCopy, wasm: wasmCopy } satisfies ToIfcWorker, [
        apiCopy.buffer,
        wasmCopy.buffer,
      ]);
    };
    run().catch((error: unknown) => fail(error instanceof Error ? error.message : UNAVAILABLE));
    return () => {
      cancelled = true;
      release();
      worker?.terminate();
    };
  }, [key, asset]);

  useEffect(() => {
    const node = canvas.current;
    if (!node || !view) return;
    const paint = () => {
      const context = node.getContext("2d");
      if (!context) return;
      const width = node.clientWidth || 640;
      const height = node.clientHeight || 360;
      node.width = width;
      node.height = height;
      context.clearRect(0, 0, width, height);
      const { positions } = view;
      let minX = Infinity;
      let minY = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let maxZ = -Infinity;
      for (let index = 0; index < positions.length; index += 3) {
        minX = Math.min(minX, positions[index]!);
        minY = Math.min(minY, positions[index + 1]!);
        minZ = Math.min(minZ, positions[index + 2]!);
        maxX = Math.max(maxX, positions[index]!);
        maxY = Math.max(maxY, positions[index + 1]!);
        maxZ = Math.max(maxZ, positions[index + 2]!);
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const cz = (minZ + maxZ) / 2;
      const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);
      const scale = (Math.min(width, height) * 0.8) / span;
      const yaw = angles.current.yaw;
      const pitch = angles.current.pitch;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);
      context.fillStyle = "#1f6b3a";
      for (let index = 0; index < positions.length; index += 3) {
        const x = positions[index]! - cx;
        const y = positions[index + 1]! - cy;
        const z = positions[index + 2]! - cz;
        const xr = x * cosY - z * sinY;
        const zr = x * sinY + z * cosY;
        const yr = y * cosP - zr * sinP;
        context.fillRect(width / 2 + xr * scale, height / 2 - yr * scale, 1.5, 1.5);
      }
    };
    paint();
    const onPointer = (event: PointerEvent) => {
      if (!drag.current) return;
      angles.current.yaw = drag.current.yaw + (event.clientX - drag.current.x) / 180;
      angles.current.pitch = drag.current.pitch + (event.clientY - drag.current.y) / 180;
      paint();
    };
    node.addEventListener("pointermove", onPointer);
    return () => node.removeEventListener("pointermove", onPointer);
  }, [view]);

  return (
    <div className={className ? `flex flex-col gap-2 ${className}` : "flex flex-col gap-2"}>
      {status === "ready" && (
        <canvas
          ref={canvas}
          className="bg-card h-80 w-full cursor-grab rounded-xl border"
          onPointerDown={(event) => {
            drag.current = { x: event.clientX, y: event.clientY, ...angles.current };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
        />
      )}
      {status !== "ready" && (
        <label className="bg-card text-muted-foreground flex h-80 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm">
          <span>{status === "empty" ? "Drop an IFC model" : message}</span>
          {(status === "empty" || status === "error") && (
            <input
              className="sr-only"
              type="file"
              accept=".ifc,model/ifc"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void file.arrayBuffer().then((buffer) => setDropped(new Uint8Array(buffer)));
              }}
            />
          )}
        </label>
      )}
      {status === "ready" && <p className="text-muted-foreground text-xs">{message}. Drag to turn it.</p>}
    </div>
  );
}
