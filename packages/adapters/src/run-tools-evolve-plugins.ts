import { provenEmail } from "@rakazo/core";
import { runAsSystem } from "@rakazo/db";
import { z } from "zod";
import { resolveBotWorkspacePath } from "./computer-support.js";
import {
  callEvolveAssistants,
  callEvolveInfographics,
  callEvolveMyProfile,
  callEvolvePlugins,
  EvolvePluginsError,
  fetchPluginBranch,
  PLUGIN_SLUG,
} from "./evolve-plugins.js";
import type { RunContext } from "./run-context.js";
import type { ToolCall, ToolHandlers } from "./run-tool-gate.js";

export const EVOLVE_PLUGIN_TOOL_NAMES: ReadonlySet<string> = new Set([
  "evolve_plugin_status",
  "evolve_plugin_scopes",
  "evolve_plugin_submit",
  "evolve_plugin_import_branch",
]);

/** These read or write the bot's own computer. */
export const EVOLVE_PLUGIN_COMPUTER_TOOLS: ReadonlySet<string> = new Set([
  "evolve_plugin_submit",
  "evolve_plugin_import_branch",
]);

const SUBMISSION_MAX_BYTES = 6 * 1024 * 1024;

const SubmitSchema = z
  .object({
    path: z.string().trim().min(1).max(300),
    submitForReview: z.boolean().optional(),
    purpose: z.string().trim().max(2000).optional(),
  })
  .strict();

const ImportSchema = z
  .object({
    branch: z.string().trim().min(1).max(200),
    folder: z.string().trim().regex(PLUGIN_SLUG),
  })
  .strict();

const SubmissionSchema = z.object({
  manifest: z.record(z.string(), z.unknown()),
  bundle: z.record(z.string(), z.string()),
  source: z.record(z.string(), z.string()),
  engine: z.enum(["ocsc-intelligence", "cursor"]).optional(),
});

const issues = (error: z.ZodError) =>
  error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join(" ");

export async function personEmail(ctx: RunContext): Promise<string | null> {
  const user = await runAsSystem("read the run owner's email for Evolve plugins", () =>
    ctx.deps.prisma.user.findUnique({
      where: { id: ctx.run.userId },
      select: { email: true, emailVerified: true },
    }),
  );
  return provenEmail(user);
}

const DEDICATED_ONLY =
  "Plugins are built on a bot with its own computer. Create a bot called Plugin Builder with a dedicated (Private) computer and build the plugin there.";

async function withEvolve(
  ctx: RunContext,
  call: ToolCall,
  work: (email: string) => Promise<unknown>,
): Promise<unknown> {
  const connection = ctx.deps.evolvePlugins;
  if (!connection) return call.finish({ error: "Evolve plugins are not set up on this server." });
  const email = await personEmail(ctx);
  if (!email) return call.finish({ error: "Your account has no email to match in Evolve." });
  try {
    return call.finish(await work(email));
  } catch (error) {
    if (error instanceof EvolvePluginsError)
      return call.finish({ error: error.message, status: error.status });
    throw error;
  }
}

/** Builder status first, so a person without the privilege hears why before any work. */
async function requireBuilder(ctx: RunContext, email: string) {
  const status = await callEvolvePlugins<{ builder: boolean }>(
    ctx.deps.evolvePlugins!,
    email,
    { action: "status" },
    { signal: ctx.context.signal },
  );
  if (!status.builder) {
    throw new EvolvePluginsError(
      "You do not have the Plugin builder privilege in Evolve. Ask an Evolve admin to add it in Access Control → Privileges.",
      403,
    );
  }
}

const KnowledgeSearchSchema = z
  .object({
    query: z.string().trim().min(1).max(1000),
    maxResults: z.number().int().min(1).max(20).optional(),
    conversationId: z.string().uuid().optional(),
  })
  .strict();

const InfographicsSchema = z
  .object({
    infographics: z
      .array(
        z
          .object({
            title: z.string().trim().max(200).optional(),
            subtitle: z.string().trim().max(300).optional(),
            topic: z.string().trim().min(1).max(2000),
            withText: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();

/** GPT Image renders in parallel on Evolve; the slowest of a batch can take about three minutes. */
const INFOGRAPHICS_TIMEOUT_MS = 200_000;

export const evolvePluginTools: ToolHandlers = {
  async evolve_my_profile(ctx, call) {
    return withEvolve(ctx, call, (email) =>
      callEvolveMyProfile(ctx.deps.evolvePlugins!, email, { signal: ctx.context.signal }),
    );
  },
  async evolve_infographics(ctx, call) {
    const input = InfographicsSchema.safeParse(call.args);
    if (!input.success) return call.finish({ error: issues(input.error) });
    return withEvolve(ctx, call, (email) =>
      callEvolveInfographics(
        ctx.deps.evolvePlugins!,
        email,
        { infographics: input.data.infographics },
        { signal: ctx.context.signal, timeoutMs: INFOGRAPHICS_TIMEOUT_MS },
      ),
    );
  },

  async evolve_knowledge_search(ctx, call) {
    const assistantId = ctx.bot.evolveAssistantId;
    if (!assistantId)
      return call.finish({ error: "This bot was not started from an Evolve assistant." });
    const input = KnowledgeSearchSchema.safeParse(call.args);
    if (!input.success) return call.finish({ error: issues(input.error) });
    // A chat opened from an archived conversation searches that conversation's files by default.
    const conversationId =
      input.data.conversationId ??
      (
        await ctx.deps.prisma.evolveConversationLink.findFirst({
          where: { botId: ctx.bot.id },
          orderBy: { createdAt: "asc" },
          select: { conversationId: true },
        })
      )?.conversationId;
    return withEvolve(ctx, call, (email) =>
      callEvolveAssistants(
        ctx.deps.evolvePlugins!,
        email,
        {
          action: "search",
          assistantId,
          includePersonal: true,
          ...input.data,
          ...(conversationId ? { conversationId } : {}),
        },
        { signal: ctx.context.signal },
      ),
    );
  },

  async evolve_plugin_status(ctx, call) {
    return withEvolve(ctx, call, async (email) => {
      const connection = ctx.deps.evolvePlugins!;
      const status = await callEvolvePlugins<{ builder: boolean; name: string | null }>(
        connection,
        email,
        { action: "status" },
        { signal: ctx.context.signal },
      );
      if (!status.builder)
        return { builder: false, note: "Ask an Evolve admin for the Plugin builder privilege." };
      const list = await callEvolvePlugins(
        connection,
        email,
        { action: "list" },
        { signal: ctx.context.signal },
      );
      return { builder: true, name: status.name, ...list };
    });
  },

  async evolve_plugin_scopes(ctx, call) {
    return withEvolve(ctx, call, (email) =>
      callEvolvePlugins(
        ctx.deps.evolvePlugins!,
        email,
        { action: "scopes" },
        { signal: ctx.context.signal },
      ),
    );
  },

  async evolve_plugin_submit(ctx, call) {
    const parsed = SubmitSchema.safeParse(call.args);
    if (!parsed.success) return call.finish({ error: issues(parsed.error) });
    if (ctx.computer.mode !== "dedicated") return call.finish({ error: DEDICATED_ONLY });
    if (parsed.data.submitForReview && !parsed.data.purpose) {
      return call.finish({
        error: "Add purpose: what the plugin does and who it is for, for the reviewers.",
      });
    }
    return withEvolve(ctx, call, async (email) => {
      await requireBuilder(ctx, email);
      const folder = parsed.data.path.replace(/\/+$/, "");
      let raw: Uint8Array;
      try {
        raw = await ctx.deps.sandbox.readFile(
          await ctx.computer.get("tool", call.name),
          resolveBotWorkspacePath(
            ctx.computer.mode,
            ctx.bot.id,
            `${folder}/.evolve/submission.json`,
          ),
          ctx.context,
          { maxBytes: SUBMISSION_MAX_BYTES },
        );
      } catch {
        return { error: `No build found. Run: ocsc-plugin build ${folder}` };
      }
      const submission = SubmissionSchema.safeParse(
        (() => {
          try {
            return JSON.parse(new TextDecoder().decode(raw));
          } catch {
            return null;
          }
        })(),
      );
      if (!submission.success)
        return { error: `The build file is damaged. Run: ocsc-plugin build ${folder}` };
      const result = await callEvolvePlugins(
        ctx.deps.evolvePlugins!,
        email,
        {
          action: "submit",
          manifest: submission.data.manifest,
          bundle: submission.data.bundle,
          source: submission.data.source,
          engine: submission.data.engine ?? "ocsc-intelligence",
          submitForReview: parsed.data.submitForReview === true,
          purpose: parsed.data.purpose,
        },
        { signal: ctx.context.signal },
      );
      return result;
    });
  },

  async evolve_plugin_import_branch(ctx, call) {
    const parsed = ImportSchema.safeParse(call.args);
    if (!parsed.success) return call.finish({ error: issues(parsed.error) });
    if (ctx.computer.mode !== "dedicated") return call.finish({ error: DEDICATED_ONLY });
    const repo = ctx.deps.evolvePlugins?.repo;
    if (!repo) return call.finish({ error: "No plugins repository is set up on this server." });
    return withEvolve(ctx, call, async (email) => {
      await requireBuilder(ctx, email);
      const files = await fetchPluginBranch(repo, parsed.data.branch, parsed.data.folder, {
        signal: ctx.context.signal,
      });
      const computer = await ctx.computer.get("tool", call.name);
      ctx.computer.checkpoint.markDirty();
      const target = `plugins/${parsed.data.folder}`;
      const encoder = new TextEncoder();
      for (const [file, content] of Object.entries({ ...files, ".evolve/engine": "cursor\n" })) {
        await ctx.deps.sandbox.writeFile(
          computer,
          {
            path: resolveBotWorkspacePath(ctx.computer.mode, ctx.bot.id, `${target}/${file}`),
            content: encoder.encode(content),
          },
          ctx.context,
        );
      }
      return {
        ok: true,
        path: target,
        files: Object.keys(files).length,
        next: `Review the code, then run: ocsc-plugin build ${target}`,
      };
    });
  },
};
