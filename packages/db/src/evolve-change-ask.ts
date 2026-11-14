import type { MessageBlock } from "@rakazo/contracts";
import { MessageBlock as MessageBlockSchema } from "@rakazo/contracts";
import { isApprovalAskBlock } from "@rakazo/core";
import { approvalEffectKey, stableJsonValue } from "@rakazo/core/node/approval-effect-key";
import type { Prisma, PrismaClient } from "./client.js";
import { contentEncryptionOf } from "./content-encryption.js";
import { appendEventInTransaction } from "./events.js";

type CardTarget = {
  spaceId: string;
  threadId: string;
  runId: string;
  messageId: string;
  /** Only the person the run belongs to edits its Evolve cards, as only they approve them. */
  userId: string;
};

export type PendingEvolveChange = {
  effectId: string;
  kind: string;
  /** The stored call's arguments, as the approval would replay them. */
  args: Record<string, unknown>;
  /** The stored request exactly, so a revision lands only on the card it was made from. */
  request: Prisma.JsonValue;
};

type AskBlock = Extract<MessageBlock, { kind: "ask" }>;

function pendingChangeAsk(blocks: unknown): { blocks: MessageBlock[]; ask: AskBlock } | null {
  const parsed = MessageBlockSchema.array().safeParse(blocks);
  if (!parsed.success) return null;
  const ask = parsed.data.find((block) => block.kind === "ask" && block.status !== "answered");
  if (ask?.kind !== "ask" || !isApprovalAskBlock(ask)) return null;
  if (
    !ask.deadlineChange &&
    !ask.workPackageChange &&
    !ask.projectCommentChange &&
    !ask.designTeamChange &&
    !ask.siteVisitChange
  )
    return null;
  return { blocks: parsed.data, ask };
}

/** Catalog approvals keep the tool's arguments third in the stored request. */
function argsOf(request: Prisma.JsonValue): Record<string, unknown> | null {
  const value = Array.isArray(request) ? request[2] : request;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function withArgs(request: Prisma.JsonValue, args: Record<string, unknown>): Prisma.InputJsonValue {
  return (
    Array.isArray(request) ? request.map((part, index) => (index === 2 ? args : part)) : args
  ) as Prisma.InputJsonValue;
}

/** The run owner's pending deadline or work package card and the call it would make. */
export async function readPendingEvolveChange(
  prisma: PrismaClient,
  target: CardTarget,
): Promise<PendingEvolveChange | null> {
  await contentEncryptionOf(prisma)?.ring.all(target.spaceId);
  const run = await prisma.run.findFirst({
    where: {
      id: target.runId,
      spaceId: target.spaceId,
      threadId: target.threadId,
      status: "waiting_input",
    },
    select: { userId: true },
  });
  if (!run || run.userId !== target.userId) return null;
  const message = await prisma.message.findFirst({
    where: { id: target.messageId, threadId: target.threadId, runId: target.runId, role: "bot" },
    select: { blocks: true },
  });
  const pending = pendingChangeAsk(message?.blocks);
  if (!pending?.ask.approvalEffectId) return null;
  const effect = await prisma.externalEffect.findFirst({
    where: {
      id: pending.ask.approvalEffectId,
      spaceId: target.spaceId,
      runId: target.runId,
      status: "intended",
    },
    select: { id: true, kind: true, request: true },
  });
  const args = effect ? argsOf(effect.request) : null;
  if (!effect || !args) return null;
  return { effectId: effect.id, kind: effect.kind, args, request: effect.request };
}

/**
 * Replaces a pending card with the previewed edit and the call its approval will replay. Refused
 * when the card was answered, re-edited or its run moved on since it was read.
 */
export async function commitEvolveChangeRevision(
  prisma: PrismaClient,
  target: CardTarget,
  revision: {
    pending: PendingEvolveChange;
    args: Record<string, unknown>;
    ask: AskBlock;
  },
): Promise<{ threadId: string; seq: number } | null> {
  await contentEncryptionOf(prisma)?.ring.all(target.spaceId);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM threads WHERE id = ${target.threadId} FOR UPDATE`;
    const run = await tx.run.findFirst({
      where: {
        id: target.runId,
        spaceId: target.spaceId,
        threadId: target.threadId,
        status: "waiting_input",
      },
      select: { userId: true, botId: true },
    });
    if (!run || run.userId !== target.userId) return null;
    const message = await tx.message.findFirst({
      where: { id: target.messageId, threadId: target.threadId, runId: target.runId, role: "bot" },
      select: { id: true, blocks: true },
    });
    const pending = pendingChangeAsk(message?.blocks);
    if (!message || pending?.ask.approvalEffectId !== revision.pending.effectId) return null;
    const effect = await tx.externalEffect.findFirst({
      where: { id: revision.pending.effectId, runId: target.runId, status: "intended" },
      select: { request: true, idempotencyKey: true },
    });
    if (!effect || stableJsonValue(effect.request) !== stableJsonValue(revision.pending.request))
      return null;
    const request = withArgs(effect.request, revision.args);
    const occurrence = /:[a-f0-9]{64}(:\d+)$/.exec(effect.idempotencyKey ?? "")?.[1] ?? "";
    await tx.externalEffect.update({
      where: { id: revision.pending.effectId },
      data: {
        request,
        idempotencyKey: `${approvalEffectKey(target.runId, revision.pending.kind, revision.args)}${occurrence}`,
      },
    });
    const blocks = pending.blocks.map((block) => (block === pending.ask ? revision.ask : block));
    await tx.message.update({ where: { id: message.id }, data: { blocks } });
    const event = await appendEventInTransaction(tx, {
      spaceId: target.spaceId,
      threadId: target.threadId,
      botId: run.botId,
      type: "thread.message.updated",
      runId: target.runId,
      payload: { messageId: message.id, role: "bot", blocks },
    });
    return { threadId: event.threadId, seq: event.seq };
  });
}
