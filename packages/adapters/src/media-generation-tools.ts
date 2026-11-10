import type { AdapterContext, GeneratedMedia, MediaGenerationProvider } from "@rakazo/adapter-kit";
import { MediaGenerationError } from "@rakazo/adapter-kit";
import type { MessageBlock } from "@rakazo/contracts";
import { messageBlockForArtifact } from "@rakazo/core";
import type { ExternalEffect, PrismaClient } from "@rakazo/db";
import { z } from "zod";
import { mediaPromptSchema, validateGeneratedMedia } from "./media-generation-provider.js";

const JOB_KIND = "media_generation_job";
const savedJob = z.object({
  provider: z.string(),
  jobId: z.string().optional(),
  artifactId: z.string().optional(),
});
export async function generateMediaFromTool(options: {
  name: "generate_image";
  args: Record<string, unknown>;
  executionId: string;
  /** Recover only persisted state; never submit a new billed generation. */
  recoverOnly?: boolean;
  provider: MediaGenerationProvider;
  prisma: PrismaClient;
  context: AdapterContext;
  run: { id: string; threadId: string; botId: string; userId: string; spaceId: string };
  attach: (
    output: GeneratedMedia,
    name: string,
    job: { id: string; result: { provider: string; jobId?: string } },
  ) => Promise<{ artifactId: string; block: MessageBlock }>;
  publish: (block: MessageBlock, jobId: string, artifactId: string) => Promise<unknown>;
}) {
  const { provider, prisma, context, run, args } = options;
  if (!provider.capabilities.images) return { error: "Media generation is unavailable." };
  try {
    let reservation: ExternalEffect | null = null;
    const prior = await prisma.externalEffect.findFirst({
      where: {
        runId: run.id,
        kind: JOB_KIND,
        request: { path: ["executionId"], equals: options.executionId },
      },
    });
    if (prior) {
      const saved = savedJob.safeParse(prior.result);
      if (saved.success && saved.data.artifactId) {
        if (prior.status === "media_completed")
          return { status: "completed", artifactId: saved.data.artifactId };
        reservation = prior;
      } else {
        if (options.recoverOnly) return undefined;
        return {
          jobId: prior.id,
          error: "Submission already attempted. Do not resubmit automatically.",
        };
      }
    }
    if (!reservation) {
      if (options.recoverOnly) return undefined;
      const input = mediaPromptSchema.safeParse(args);
      if (!input.success) return { error: "A prompt of 1–4000 characters is required." };
      // A unique slot makes the per-run cap durable even across concurrent calls/restarts.
      for (let slot = 0; slot < 2; slot++) {
        try {
          reservation = await prisma.externalEffect.create({
            data: {
              spaceId: run.spaceId,
              runId: run.id,
              kind: JOB_KIND,
              idempotencyKey: `media:${run.id}:${slot}`,
              status: "media_submitting",
              request: {
                tool: options.name,
                prompt: input.data.prompt,
                executionId: options.executionId,
              },
              result: { provider: provider.id },
            },
          });
          break;
        } catch (error) {
          if (!(error && typeof error === "object" && "code" in error && error.code === "P2002"))
            throw error;
        }
      }
      if (!reservation)
        return { error: "Media generation limit reached (two submissions per run)." };
    }
    const saved = savedJob.parse(reservation.result);
    if (saved.artifactId) {
      const artifact = await prisma.artifact.findFirst({
        where: { id: saved.artifactId, spaceId: run.spaceId, userId: run.userId, botId: run.botId },
      });
      if (!artifact) return { error: "Generated attachment is unavailable." };
      await options.publish(messageBlockForArtifact(artifact), reservation.id, artifact.id);
      return { status: "completed", artifactId: artifact.id };
    }
    const output = await provider.generateImage(mediaPromptSchema.parse(args), context);
    validateGeneratedMedia(output, "image/png");
    context.signal.throwIfAborted();
    const attached = await options.attach(output, `generated-${reservation.id}.png`, {
      id: reservation.id,
      result: { provider: provider.id },
    });
    await options.publish(attached.block, reservation.id, attached.artifactId);
    return { status: "completed", artifactId: attached.artifactId };
  } catch (error) {
    context.signal.throwIfAborted();
    return {
      error:
        error instanceof MediaGenerationError
          ? error.message
          : "Media generation failed. Submission may have been accepted; do not retry automatically.",
    };
  }
}
