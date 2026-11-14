import type { AdapterContext } from "@rakazo/adapter-kit";
import { ATTACHMENT_MAX_BYTES } from "@rakazo/contracts";
import { toolRequiresApproval } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { FakeMediaGenerationProvider } from "./media-generation-provider.js";
import { generateMediaFromTool } from "./media-generation-tools.js";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";

const run = { id: "run", threadId: "thread", botId: "bot", spaceId: "space", userId: "owner" };
const context: AdapterContext = {
  ...run,
  operationId: "op",
  traceId: "trace",
  signal: new AbortController().signal,
};
function setup() {
  const provider = new FakeMediaGenerationProvider();
  const row = {
    id: "local-job",
    status: "media_pending",
    result: { provider: "fake", jobId: "remote-job" },
  };
  const externalEffect = {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi
      .fn()
      .mockResolvedValue({ ...row, status: "media_submitting", result: { provider: "fake" } }),
    update: vi.fn().mockResolvedValue(row),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const attach = vi.fn().mockResolvedValue({
    artifactId: "artifact",
    block: { kind: "image", artifactId: "artifact", name: "generated.png" },
  });
  const publish = vi.fn();
  const options = {
    name: "generate_image" as const,
    args: { prompt: "draw" } as Record<string, unknown>,
    executionId: "execution",
    provider,
    prisma: {
      externalEffect,
      artifact: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient,
    context,
    run,
    attach,
    publish,
  };
  return { options, externalEffect, provider, attach, publish, row };
}

describe("agent media tools", () => {
  it("uses existing approval and per-bot disable controls, hidden by default", () => {
    expect(toolRequiresApproval("generate_image", false)).toBe(true);
    const base = {
      graphicalToolsAllowed: false,
      groupId: null,
      trigger: "message",
      semanticMemoryEnabled: false,
      messagingChannelRun: false,
    };
    const names = (extra = {}) =>
      selectBuiltinToolsForRun({ ...base, ...extra }).map((tool) => tool.name);
    expect(names()).not.toContain("generate_image");
    expect(names()).not.toContain("generate_video");
    expect(names({ mediaImagesEnabled: true })).toContain("generate_image");
    expect(names({ mediaImagesEnabled: true })).not.toContain("generate_video");
    expect(names({ trigger: "tickets", mediaImagesEnabled: true })).not.toContain("generate_image");
    expect(
      names({ mediaImagesEnabled: true, disabledBuiltinTools: ["generate_image"] }),
    ).not.toContain("generate_image");
  });
  it("reserves before generation and posts stored attachments", async () => {
    const { options, provider, attach, publish, externalEffect } = setup();
    const generate = vi.spyOn(provider, "generateImage");
    expect(await generateMediaFromTool(options)).toEqual({
      status: "completed",
      artifactId: "artifact",
    });
    expect(externalEffect.create.mock.invocationCallOrder[0]).toBeLessThan(
      generate.mock.invocationCallOrder[0]!,
    );
    expect(attach).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "image/png" }),
      "generated-local-job.png",
      expect.objectContaining({ id: "local-job" }),
    );
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid inputs before reserving or billing", async () => {
    const { options, externalEffect } = setup();
    for (const args of [{ prompt: " " }, { jobId: "job" }, {}]) {
      expect(await generateMediaFromTool({ ...options, args })).toHaveProperty("error");
    }
    expect(externalEffect.create).not.toHaveBeenCalled();
  });
  it("enforces durable two-submission limit", async () => {
    const { options, externalEffect, provider } = setup();
    externalEffect.create.mockRejectedValue({ code: "P2002" });
    const generate = vi.spyOn(provider, "generateImage");
    expect(await generateMediaFromTool(options)).toMatchObject({
      error: expect.stringContaining("limit reached"),
    });
    expect(externalEffect.create).toHaveBeenCalledTimes(2);
    expect(generate).not.toHaveBeenCalled();
  });
  it("does not rebill a replayed execution", async () => {
    const { options, externalEffect, row, provider } = setup();
    externalEffect.findFirst.mockResolvedValue(row);
    const generate = vi.spyOn(provider, "generateImage");
    expect(await generateMediaFromTool(options)).toHaveProperty("error");
    expect(generate).not.toHaveBeenCalled();
    expect(externalEffect.create).not.toHaveBeenCalled();
  });
  it("recovers an image after storage succeeds and publication fails without generating again", async () => {
    const { options, externalEffect, row, provider, attach, publish } = setup();
    externalEffect.findFirst.mockResolvedValue({
      ...row,
      result: { ...row.result, artifactId: "artifact" },
    });
    const artifact = {
      id: "artifact",
      name: "generated.png",
      mimeType: "image/png",
      size: 4,
    };
    vi.mocked(options.prisma.artifact.findFirst).mockResolvedValue(artifact as never);
    const image = vi.spyOn(provider, "generateImage");
    publish.mockRejectedValueOnce(new Error("publication failed"));
    expect(await generateMediaFromTool(options)).toHaveProperty("error");
    expect(await generateMediaFromTool(options)).toEqual({
      status: "completed",
      artifactId: artifact.id,
    });
    expect(image).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: artifact.id }),
      row.id,
      artifact.id,
    );
  });
  it("never submits or reserves new work in recovery-only mode", async () => {
    const { options, externalEffect, provider } = setup();
    const submit = vi.spyOn(provider, "generateImage");
    expect(await generateMediaFromTool({ ...options, recoverOnly: true })).toBeUndefined();
    expect(submit).not.toHaveBeenCalled();
    expect(externalEffect.create).not.toHaveBeenCalled();
  });
  it("rejects oversized or wrong-MIME adapter output before storage", async () => {
    const { options, provider, attach } = setup();
    vi.spyOn(provider, "generateImage")
      .mockResolvedValueOnce({
        bytes: new Uint8Array(ATTACHMENT_MAX_BYTES + 1),
        mimeType: "image/png",
      })
      .mockResolvedValueOnce({ bytes: new Uint8Array([1]), mimeType: "video/mp4" } as never);
    expect(await generateMediaFromTool(options)).toHaveProperty("error");
    expect(await generateMediaFromTool(options)).toHaveProperty("error");
    expect(attach).not.toHaveBeenCalled();
  });
});
