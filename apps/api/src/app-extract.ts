import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolRunnerClient, ToolRunnerWorkspace } from "@rakazo/adapters";
import type {
  ExtractedFileImage,
  ExtractedFileResult,
  ExtractedFileTable,
} from "@rakazo/app-kit/protocol";
import {
  APP_EXTRACT_PATH,
  MAX_EXTRACT_BASE64,
  MAX_EXTRACT_BYTES,
} from "@rakazo/app-kit/protocol";
import type { PrismaClient } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import type { Hono } from "hono";
import { requestBodyLimit } from "./request-body-limit.js";

/**
 * Runs `ocsc-extract` on OCSC's remote offline tool runners for an authenticated App Studio app.
 * Every file is parsed inside a disposable, read-only, zero-network container (`NetworkMode: "none"`)
 * and temporary workspace files are deleted as soon as the extracted text, tables and image previews
 * are read back.
 */

export class AppExtractError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 413 | 429 | 502 | 503 = 400,
  ) {
    super(message);
  }
}

export type AppExtractDeps = {
  toolRunner?: ToolRunnerClient;
  dataDir?: string;
};

export type AppExtractBody = {
  name: string;
  mime: string;
  base64: string;
  renderPages: boolean;
  ocr: boolean;
  titleBlock: boolean;
  maxPages: number;
  includeImages: boolean;
};

const EXTRACTS_PER_HOUR = 30;
const extracts = new Map<string, number[]>();
const EXTRACT_TIMEOUT_MS = 90_000;
const MAX_TEXT_CHARS = 64_000;
const MAX_OCR_CHARS = 32_000;
const MAX_TABLES = 10;
const MAX_TABLE_ROWS = 200;
const MAX_PAGE_IMAGES = 4;
const MAX_EMBEDDED_IMAGES = 6;
const MAX_IMAGE_BYTES = 1_800_000;

function allow(userId: string, now = Date.now()) {
  const hour = now - 3_600_000;
  const recent = (extracts.get(userId) ?? []).filter((at) => at > hour);
  if (recent.length >= EXTRACTS_PER_HOUR) {
    extracts.set(userId, recent);
    return false;
  }
  recent.push(now);
  extracts.set(userId, recent);
  return true;
}

export function resetAppExtracts() {
  extracts.clear();
}

export function readExtractBody(raw: unknown): AppExtractBody | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 180) : "";
  const base64 = typeof body.base64 === "string" ? body.base64.trim() : "";
  if (!name || !base64 || base64.length > MAX_EXTRACT_BASE64) return null;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) return null;
  const mime =
    typeof body.mime === "string" && body.mime.trim()
      ? body.mime.trim().slice(0, 120)
      : "application/octet-stream";
  const rawMaxPages = typeof body.maxPages === "number" ? Math.trunc(body.maxPages) : 4;
  return {
    name,
    mime,
    base64,
    renderPages: body.renderPages === true,
    ocr: body.ocr === true,
    titleBlock: body.titleBlock === true,
    maxPages: Math.min(Math.max(rawMaxPages || 4, 1), 12),
    includeImages: body.includeImages !== false,
  };
}

function safeFileName(name: string): string {
  const base = path.basename(name).replace(/[^A-Za-z0-9._ -]+/g, "_").trim();
  const cleaned = base.replace(/^\.+/, "") || "document";
  return cleaned.slice(0, 140);
}

function safeInside(root: string, rel: string): string | null {
  if (!rel || typeof rel !== "string") return null;
  const resolved = path.resolve(root, rel);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

function mimeForExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

function parseCsv(raw: string, maxRows: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && raw[i + 1] === "\n") i += 1;
      row.push(field.trim());
      field = "";
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
        if (rows.length >= maxRows + 1) return rows;
      }
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }
  return rows;
}

async function readImagePreview(
  root: string,
  relPath: string,
  meta: { width?: number | null; height?: number | null; page?: number | null; context?: string | null },
): Promise<ExtractedFileImage | null> {
  const full = safeInside(root, relPath);
  if (!full) return null;
  const mime = mimeForExt(full);
  if (!mime.startsWith("image/")) return null;
  try {
    const bytes = await readFile(full);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
    return {
      name: path.basename(full),
      mime,
      width: meta.width ?? null,
      height: meta.height ?? null,
      page: meta.page ?? null,
      context: meta.context ?? null,
      dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
    };
  } catch {
    return null;
  }
}

function printedJson(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const start = trimmed.lastIndexOf("\n{");
    if (start < 0) return null;
    try {
      const parsed = JSON.parse(trimmed.slice(start + 1));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

export async function extractFileForApp(
  deps: AppExtractDeps,
  input: AppExtractBody & { userId: string; signal?: AbortSignal },
): Promise<ExtractedFileResult> {
  if (!deps.toolRunner || !deps.dataDir) {
    throw new AppExtractError("File extraction is not set up on this server.", 503);
  }
  if (!allow(input.userId)) {
    throw new AppExtractError("Too many file extractions this hour. Try again shortly.", 429);
  }
  const bytes = Buffer.from(input.base64, "base64");
  if (bytes.byteLength === 0) {
    throw new AppExtractError("That file is empty.", 400);
  }
  if (bytes.byteLength > MAX_EXTRACT_BYTES) {
    throw new AppExtractError("That file is larger than the 20 MB extraction limit.", 413);
  }

  const id = randomUUID().replaceAll("-", "").slice(0, 16);
  const mount = `tool-work/documents/app-extract-${id}`;
  const root = path.join(deps.dataDir, mount);
  const workspace: ToolRunnerWorkspace = { mount, cwd: "", root, base: root };
  const fileName = safeFileName(input.name);
  const relInput = `attachments/${fileName}`;

  await mkdir(path.join(root, "attachments"), { recursive: true });
  try {
    await writeFile(path.join(root, relInput), bytes);

    const args = [
      "run",
      "--in",
      relInput,
      "--out",
      "work/extracted",
      "--max-pages",
      String(input.maxPages),
      "--dpi",
      "150",
    ];
    if (input.renderPages) args.push("--render-pages");
    if (input.ocr) args.push("--ocr");
    if (input.titleBlock) args.push("--title-block");
    if (!input.includeImages) args.push("--no-images");

    const run = await deps.toolRunner.run({
      workspace,
      program: "extract",
      args,
      owner: input.userId,
      timeoutMs: EXTRACT_TIMEOUT_MS,
      signal: input.signal,
    });

    const manifest = printedJson(run.stdout);
    if (run.code !== 0 || manifest?.ok !== true) {
      getLogger().warn("app file extraction failed", {
        fileName,
        code: run.code,
        reason: (typeof manifest?.error === "string" ? manifest.error : run.stderr).slice(-500),
      });
      throw new AppExtractError(
        typeof manifest?.error === "string"
          ? manifest.error
          : "Could not extract that file. Check the file is not password-protected or corrupt.",
        502,
      );
    }

    const filesList = Array.isArray(manifest.files)
      ? (manifest.files as Record<string, unknown>[])
      : [];
    const primary = filesList[0] ?? {};
    if (typeof primary.error === "string") {
      throw new AppExtractError(`Could not read ${fileName}: ${primary.error}`, 400);
    }

    // Collect text (bounded)
    let rawText = "";
    const textFile = typeof primary.textFile === "string" ? safeInside(root, primary.textFile) : null;
    if (textFile) {
      rawText = await readFile(textFile, "utf8").catch(() => "");
    } else if (typeof primary.preview === "string") {
      rawText = primary.preview;
    }

    let ocrText: string | undefined;
    const ocrFile = typeof primary.ocrFile === "string" ? safeInside(root, primary.ocrFile) : null;
    if (ocrFile) {
      const rawOcr = await readFile(ocrFile, "utf8").catch(() => "");
      if (rawOcr.trim()) ocrText = rawOcr.slice(0, MAX_OCR_CHARS);
    }

    // If a ZIP or email extracted child files, stitch a compact summary of child text too
    if (!rawText && Array.isArray(primary.extractedFiles)) {
      const chunks: string[] = [];
      for (const child of primary.extractedFiles as Record<string, unknown>[]) {
        const cPath = typeof child.textFile === "string" ? safeInside(root, child.textFile) : null;
        if (cPath) {
          const cText = await readFile(cPath, "utf8").catch(() => "");
          if (cText.trim()) chunks.push(`=== ${String(child.source ?? "file")} ===\n${cText.slice(0, 8000)}`);
        }
      }
      rawText = chunks.join("\n\n");
    }

    const truncated = rawText.length > MAX_TEXT_CHARS;
    const text = truncated ? rawText.slice(0, MAX_TEXT_CHARS) : rawText;

    // Collect tables (Excel sheets, Word/PPTX/PDF/DXF tables, or direct CSV)
    const tableSources: Array<{ name: string; csv: string }> = [];
    if (primary.type === "csv" || primary.type === "tsv") {
      tableSources.push({ name: fileName, csv: relInput });
    }
    if (Array.isArray(primary.sheets)) {
      for (const s of primary.sheets as Record<string, unknown>[]) {
        if (typeof s.csv === "string") {
          tableSources.push({ name: String(s.name ?? "Sheet"), csv: s.csv });
        }
      }
    }
    if (Array.isArray(primary.tables)) {
      for (const t of primary.tables as Record<string, unknown>[]) {
        if (typeof t.csv === "string") {
          tableSources.push({
            name: String(t.name ?? (t.page ? `Page ${t.page}` : path.basename(t.csv, ".csv"))),
            csv: t.csv,
          });
        }
      }
    }

    const tables: ExtractedFileTable[] = [];
    for (const src of tableSources.slice(0, MAX_TABLES)) {
      const fullCsv = safeInside(root, src.csv);
      if (!fullCsv) continue;
      const csvRaw = await readFile(fullCsv, "utf8").catch(() => "");
      if (!csvRaw.trim()) continue;
      const parsed = parseCsv(csvRaw, MAX_TABLE_ROWS);
      if (parsed.length === 0) continue;
      tables.push({
        name: src.name,
        headers: parsed[0] ?? [],
        rows: parsed.slice(1, MAX_TABLE_ROWS + 1),
        totalRows: Math.max(0, parsed.length - 1),
      });
    }

    // Collect title-block crop, rendered PDF pages, and embedded images
    let titleBlockImage: ExtractedFileImage | null = null;
    if (Array.isArray(primary.titleBlockImages) && primary.titleBlockImages.length > 0) {
      const tb = primary.titleBlockImages[0] as Record<string, unknown>;
      if (typeof tb.path === "string") {
        titleBlockImage = await readImagePreview(root, tb.path, {
          width: typeof tb.width === "number" ? tb.width : null,
          height: typeof tb.height === "number" ? tb.height : null,
          page: typeof tb.page === "number" ? tb.page : 1,
          context: "Title block",
        });
      }
    }

    const pageImages: ExtractedFileImage[] = [];
    if (Array.isArray(primary.renderedPages)) {
      for (const rp of (primary.renderedPages as Record<string, unknown>[]).slice(0, MAX_PAGE_IMAGES)) {
        if (typeof rp.path !== "string") continue;
        const img = await readImagePreview(root, rp.path, {
          width: typeof rp.width === "number" ? rp.width : null,
          height: typeof rp.height === "number" ? rp.height : null,
          page: typeof rp.page === "number" ? rp.page : null,
          context: rp.page ? `Page ${rp.page}` : null,
        });
        if (img) pageImages.push(img);
      }
    }

    const images: ExtractedFileImage[] = [];
    if (input.includeImages) {
      if (primary.type === "image") {
        const imgRel =
          typeof primary.convertedPng === "string"
            ? primary.convertedPng
            : typeof primary.path === "string"
              ? primary.path
              : relInput;
        const img = await readImagePreview(root, imgRel, {
          width: typeof primary.width === "number" ? primary.width : null,
          height: typeof primary.height === "number" ? primary.height : null,
          context: fileName,
        });
        if (img) images.push(img);
      } else if (Array.isArray(primary.images)) {
        for (const im of (primary.images as Record<string, unknown>[]).slice(0, MAX_EMBEDDED_IMAGES)) {
          if (typeof im.path !== "string") continue;
          const context =
            typeof im.heading === "string"
              ? im.heading
              : typeof im.slideTitle === "string"
                ? `Slide ${im.slide ?? ""}: ${im.slideTitle}`.trim()
                : typeof im.alt === "string"
                  ? im.alt
                  : typeof im.page === "number"
                    ? `Page ${im.page}`
                    : null;
          const img = await readImagePreview(root, im.path, {
            width: typeof im.width === "number" ? im.width : null,
            height: typeof im.height === "number" ? im.height : null,
            page: typeof im.page === "number" ? im.page : null,
            context,
          });
          if (img) images.push(img);
        }
      }
    }

    return {
      ok: true,
      name: fileName,
      kind: typeof primary.type === "string" ? primary.type : "file",
      bytes: bytes.byteLength,
      ...(typeof primary.totalPages === "number" ? { totalPages: primary.totalPages } : {}),
      ...(typeof primary.hasSelectableText === "boolean"
        ? { hasSelectableText: primary.hasSelectableText }
        : {}),
      text,
      ...(ocrText ? { ocrText } : {}),
      ...(truncated ? { truncated: true } : {}),
      tables,
      ...(titleBlockImage ? { titleBlockImage } : {}),
      pageImages,
      images,
      meta: {
        ...(primary.headers ? { headers: primary.headers } : {}),
        ...(primary.layers ? { layers: primary.layers } : {}),
        ...(primary.layouts ? { layouts: primary.layouts } : {}),
        ...(typeof primary.slidesCount === "number" ? { slidesCount: primary.slidesCount } : {}),
        ...(typeof primary.sheetsCount === "number" ? { sheetsCount: primary.sheetsCount } : {}),
        ...(typeof primary.attachmentsCount === "number"
          ? { attachmentsCount: primary.attachmentsCount }
          : {}),
      },
    };
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

/** The owner's extraction route: signed-in owner of this app only. */
export function mountAppExtract(
  app: Hono,
  prisma: PrismaClient,
  signedInUser: (request: Request) => Promise<string | null>,
  deps: AppExtractDeps,
) {
  const headers = { "cache-control": "no-store" };
  app.post(
    `${APP_EXTRACT_PATH}/:pageId`,
    requestBodyLimit(MAX_EXTRACT_BASE64 + 32_768, "That file is too large (max 20 MB)."),
    async (c) => {
      const userId = await signedInUser(c.req.raw);
      if (!userId) return c.json({ error: "Sign in" }, 401, headers);
      const pageId = (c.req.param("pageId") ?? "").slice(0, 64);
      const page = await runAsSystem("app owner extract", () =>
        prisma.page.findUnique({ where: { id: pageId }, select: { userId: true, kind: true } }),
      );
      if (page?.kind !== "app" || page.userId !== userId) {
        return c.json({ error: "Not found" }, 404, headers);
      }
      const body = readExtractBody(await c.req.json().catch(() => null));
      if (!body) return c.json({ error: "Invalid file payload." }, 400, headers);
      try {
        const result = await extractFileForApp(deps, {
          ...body,
          userId,
          signal: c.req.raw.signal,
        });
        return c.json(result, 200, headers);
      } catch (error) {
        if (error instanceof AppExtractError) {
          return c.json({ error: error.message }, error.status, headers);
        }
        throw error;
      }
    },
  );
}
