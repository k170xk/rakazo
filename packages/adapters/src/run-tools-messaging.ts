import { UiCard } from "@rakazo/contracts";
import { isBackgroundRunTrigger, redactSecrets } from "@rakazo/core";
import {
  connectAgent,
  messageConnectedAgent,
  respondAgentConnection,
} from "./agent-connections.js";
import { messageBot } from "./bot-messages.js";
import { endCallFromTool, requestUserCall } from "./call-request.js";
import { handoffToGroupBot } from "./group-handoff.js";
import { publishMessage } from "./run-messages.js";
import {
  canPostLongTaskHeadsUp,
  canPublishDurableProgress,
  flushProgress,
  nextProgressNonce,
  progressSinceBudgetStart,
  publishMidTurnNarration,
  showNarrationStatus,
} from "./run-progress.js";
import type { ToolHandlers } from "./run-tool-gate.js";
import {
  clampUserProgressMessage,
  isProgressMessageTruncated,
  MID_TURN_PROGRESS_MIN_TURN_AGE_MS,
  messageUserMaxLength,
  midTurnProgressBudgetUsed,
} from "./user-progress.js";

/** Messages to the user, other bots and connected agents, and calls. */
export const messagingTools: ToolHandlers = {
  async call_user(ctx, call) {
    const { deps, run, thread } = ctx;
    const { args } = call;
    if (
      ctx.source.messagingChannelRun ||
      thread.groupId ||
      ctx.source.voiceCall ||
      isBackgroundRunTrigger(run.trigger)
    ) {
      return call.finish({ error: "Calls require a one-to-one chat." });
    }
    return call.finish(
      await requestUserCall(deps, run, {
        reason: String(args.reason ?? ""),
        opening: String(args.opening ?? ""),
      }),
    );
  },
  async end_call(ctx, call) {
    const { deps, run, bot, thread } = ctx;
    const { args } = call;
    return call.finish(
      await endCallFromTool(
        deps,
        run,
        thread.id,
        bot.id,
        args,
        ctx.source.callClientNonce,
        ctx.source.callEndRun,
      ),
    );
  },
  async request_takeover() {
    return { ok: true };
  },
  async run_subagent(_ctx, call) {
    const { args } = call;
    return {
      ok: true,
      result: String(args.task ?? "done."),
    };
  },
  async message_user(ctx, call) {
    const { deps, run } = ctx;
    const { args } = call;
    const { reply } = ctx.state;
    const rawMessage = redactSecrets(String(args.message ?? ""), ctx.secrets);
    const maxLength = messageUserMaxLength();
    const text = clampUserProgressMessage(rawMessage, maxLength);
    if (!text) return call.finish({ error: "message is required" });
    const truncated = isProgressMessageTruncated(rawMessage, maxLength);
    await flushProgress(ctx);
    // Text written before an answer to the person's mid-task message doesn't use up the
    // allowance meant for that answer.
    const answering = reply.steeringReplyPending;
    reply.steeringReplyPending = false;
    await showNarrationStatus(ctx, await publishMidTurnNarration(ctx));
    // A mid-task message handled meanwhile may have granted a new allowance; keep it.
    reply.steeringReplyPending ||= answering;
    if (!canPublishDurableProgress(reply) && !canPostLongTaskHeadsUp(ctx)) {
      return call.finish({
        ok: true,
        note: midTurnProgressBudgetUsed(progressSinceBudgetStart(reply))
          ? "This update was not posted. The chat already has enough interim messages for this run. Do not send more progress updates — keep working and put everything in your final reply."
          : `This update was not posted because the turn just started. Keep working and put anything the person needs in your final reply. Once the turn has run ${MID_TURN_PROGRESS_MIN_TURN_AGE_MS / 1000} seconds, a later update can be posted.`,
      });
    }
    await publishMessage(deps, run, "bot", [{ kind: "text", text }], true, nextProgressNonce(ctx));
    reply.midTurnUserTexts.push(text);
    reply.publishedMidTurnUserMessage = true;
    return call.finish(
      truncated
        ? {
            ok: true,
            truncated: true,
            note: `This progress update was cut off at ${maxLength} characters and the user only saw the truncated version above — it did NOT deliver your full content. message_user is for short interim beats only, never the final answer. Put your complete answer in your normal final reply instead of relying on this truncated update.`,
          }
        : { ok: true },
    );
  },
  async show_card(ctx, call) {
    const parsed = UiCard.safeParse(redactCardSecrets(call.args, ctx.secrets));
    if (!parsed.success) {
      return call.finish({
        error: "The card could not be shown.",
        issues: parsed.error.issues.slice(0, 5).map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
        hint: "Fill the fields for the chosen type, with one cell per column in each table row.",
      });
    }
    await flushProgress(ctx);
    await publishMessage(ctx.deps, ctx.run, "bot", [{ kind: "ui_card", card: parsed.data }]);
    return call.finish({ ok: true, note: "The card is in the chat. Do not repeat its contents." });
  },
  async message_bot(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args, effectKey } = call;
    const sent = await messageBot(
      deps,
      { ...run, sourceMessageId: run.sourceMessageId },
      { id: bot.id, name: bot.name },
      {
        bot_id: args.bot_id ? String(args.bot_id) : undefined,
        confirm_name: args.confirm_name ? String(args.confirm_name) : undefined,
        message: redactSecrets(String(args.message ?? ""), ctx.secrets),
        intent: args.intent as "request" | "result" | "question" | "status" | "fyi" | undefined,
        deliveryKey: effectKey,
      },
    );
    if (!sent.ok) return call.finish({ error: sent.error });
    return call.finish({
      ok: true,
      botId: sent.botId,
      name: sent.name,
      note: sent.note,
    });
  },
  async connect_agent(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    const result = await connectAgent(
      deps,
      { ...run, sourceMessageId: run.sourceMessageId },
      { id: bot.id, name: bot.name },
      { address: args.address ? String(args.address) : undefined },
    );
    if (!result.ok) return call.finish({ error: result.error });
    return call.finish(result);
  },
  async respond_agent_connection(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    const result = await respondAgentConnection(
      deps,
      { ...run, sourceMessageId: run.sourceMessageId },
      { id: bot.id, name: bot.name },
      {
        accept: Boolean(args.accept),
        connectionId: String(args.connection_id ?? ""),
        connectionVersion: Number(args.connection_version ?? 0),
      },
    );
    if (!result.ok) return call.finish({ error: result.error });
    return call.finish(result);
  },
  async message_agent(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args, effectKey } = call;
    const result = await messageConnectedAgent(
      deps,
      { ...run, sourceMessageId: run.sourceMessageId },
      { id: bot.id, name: bot.name },
      {
        address: args.address ? String(args.address) : undefined,
        message: redactSecrets(String(args.message ?? ""), ctx.secrets),
        deliveryKey: effectKey,
      },
    );
    if (!result.ok) return call.finish({ error: result.error });
    return call.finish(result);
  },
  async handoff_to_bot(ctx, call) {
    const { deps, run, thread } = ctx;
    const { args, effectKey } = call;
    const groupId = args.group_id ? String(args.group_id).trim() : thread.groupId;
    if (!groupId) return call.finish({ error: "group_id is required outside a group chat" });
    const result = await handoffToGroupBot(deps, run, groupId, {
      bot_id: args.bot_id ? String(args.bot_id) : undefined,
      confirm_name: args.confirm_name ? String(args.confirm_name) : undefined,
      message: redactSecrets(String(args.message ?? ""), ctx.secrets),
      deliveryKey: effectKey,
    });
    if ("ok" in result && result.ok && thread.groupId) ctx.state.handedOff = true;
    return call.finish(result);
  },
};

/** Strings in a card pass through the same secret redaction as written replies. */
function redactCardSecrets(value: unknown, secrets: Parameters<typeof redactSecrets>[1]): unknown {
  if (typeof value === "string") return redactSecrets(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactCardSecrets(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactCardSecrets(item, secrets)]),
    );
  }
  return value;
}
