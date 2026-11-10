import { ATTACHMENT_MAX_BYTES, attachmentSizeLabel } from "@rakazo/contracts";
import { inferAttachmentMimeType, isBackgroundRunTrigger } from "@rakazo/core";
import { getLogger } from "@rakazo/logging";
import { searchChatFiles } from "./chat-file-search.js";
import { resolveRunFilePath } from "./computer-support.js";
import { desktopGuardApplies, desktopProtectionGuardMessage } from "./desktop-command-guard.js";
import { protectedActivateScriptWriteRefusal } from "./desktop-guard-words.js";
import { generateMediaFromTool } from "./media-generation-tools.js";
import type { RunContext } from "./run-context.js";
import { persistMessageInTransaction, publishMessage } from "./run-messages.js";
import type { ToolCall, ToolHandlers } from "./run-tool-gate.js";
import { recordComputerAction } from "./run-tools-computer.js";
import {
  attachWorkspaceFileToThread,
  cleanFileNote,
  conversationFilesPage,
  saveThreadFileNote,
  threadFileNotes,
  withFileNotes,
} from "./thread-artifacts.js";
import type { WorkspaceFiles } from "./tool-runner.js";
import { TOOL_RUNNER_COMPUTER } from "./tool-runner.js";
import { textContentArg } from "./tool-text.js";
import type { RunWorkspace } from "./workspace-file-tools.js";
import { listFilesFromTool, readFileFromTool, renderPlotFromTool } from "./workspace-file-tools.js";

function runWorkspace(ctx: RunContext, call: ToolCall): RunWorkspace {
  return {
    botId: ctx.bot.id,
    computerMode: ctx.computer.mode,
    folder: ctx.computer.folder,
    ...runFiles(ctx, call),
    markDirty: () => ctx.computer.checkpoint.markDirty(),
    context: ctx.context,
    runSecrets: ctx.secrets,
  };
}

/**
 * Where this run's file tools reach: the tool runner folder when the run has one, which never
 * starts a computer, otherwise the bot's computer.
 */
export function runFiles(ctx: RunContext, call: ToolCall) {
  const { runner } = ctx.computer;
  if (runner) {
    return {
      files: runner.files,
      computer: async () => {
        await runner.prepare();
        return TOOL_RUNNER_COMPUTER;
      },
    };
  }
  return {
    files: ctx.deps.sandbox,
    computer: () => ctx.computer.get("tool", call.name),
  };
}

/** Both sides of a person whose documents are kept apart from their computer. */
function copySides(ctx: RunContext, call: ToolCall) {
  const { documents } = ctx.computer;
  if (!documents || !ctx.computer.documentsApart || ctx.computer.access !== "full")
    return undefined;
  return {
    computer: {
      files: ctx.deps.sandbox as WorkspaceFiles,
      ref: () => ctx.computer.get("tool", call.name),
    },
    documents: {
      files: documents.files,
      ref: async () => {
        await documents.prepare();
        return TOOL_RUNNER_COMPUTER;
      },
    },
  };
}

async function fileExists(
  files: WorkspaceFiles,
  ref: Parameters<WorkspaceFiles["listFiles"]>[0],
  stored: string,
  context: RunContext["context"],
): Promise<boolean> {
  const segments = stored.split("/").filter(Boolean);
  const name = segments.pop();
  const entries = await files.listFiles(ref, segments.join("/"), context).catch(() => []);
  return entries.some((entry) => entry.path.split("/").filter(Boolean).at(-1) === name);
}

export function runFilePath(ctx: RunContext, filePath: string): string {
  return resolveRunFilePath(
    { mode: ctx.computer.mode, botId: ctx.bot.id, folder: ctx.computer.folder },
    filePath,
  );
}

/** Generate an image or video, or with recoverOnly, only resume a job an earlier attempt started. */
export async function callMediaTool(ctx: RunContext, call: ToolCall, recoverOnly = false) {
  const { deps, run, bot, thread, context } = ctx;
  const { name, args, executionId, applied } = call;
  const mediaGeneration = ctx.providers.mediaGeneration;
  if (
    (name !== "generate_image" && name !== "generate_video") ||
    isBackgroundRunTrigger(run.trigger) ||
    !mediaGeneration ||
    !deps.artifacts
  )
    return { error: "Media generation is unavailable." };
  const artifacts = deps.artifacts;
  return generateMediaFromTool({
    name,
    args,
    executionId: applied?.effect.id ?? executionId,
    recoverOnly,
    provider: mediaGeneration,
    prisma: deps.prisma,
    context,
    run,
    attach: (output, fileName, job) =>
      attachWorkspaceFileToThread(
        { prisma: deps.prisma, artifacts, maxUploadSizeBytes: deps.maxUploadSizeBytes },
        {
          spaceId: run.spaceId,
          userId: run.userId,
          botId: bot.id,
          groupId: thread.groupId ?? undefined,
          runId: run.id,
          filePath: fileName,
          bytes: output.bytes,
          operationId: executionId,
          onAttached: async (tx, artifact) => {
            const checkpointed = await tx.externalEffect.updateMany({
              where: {
                id: job.id,
                status: { not: "media_completed" },
                result: { equals: job.result },
              },
              data: {
                status: "media_polling",
                result: { ...job.result, artifactId: artifact.id },
              },
            });
            if (!checkpointed.count) throw new Error("Media attachment was already checkpointed");
          },
        },
      ),
    publish: async (block, jobId, artifactId) => {
      const committed = await deps.prisma.$transaction(async (tx) => {
        // Commit completion with the message so a restarted poll cannot post twice.
        const claimed = await tx.externalEffect.updateMany({
          where: { id: jobId, status: { not: "media_completed" } },
          data: {
            status: "media_completed",
            result: { provider: mediaGeneration.id, artifactId },
          },
        });
        if (!claimed.count) return null;
        return persistMessageInTransaction(tx, run, "bot", [block]);
      });
      if (committed)
        await deps.events
          .notify(run.threadId, committed.eventSeq, committed.firstResponseRunId)
          .catch(() => undefined);
    },
  });
}

async function generateMedia(ctx: RunContext, call: ToolCall) {
  return call.finish(await callMediaTool(ctx, call));
}

/** Workspace files, attachments, plots and generated media. */
export const fileTools: ToolHandlers = {
  async list_files(ctx, call) {
    const { args } = call;
    const workspace = runWorkspace(ctx, call);
    return listFilesFromTool(workspace.files, workspace, args);
  },
  async read_file(ctx, call) {
    const { args } = call;
    const workspace = runWorkspace(ctx, call);
    return readFileFromTool(workspace.files, workspace, args);
  },
  async write_file(ctx, call) {
    const { context } = ctx;
    const { args } = call;
    const filePath = String(args.path ?? "notes/result.txt");
    if (desktopGuardApplies(ctx.computer)) {
      const activateRefusal = protectedActivateScriptWriteRefusal(filePath);
      if (activateRefusal) {
        return call.finish({ error: desktopProtectionGuardMessage(activateRefusal) });
      }
    }
    const content = new TextEncoder().encode(textContentArg(args.content, ""));
    ctx.computer.checkpoint.markDirty();
    try {
      const { files, computer } = runFiles(ctx, call);
      await files.writeFile(
        await computer(),
        { path: runFilePath(ctx, filePath), content },
        context,
      );
    } catch (error) {
      await recordComputerAction(ctx, call, "write_file", filePath, {
        error: error instanceof Error ? error.message : "could not write file",
      });
      throw error;
    }
    await recordComputerAction(ctx, call, "write_file", filePath, { bytes: content.byteLength });
    return call.finish({ ok: true, path: filePath });
  },
  async copy_file(ctx, call) {
    const { deps, context } = ctx;
    const { args } = call;
    const sides = copySides(ctx, call);
    if (!sides) {
      return call.finish({
        error: "The computer and the document folder are the same here; use the path directly.",
      });
    }
    const from =
      args.from === "documents" ? "documents" : args.from === "computer" ? "computer" : "";
    const filePath = String(args.path ?? "").trim();
    const toPath = typeof args.to === "string" && args.to.trim() ? args.to.trim() : filePath;
    if (!from || !filePath) {
      return call.finish({ error: 'Give from ("computer" or "documents") and the file path.' });
    }
    const source = sides[from];
    const target = sides[from === "computer" ? "documents" : "computer"];
    if (from === "documents" && desktopGuardApplies(ctx.computer)) {
      const activateRefusal = protectedActivateScriptWriteRefusal(toPath);
      if (activateRefusal) {
        return call.finish({ error: desktopProtectionGuardMessage(activateRefusal) });
      }
    }
    const storedFrom = runFilePath(ctx, filePath);
    const storedTo = runFilePath(ctx, toPath);
    const maxBytes = deps.maxUploadSizeBytes ?? ATTACHMENT_MAX_BYTES;
    let content: Uint8Array;
    try {
      content = await source.files.readFile(await source.ref(), storedFrom, context, { maxBytes });
    } catch (error) {
      return call.finish({
        error:
          error instanceof Error && /exceeds \d+ bytes/.test(error.message)
            ? `The file is larger than ${attachmentSizeLabel(maxBytes)}.`
            : `${filePath} was not found on the ${from === "computer" ? "computer" : "document folder"}.`,
      });
    }
    const targetRef = await target.ref();
    if (args.overwrite !== true && (await fileExists(target.files, targetRef, storedTo, context))) {
      return call.finish({
        error: `${toPath} already exists there. Copy it under a new name with to, or pass overwrite only if the person asked to replace that file.`,
      });
    }
    if (from === "documents") ctx.computer.checkpoint.markDirty();
    try {
      await target.files.writeFile(targetRef, { path: storedTo, content }, context);
    } catch (error) {
      await recordComputerAction(ctx, call, "write_file", toPath, {
        error: error instanceof Error ? error.message : "could not copy file",
      });
      throw error;
    }
    await recordComputerAction(ctx, call, "write_file", toPath, { bytes: content.byteLength });
    return call.finish({
      ok: true,
      copied: from === "computer" ? "computer → documents" : "documents → computer",
      path: toPath,
      bytes: content.byteLength,
    });
  },
  async fetch_file(ctx, call) {
    const { deps, context } = ctx;
    const filePath = String(call.args.path ?? "").trim();
    const artifactId = ctx.computer.conversationFiles?.get(filePath)?.artifactId;
    if (!artifactId) {
      return call.finish({
        error:
          "Use the exact attachments/ path of a file in this conversation (see list_conversation_files).",
      });
    }
    if (!deps.artifacts) return call.finish({ error: "File storage is unavailable." });
    const { files, computer } = runFiles(ctx, call);
    const ref = await computer();
    const stored = runFilePath(ctx, filePath);
    if (await fileExists(files, ref, stored, context)) {
      return call.finish({ ok: true, path: filePath, alreadyThere: true });
    }
    const row = await deps.prisma.artifact.findFirst({
      where: { id: artifactId, spaceId: context.spaceId, userId: context.userId },
      select: { storageKey: true, size: true },
    });
    if (!row) return call.finish({ error: "That file is no longer available." });
    const maxBytes = deps.maxUploadSizeBytes ?? ATTACHMENT_MAX_BYTES;
    if (row.size > maxBytes) {
      return call.finish({ error: `The file is larger than ${attachmentSizeLabel(maxBytes)}.` });
    }
    const content = await deps.artifacts.get(row.storageKey, context);
    ctx.computer.checkpoint.markDirty();
    try {
      await files.writeFile(ref, { path: stored, content }, context);
    } catch (error) {
      await recordComputerAction(ctx, call, "write_file", filePath, {
        error: error instanceof Error ? error.message : "could not fetch file",
      });
      throw error;
    }
    await recordComputerAction(ctx, call, "write_file", filePath, { bytes: content.byteLength });
    return call.finish({ ok: true, path: filePath, bytes: content.byteLength });
  },
  async note_file(ctx, call) {
    const { deps, thread } = ctx;
    const filePath = String(call.args.path ?? "").trim();
    const artifactId = ctx.computer.conversationFiles?.get(filePath)?.artifactId;
    if (!artifactId) {
      return call.finish({
        error:
          "Use the exact attachments/ path of a file in this conversation (see list_conversation_files).",
      });
    }
    const note = cleanFileNote(call.args.note);
    if (!note) return call.finish({ error: "Give a short note on what the file contains." });
    await saveThreadFileNote(deps.prisma, {
      spaceId: thread.spaceId,
      threadId: thread.id,
      artifactId,
      note,
    });
    return call.finish({ ok: true, path: filePath, note });
  },
  async list_conversation_files(ctx, call) {
    const files = [...(ctx.computer.conversationFiles?.values() ?? [])];
    const notes = await threadFileNotes(
      ctx.deps.prisma,
      ctx.thread.id,
      files.map((file) => file.artifactId),
    );
    return call.finish(
      conversationFilesPage(withFileNotes(files, notes), {
        query: typeof call.args.query === "string" ? call.args.query : undefined,
        page: Number(call.args.page) || 1,
      }),
    );
  },
  async search_conversation_files(ctx, call) {
    const files = ctx.computer.conversationFiles;
    if (!files?.size) return call.finish({ error: "This conversation has no files to search." });
    try {
      const found = await searchChatFiles(
        { prisma: ctx.deps.prisma },
        {
          threadId: ctx.thread.id,
          query: typeof call.args.query === "string" ? call.args.query : "",
          maxResults: Number(call.args.max_results) || undefined,
          files,
        },
      );
      return call.finish(found);
    } catch (error) {
      getLogger().warn("chat file search failed", {
        threadId: ctx.thread.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return call.finish({
        error: "File search is unavailable right now. Read the files directly instead.",
      });
    }
  },
  generate_image: generateMedia,
  generate_video: generateMedia,
  async render_plot(ctx, call) {
    const { deps, run } = ctx;
    const { args, executionId } = call;
    const workspace = runWorkspace(ctx, call);
    return renderPlotFromTool(deps, run, args, executionId, workspace, call.finish);
  },
  async attach_file(ctx, call) {
    const { deps, run, bot, thread, context } = ctx;
    const { args, executionId } = call;
    const filePath = String(args.path ?? "");
    const failAttach = async (error: string) => {
      await recordComputerAction(ctx, call, "attach_file", filePath, { error });
      return call.finish({ error, path: filePath });
    };
    if (!deps.artifacts) return failAttach("artifact storage unavailable");
    const storedPath = runFilePath(ctx, filePath);
    const maxBytes = deps.maxUploadSizeBytes ?? ATTACHMENT_MAX_BYTES;
    let bytes: Uint8Array;
    try {
      const { files, computer } = runFiles(ctx, call);
      bytes = await files.readFile(await computer(), storedPath, context, { maxBytes });
    } catch (error) {
      return failAttach(
        error instanceof Error && /exceeds \d+ bytes/.test(error.message)
          ? `file is larger than the ${attachmentSizeLabel(maxBytes)} attachment limit; make a smaller copy (for example fewer or compressed images, or a PDF) and attach that`
          : "file not found",
      );
    }
    const mimeType = inferAttachmentMimeType(filePath);
    if (!mimeType) return failAttach("unsupported attachment type");
    try {
      const attached = await attachWorkspaceFileToThread(
        {
          prisma: deps.prisma,
          artifacts: deps.artifacts,
          maxUploadSizeBytes: deps.maxUploadSizeBytes,
        },
        {
          spaceId: run.spaceId,
          userId: run.userId,
          botId: bot.id,
          groupId: thread.groupId ?? undefined,
          runId: run.id,
          filePath,
          bytes,
          operationId: executionId,
          name: typeof args.name === "string" ? args.name : undefined,
          description: typeof args.description === "string" ? args.description : undefined,
        },
      );
      await publishMessage(deps, run, "bot", [attached.block]);
      ctx.state.documents.attached = true;
      await recordComputerAction(ctx, call, "attach_file", filePath);
      return call.finish({ ok: true, artifactId: attached.artifactId, path: filePath });
    } catch (error) {
      return failAttach(error instanceof Error ? error.message : "could not attach file");
    }
  },
};
