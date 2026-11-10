import { normalizedHttpUrl } from "@rakazo/core/egress";
import { executeCloudAgentTool } from "./cloud-agent-service.js";
import { collectLogIds } from "./composio-connector.js";
import { connectApp } from "./connect-app.js";
import { addMcpServerFromTool } from "./mcp-server-tool.js";
import type { RunContext } from "./run-context.js";
import { runScopedToolExecutionId } from "./run-effects.js";
import { flushProgress, publishMidTurnNarration, showNarrationStatus } from "./run-progress.js";
import type { ToolCall, ToolHandlers } from "./run-tool-gate.js";
import { recordComputerAction } from "./run-tools-computer.js";
import { runFilePath, runFiles } from "./run-tools-files.js";
import { webFetchFromTool, webSearchFromTool } from "./web-tools.js";

export async function cloudAgentTool(ctx: RunContext, call: ToolCall) {
  const { deps, run, bot, context } = ctx;
  const { name, args, effectKey } = call;
  return call.finish(
    await executeCloudAgentTool(
      { ...deps, cloudAgent: ctx.providers.cloudAgent },
      { ...context, operationId: effectKey, botId: bot.id },
      run,
      name,
      args,
    ),
  );
}

export async function connectorTool(ctx: RunContext, call: ToolCall) {
  const { deps, run, bot, thread, context } = ctx;
  const { name, args, effectKey, connectorCall } = call;
  if (deps.connector) {
    let result: unknown = { error: `unknown tool ${name}` };
    let failedFile: string | undefined;
    for await (const event of deps.connector.execute(
      { ...connectorCall, tool: name, args, executionId: effectKey },
      context,
    )) {
      if (event.type === "file") {
        failedFile = await saveConnectorFile(ctx, call, event.path, event.content);
        continue;
      }
      if (event.type === "result") {
        result = event.data;
        const logIds = collectLogIds(event.data);
        for (const logId of logIds) {
          await deps.events.append({
            spaceId: run.spaceId,
            threadId: thread.id,
            botId: bot.id,
            runId: run.id,
            type: "effect.recorded",
            payload: { tool: name, logId },
          });
        }
      }
      if (event.type === "error") {
        result = { error: event.message };
        for (const logId of event.logIds ?? []) {
          await deps.events.append({
            spaceId: run.spaceId,
            threadId: thread.id,
            botId: bot.id,
            runId: run.id,
            type: "effect.recorded",
            payload: { tool: name, logId },
          });
        }
      }
    }
    return call.finish(failedFile ? { error: failedFile } : result);
  }
  return call.finish({ error: `unknown tool ${name}` });
}

/** A relative path of plain segments, so a connector can only write inside the run's folder. */
export function safeConnectorFilePath(path: string): string | undefined {
  const segments = path.split("/");
  if (
    path.length > 400 ||
    segments.length < 2 ||
    segments.some(
      (segment) => !segment || segment === "." || segment === ".." || /[\\\0]/.test(segment),
    )
  )
    return undefined;
  return segments.join("/");
}

/** Write a connector's file onto the computer; returns why it could not, if it could not. */
async function saveConnectorFile(
  ctx: RunContext,
  call: ToolCall,
  path: string,
  content: Uint8Array,
): Promise<string | undefined> {
  const filePath = safeConnectorFilePath(path);
  if (!filePath) return "The app returned a file with an unusable name.";
  const { files, computer } = runFiles(ctx, call);
  try {
    const ref = await computer();
    ctx.computer.checkpoint.markDirty();
    await files.writeFile(ref, { path: runFilePath(ctx, filePath), content }, ctx.context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "could not save the file";
    await recordComputerAction(ctx, call, "write_file", filePath, { error: message });
    return `The file could not be saved on the computer: ${message}`;
  }
  await recordComputerAction(ctx, call, "write_file", filePath, { bytes: content.byteLength });
  return undefined;
}

/** Web, cloud agents, MCP servers, app connections and connector tools. */
export const integrationTools: ToolHandlers = {
  async web_search(ctx, call) {
    const { context } = ctx;
    const { args } = call;
    const found = await webSearchFromTool(ctx.providers.web, context, args);
    // A result's exact URL was chosen by the search index, not by text in this run.
    for (const hit of ("results" in found && found.results) || []) {
      const url = normalizedHttpUrl(hit.url);
      if (url) ctx.trust.searchResultUrls.add(url);
    }
    return call.finish(found);
  },
  async web_fetch(ctx, call) {
    const { context } = ctx;
    const { args } = call;
    return call.finish(await webFetchFromTool(ctx.providers.web, context, args));
  },
  async add_mcp_server(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args, executionId } = call;
    return call.finish(await addMcpServerFromTool(deps, run, bot.id, args, executionId));
  },
  async connect_app(ctx, call) {
    const { deps, run, runId, context } = ctx;
    const { args, executionId, applied } = call;
    await flushProgress(ctx);
    await showNarrationStatus(ctx, await publishMidTurnNarration(ctx, true));
    return call.finish(
      await connectApp(
        deps,
        deps.connectors?.managedProviders?.() ?? [],
        context,
        run,
        args.app,
        applied?.effect.id ?? runScopedToolExecutionId(runId, executionId),
      ),
    );
  },
};
