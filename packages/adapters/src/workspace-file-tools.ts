import type { AdapterContext, ComputerRef } from "@rakazo/adapter-kit";
import type { ComputerMode } from "@rakazo/contracts";
import { ATTACHMENT_MAX_BYTES } from "@rakazo/contracts";
import { redactSecrets } from "@rakazo/core";
import { getLogger } from "@rakazo/logging";
import { JSDOM } from "jsdom";
import { displayBotWorkspacePath, resolveRunFilePath } from "./computer-support.js";
import type { ExecutorDeps } from "./executor-deps.js";
import type { PlotSpec } from "./plot-tool.js";
import {
  assertPlotDataWithinLimits,
  PLOT_TOOL_GUIDE,
  parsePlotData,
  plotSvgToPng,
  renderPlotSpecToSvg,
  searchChartCatalog,
} from "./plot-tool.js";
import { publishMessage } from "./run-messages.js";
import { attachWorkspaceFileToThread } from "./thread-artifacts.js";
import type { WorkspaceFiles } from "./tool-runner.js";
/** The bot workspace a run reaches on its computer. */
export type RunWorkspace = {
  botId: string;
  computerMode: ComputerMode;
  /** A colleague's turn: every path stays in this conversation folder. */
  folder?: string;
  computer: () => Promise<ComputerRef>;
  /** The computer's files, or the tool runner folder's on a run that has one. */
  files: WorkspaceFiles;
  markDirty: () => void;
  context: AdapterContext;
  runSecrets: string[];
  /** Whether the active model accepts inline image blocks in tool results. */
  acceptsImages?: boolean;
};

const MAX_MODEL_FILE_BYTES = 250_000;
const MAX_MODEL_IMAGE_BYTES = 4_000_000;

function detectImageMimeType(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | "image/gif" | null {
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    bytes.byteLength >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  return null;
}

const IMAGE_PATH_EXT = /\.(png|jpe?g|webp|gif)$/i;

function runFileWorkspace(workspace: RunWorkspace) {
  return { mode: workspace.computerMode, botId: workspace.botId, folder: workspace.folder };
}

function displayRunFilePath(workspace: RunWorkspace, requestedPath: string, storedPath: string) {
  const { folder } = workspace;
  if (!folder) {
    return displayBotWorkspacePath(
      workspace.computerMode,
      workspace.botId,
      requestedPath,
      storedPath,
    );
  }
  return storedPath.startsWith(`${folder}/`) ? storedPath.slice(folder.length + 1) : storedPath;
}

export async function listFilesFromTool(
  sandbox: WorkspaceFiles,
  workspace: RunWorkspace,
  args: Record<string, unknown>,
) {
  const { computer, context, runSecrets } = workspace;
  const requestedPath = String(args.path ?? "");
  const entries = await sandbox.listFiles(
    await computer(),
    resolveRunFilePath(runFileWorkspace(workspace), requestedPath),
    context,
  );
  return {
    path: requestedPath,
    entries: entries.map((entry) => ({
      ...entry,
      // A file name can carry a value an earlier command or page wrote.
      path: redactSecrets(displayRunFilePath(workspace, requestedPath, entry.path), runSecrets),
    })),
  };
}

export async function readFileFromTool(
  sandbox: WorkspaceFiles,
  workspace: RunWorkspace,
  args: Record<string, unknown>,
) {
  const { computer, context, runSecrets } = workspace;
  const filePath = String(args.path ?? "");
  const storedPath = resolveRunFilePath(runFileWorkspace(workspace), filePath);
  const looksLikeImage = IMAGE_PATH_EXT.test(filePath);
  const byteLimit = looksLikeImage ? MAX_MODEL_IMAGE_BYTES : MAX_MODEL_FILE_BYTES;
  let bytes: Uint8Array;
  try {
    bytes = await sandbox.readFile(await computer(), storedPath, context, {
      maxBytes: byteLimit,
    });
  } catch (error) {
    if (error instanceof Error && /exceeds \d+ bytes/.test(error.message)) {
      return {
        error: "file is too large for model context",
        path: filePath,
      };
    }
    throw error;
  }
  const imageMime = detectImageMimeType(bytes);
  if (imageMime) {
    if (bytes.byteLength > MAX_MODEL_IMAGE_BYTES) {
      return {
        error: "image is too large for model context",
        path: filePath,
        size: bytes.byteLength,
      };
    }
    const meta = { path: filePath, mimeType: imageMime, bytes: bytes.byteLength };
    if (!workspace.acceptsImages) {
      return {
        ...meta,
        note: "This model cannot see images directly; use the path in ocsc pptx/word specs.",
      };
    }
    return {
      kind: "agent_tool_result" as const,
      content: [
        { type: "text" as const, text: JSON.stringify(meta) },
        {
          type: "image" as const,
          mimeType: imageMime,
          data: Buffer.from(bytes).toString("base64"),
        },
      ],
      details: meta,
    };
  }
  if (bytes.byteLength > MAX_MODEL_FILE_BYTES) {
    return {
      error: "file is too large for model context",
      path: filePath,
      size: bytes.byteLength,
    };
  }
  try {
    return {
      path: filePath,
      content: redactSecrets(new TextDecoder("utf-8", { fatal: true }).decode(bytes), runSecrets),
    };
  } catch {
    return {
      error: "file is not UTF-8 text; use open_path to inspect it",
      path: filePath,
    };
  }
}

/** render_plot: returns the chart guide or catalog, or renders a chart into the workspace and chat. */
export async function renderPlotFromTool(
  deps: ExecutorDeps,
  run: {
    id: string;
    spaceId: string;
    userId: string;
    threadId: string;
    botId: string;
    trigger: string;
  },
  args: Record<string, unknown>,
  executionId: string,
  workspace: RunWorkspace,
  finish: (result: unknown) => Promise<unknown>,
) {
  const { computer, context, runSecrets } = workspace;
  if (args.charts !== undefined) {
    const query = typeof args.charts === "string" ? args.charts : undefined;
    return {
      charts: searchChartCatalog(query),
      note: "Each spec is a complete runnable example: substitute your rows and column names, then call render_plot with it.",
    };
  }
  if (args.help === true || !args.spec || typeof args.spec !== "object") {
    return { guide: PLOT_TOOL_GUIDE };
  }
  // Data and spec mistakes are the model's to fix from the returned error;
  // everything else (reading the data file, rasterizing, attaching) is ours.
  let checkingSpec = false;
  try {
    let rows = Array.isArray(args.data) ? (args.data as unknown[]) : undefined;
    const dataPath =
      typeof args.data_path === "string" && args.data_path ? args.data_path : undefined;
    if (!rows && dataPath) {
      const bytes = await workspace.files.readFile(
        await computer(),
        resolveRunFilePath(runFileWorkspace(workspace), dataPath),
        context,
        { maxBytes: deps.maxUploadSizeBytes ?? ATTACHMENT_MAX_BYTES },
      );
      checkingSpec = true;
      rows = parsePlotData(dataPath, new TextDecoder().decode(bytes));
    }
    checkingSpec = true;
    assertPlotDataWithinLimits(args.spec as PlotSpec, rows);
    const svg = renderPlotSpecToSvg(args.spec as PlotSpec, rows, new JSDOM("").window.document);
    checkingSpec = false;
    const png = await plotSvgToPng(svg);
    const outPath =
      typeof args.path === "string" && args.path ? args.path : `charts/plot-${Date.now()}.png`;
    workspace.markDirty();
    await workspace.files.writeFile(
      await computer(),
      {
        path: resolveRunFilePath(runFileWorkspace(workspace), outPath),
        content: png,
      },
      context,
    );
    let attached = false;
    const chartName = outPath.split("/").pop() ?? "chart";
    const chartRows = rows ?? (args.spec as { data?: unknown[] }).data ?? [];
    const chartSpec = { ...(args.spec as Record<string, unknown>) };
    delete chartSpec.data;
    const chartFits =
      Array.isArray(chartRows) &&
      JSON.stringify({ spec: chartSpec, data: chartRows }).length <= 200_000;
    if (args.attach !== false && chartFits) {
      // Live inline chart: the client re-renders the validated spec
      // and the PNG stays on disk as the exportable copy.
      await publishMessage(deps, run, "bot", [
        {
          kind: "chart",
          name: chartName,
          spec: chartSpec,
          data: chartRows,
        },
      ]);
      attached = true;
    } else if (args.attach !== false && deps.artifacts) {
      const result = await attachWorkspaceFileToThread(
        {
          prisma: deps.prisma,
          artifacts: deps.artifacts,
          maxUploadSizeBytes: deps.maxUploadSizeBytes,
        },
        {
          spaceId: run.spaceId,
          userId: run.userId,
          botId: workspace.botId,
          runId: run.id,
          filePath: outPath,
          bytes: png,
          operationId: executionId,
        },
      );
      await publishMessage(deps, run, "bot", [result.block]);
      attached = true;
    }
    return finish({ ok: true, path: outPath, attached });
  } catch (error) {
    const message = redactSecrets(
      error instanceof Error ? error.message : String(error),
      runSecrets,
    );
    if (!checkingSpec)
      getLogger().error(`render_plot failed for agent ${workspace.botId}: ${message}`);
    return finish({
      error: message,
      hint: 'Call render_plot with {"charts": true} for runnable example specs, or {"help": true} for the full guide.',
    });
  }
}
