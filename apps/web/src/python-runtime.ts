import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

type Pin = { version: string; files: Record<string, { bytes: number }> };

const CONTENT_TYPES: Record<string, string> = {
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".zip": "application/zip",
};

/**
 * Serves the pinned Python runtimes from `<dir>/<version>/<file>` under `urlPrefix`. A version's
 * files never change (each is pinned by hash, and a new pin is a new folder), so browsers keep them
 * for a year without asking again. Anything that is not a pinned file of a retained version is a 404,
 * never the SPA's index.html.
 */
export function pythonRuntimeMiddleware(
  dir: string,
  urlPrefix: string,
  pins: readonly Pin[],
  size: (file: string) => number | null = (file) => {
    try {
      const info = statSync(file);
      return info.isFile() ? info.size : null;
    } catch {
      return null;
    }
  },
) {
  const root = path.resolve(dir);
  const prefix = urlPrefix.endsWith("/") ? urlPrefix : `${urlPrefix}/`;
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const pathname = req.url?.split("?", 1)[0] ?? "/";
    if (!pathname.startsWith(prefix)) {
      next();
      return;
    }
    const [version, name, ...rest] = pathname.slice(prefix.length).split("/");
    const pin = pins.find((each) => each.version === version);
    const expected = name && !rest.length ? pin?.files[name] : undefined;
    const file = expected ? path.join(root, version!, name!) : null;
    const bytes = file ? size(file) : null;
    if (!file || bytes !== expected?.bytes || (req.method !== "GET" && req.method !== "HEAD")) {
      res.statusCode = 404;
      res.setHeader("cache-control", "no-store");
      res.end("Not found");
      return;
    }
    res.statusCode = 200;
    res.setHeader("content-type", CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream");
    res.setHeader("content-length", String(bytes));
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file)
      .on("error", () => res.destroy())
      .pipe(res);
  };
}
