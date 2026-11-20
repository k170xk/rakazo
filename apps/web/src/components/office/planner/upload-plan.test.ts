import { afterEach, describe, expect, it, vi } from "vitest";
import { isPlanUploadName, preparePlanUpload } from "./upload-plan";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("preparePlanUpload", () => {
  it("converts binary Microsoft Project .mpp via the server into a .jantt upload", async () => {
    const xml = `<?xml version="1.0"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Title>Mountjoy Square</Title>
  <Tasks>
    <Task><UID>1</UID><ID>1</ID><Name>Foundations</Name><OutlineNumber>1</OutlineNumber><Milestone>0</Milestone><Start>2026-03-01T08:00:00</Start><Finish>2026-03-20T17:00:00</Finish></Task>
    <Task><UID>2</UID><ID>2</ID><Name>Handover</Name><OutlineNumber>2</OutlineNumber><Milestone>1</Milestone><Start>2026-03-21T08:00:00</Start><Finish>2026-03-21T17:00:00</Finish>
      <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink>
    </Task>
  </Tasks>
</Project>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(xml, { status: 200, headers: { "content-type": "application/xml" } })),
    );
    const file = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])], "Mountjoy.mpp");
    const result = await preparePlanUpload(file, { spaceId: "space_1" });
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.name).toMatch(/\.jantt$/);
      const plan = JSON.parse(await result.file.text()) as {
        tasks?: Array<{ label?: string; milestone?: boolean; wbs?: string; dependsOn?: unknown }>;
        meta?: { title?: string };
        categories?: Record<string, unknown>;
      };
      expect(plan.meta?.title).toBe("Mountjoy Square");
      expect(plan.categories?.default).toBeTruthy();
      expect(plan.tasks).toHaveLength(2);
      expect(plan.tasks?.[1]?.milestone).toBe(true);
      expect(plan.tasks?.[1]?.dependsOn).toBeTruthy();
      expect(plan.tasks?.[0]?.wbs).toBe("1");
    }
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/plans/from-mpp",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces server refusal when .mpp conversion fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Couldn't read that Microsoft Project file." }), {
            status: 422,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const result = await preparePlanUpload(
      new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], "Broken.mpp"),
    );
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.message).toMatch(/Microsoft Project/i);
    }
  });

  it("converts MS Project XML into a .jantt upload", async () => {
    const xml = `<?xml version="1.0"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Title>Mountjoy Square</Title>
  <Tasks>
    <Task><UID>1</UID><ID>1</ID><Name>Foundations</Name><Start>2026-03-01T08:00:00</Start><Finish>2026-03-20T17:00:00</Finish></Task>
  </Tasks>
</Project>`;
    const result = await preparePlanUpload(new File([xml], "Mountjoy.xml", { type: "application/xml" }));
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.name).toMatch(/\.jantt$/);
      const plan = JSON.parse(await result.file.text()) as { tasks?: unknown[]; meta?: { title?: string } };
      expect(Array.isArray(plan.tasks)).toBe(true);
      expect(plan.tasks!.length).toBeGreaterThan(0);
      expect(plan.meta?.title).toBe("Mountjoy Square");
    }
  });

  it("keeps .jantt files as-is", async () => {
    const body = JSON.stringify({ meta: { title: "Site" }, tasks: [] });
    const result = await preparePlanUpload(new File([body], "Site.jantt"));
    expect(result).toEqual({
      kind: "ready",
      file: expect.any(File),
      name: "Site.jantt",
    });
  });
});

describe("isPlanUploadName", () => {
  it("accepts schedule extensions including .mpp", () => {
    expect(isPlanUploadName("a.jantt")).toBe(true);
    expect(isPlanUploadName("a.xml")).toBe(true);
    expect(isPlanUploadName("a.csv")).toBe(true);
    expect(isPlanUploadName("a.mpp")).toBe(true);
  });
});
