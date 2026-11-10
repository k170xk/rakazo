import type { AdapterContext } from "@rakazo/adapter-kit";
import { ATTACHMENT_MAX_BYTES } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { createMediaGenerationProvider } from "./media-generation-factory.js";
import {
  FakeMediaGenerationProvider,
  FalMediaGenerationProvider,
} from "./media-generation-provider.js";

const context: AdapterContext = {
  spaceId: "space",
  userId: "owner",
  operationId: "op",
  traceId: "trace",
  signal: new AbortController().signal,
};
const json = (value: unknown) => new Response(JSON.stringify(value));
const job = {
  request_id: "job",
  status_url: "https://queue.fal.run/fal-ai/flux/requests/job/status",
  response_url: "https://queue.fal.run/fal-ai/flux/requests/job",
};
const imageResult = { images: [{ url: "https://cdn.example.test/image.png" }] };
function setup(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  return {
    fetch,
    provider: new FalMediaGenerationProvider({
      apiKey: "fake-key",
      imageModel: "fal-ai/flux/schnell",
      fetch,
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    }),
  };
}

describe("media generation connection", () => {
  it("defaults to disabled and requires explicit models and credentials", () => {
    expect(createMediaGenerationProvider({})).toBeUndefined();
    expect(
      createMediaGenerationProvider({ MEDIA_GENERATION_PROVIDER: "disabled" }),
    ).toBeUndefined();
    expect(
      createMediaGenerationProvider({ MEDIA_GENERATION_PROVIDER: "fake" })?.capabilities.offline,
    ).toBe(true);
    expect(() => createMediaGenerationProvider({ MEDIA_GENERATION_PROVIDER: "unknown" })).toThrow();
    expect(() => createMediaGenerationProvider({ MEDIA_GENERATION_PROVIDER: "fal" })).toThrow();
    expect(
      createMediaGenerationProvider({
        MEDIA_GENERATION_PROVIDER: "fal",
        MEDIA_GENERATION_API_KEY: "fake-key",
        MEDIA_GENERATION_IMAGE_MODEL: "fal-ai/flux/schnell",
        MEDIA_GENERATION_BASE_URL: "https://media.example.test",
      })?.capabilities,
    ).toEqual({ images: true, offline: false });
    expect(() =>
      createMediaGenerationProvider({
        MEDIA_GENERATION_PROVIDER: "fal",
        MEDIA_GENERATION_API_KEY: "fake-key",
        MEDIA_GENERATION_VIDEO_MODEL: "fal-ai/wan/v2.2-a14b/text-to-video",
      }),
    ).toThrow();
  });
  it("has an offline image implementation and no video", async () => {
    const provider = new FakeMediaGenerationProvider();
    expect((await provider.generateImage({ prompt: "draw" }, context)).mimeType).toBe("image/png");
    expect(provider.capabilities).toEqual({ images: true, offline: true });
    expect("generateVideo" in provider).toBe(false);
  });
  it("translates one image generation and downloads without forwarding credentials", async () => {
    const { fetch, provider } = setup(
      json(job),
      json({ status: "COMPLETED" }),
      json(imageResult),
      new Response("image", { headers: { "content-type": "image/png" } }),
    );
    expect(await provider.generateImage({ prompt: "draw" }, context)).toEqual({
      mimeType: "image/png",
      bytes: new TextEncoder().encode("image"),
    });
    expect(fetch.mock.calls[0]![0]).toBe("https://queue.fal.run/fal-ai/flux/schnell");
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toMatchObject({
      prompt: "draw",
      num_images: 1,
      output_format: "png",
    });
    expect(new Headers(fetch.mock.calls[3]![1]?.headers).has("authorization")).toBe(false);
  });
  it("waits through the queue and reports a failed job", async () => {
    const { provider } = setup(
      json(job),
      json({ status: "IN_QUEUE" }),
      json({ status: "COMPLETED", error: "private provider failure" }),
    );
    await expect(provider.generateImage({ prompt: "draw" }, context)).rejects.toMatchObject({
      code: "provider_failure",
    });
  });
  it.each([
    [429, "rate_limit"],
    [401, "authentication"],
    [503, "provider_failure"],
  ])("sanitizes HTTP %i without retrying", async (status, code) => {
    const { provider, fetch } = setup(
      new Response("private provider response", { status: Number(status) }),
    );
    await expect(provider.generateImage({ prompt: "draw" }, context)).rejects.toMatchObject({
      code,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("sanitizes network errors and malformed responses", async () => {
    const { provider, fetch } = setup();
    fetch.mockRejectedValueOnce(new Error("fake-key private endpoint"));
    await expect(provider.generateImage({ prompt: "draw" }, context)).rejects.toThrow(
      "Media generation: provider_failure",
    );
    fetch.mockResolvedValueOnce(new Response("bad JSON"));
    await expect(provider.generateImage({ prompt: "draw" }, context)).rejects.toThrow(
      "Media generation: provider_failure",
    );
  });
  it("rejects unsupported capabilities and invalid prompts before HTTP", async () => {
    const { provider, fetch } = setup();
    await expect(provider.generateImage({ prompt: " " }, context)).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(
      provider.generateImage({ prompt: "x".repeat(4001) }, context),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      new FalMediaGenerationProvider({ apiKey: "fake" }).generateImage({ prompt: "draw" }, context),
    ).rejects.toMatchObject({ code: "unsupported" });
  });
  it("rejects oversized output with and without Content-Length", async () => {
    for (const headers of [
      new Headers({
        "content-length": String(ATTACHMENT_MAX_BYTES + 1),
        "content-type": "image/png",
      }),
      new Headers({ "content-type": "image/png" }),
    ]) {
      const { provider } = setup(
        json(job),
        json({ status: "COMPLETED" }),
        json(imageResult),
        new Response(new Uint8Array(ATTACHMENT_MAX_BYTES + 1), { headers }),
      );
      await expect(provider.generateImage({ prompt: "draw" }, context)).rejects.toMatchObject({
        code: "output_limit",
      });
    }
  });
  it("rejects wrong output MIME and invalid statuses", async () => {
    await expect(
      setup(
        json(job),
        json({ status: "COMPLETED" }),
        json(imageResult),
        new Response("html", { headers: { "content-type": "text/html" } }),
      ).provider.generateImage({ prompt: "draw" }, context),
    ).rejects.toMatchObject({ code: "provider_failure" });
    await expect(
      setup(json(job), json({ status: "unknown" })).provider.generateImage(
        { prompt: "draw" },
        context,
      ),
    ).rejects.toMatchObject({ code: "provider_failure" });
  });
  it("rejects cross-origin queue URLs before forwarding credentials", async () => {
    const { provider, fetch } = setup(
      json({ ...job, status_url: "https://attacker.example.test/status" }),
    );
    await expect(provider.generateImage({ prompt: "draw" }, context)).rejects.toMatchObject({
      code: "provider_failure",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    "http://127.0.0.1/private",
    "http://169.254.169.254/latest/meta-data",
    "file:///etc/passwd",
  ])("rejects unsafe output URL %s", async (url) => {
    const { provider, fetch } = setup(
      json(job),
      json({ status: "COMPLETED" }),
      json({ images: [{ url }] }),
    );
    await expect(provider.generateImage({ prompt: "draw" }, context)).rejects.toMatchObject({
      code: "provider_failure",
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("rejects redirects from output downloads", async () => {
    const { provider } = setup(
      json(job),
      json({ status: "COMPLETED" }),
      json(imageResult),
      new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }),
    );
    await expect(provider.generateImage({ prompt: "draw" }, context)).rejects.toMatchObject({
      code: "provider_failure",
    });
  });
  it("preserves cancellation without making a submission", async () => {
    const controller = new AbortController();
    controller.abort();
    const { provider, fetch } = setup();
    await expect(
      provider.generateImage({ prompt: "draw" }, { ...context, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
