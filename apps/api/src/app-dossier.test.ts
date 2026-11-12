import { describe, expect, it, vi } from "vitest";

vi.mock("@rakazo/adapters", () => ({ companyModel: () => model }));
let model: { provider: string; key: string; model: string } | null = null;

const { appFeatures, appFindings, writeDossier } = await import("./app-dossier.js");

const input = (overrides: Partial<Parameters<typeof writeDossier>[0]> = {}) => ({
  title: "Staff contacts",
  brief: "Keeps emergency contacts for site staff.",
  version: 3,
  versions: 3,
  createdAt: new Date("2026-11-01T09:00:00Z"),
  creator: { name: "Ann Byrne", email: "ann@ocsc.ie" },
  builtBy: "Vox",
  dataAccess: "company",
  visibility: "private",
  files: {
    "App.tsx":
      'import { ai } from "@ocsc/app";\nexport default () => { void ai.ask("hi"); return <div dangerouslySetInnerHTML={{ __html: "" }} />; };',
  },
  tables: [
    {
      schema: {
        name: "people",
        label: "People",
        columns: [
          { key: "name", label: "Name", type: "text" as const },
          { key: "next_of_kin", label: "Next of kin", type: "text" as const },
          { key: "mobile", label: "Mobile", type: "text" as const },
        ],
      },
      rows: 12,
    },
  ],
  assets: 0,
  ...overrides,
});

describe("app dossier", () => {
  it("finds the connectors and risky code an app uses", () => {
    const features = appFeatures(input().files);
    expect(features).toMatchObject({ ai: true, rawHtml: true, dynamicCode: false, uploads: false });
  });

  it("flags personal data that every colleague can change as high", () => {
    const findings = appFindings(input());
    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: "high",
        title: "Personal data",
        detail: expect.stringContaining("Next of kin"),
      }),
    );
    expect(findings.map((f) => f.title)).toEqual(
      expect.arrayContaining([
        "Any colleague can change every row",
        "Writes raw HTML",
        "Sends data to the company AI model",
      ]),
    );
    expect(
      appFindings(input({ dataAccess: "owner" })).find((f) => f.title === "Personal data")
        ?.severity,
    ).toBe("medium");
  });

  it("is the automated facts alone when no company model is set up", async () => {
    model = null;
    const dossier = await writeDossier(input());
    expect(dossier).toContain("# Staff contacts: technical review");
    expect(dossier).toContain("**Creator:** Ann Byrne <ann@ocsc.ie>");
    expect(dossier).toContain("**People** (`people`, 12 rows)");
    expect(dossier).toContain("HIGH · Personal data");
    expect(dossier).toContain("automated checks only");
  });

  it("puts the model's review above the facts", async () => {
    model = { provider: "openai", key: "k", model: "m" };
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "## Summary\nIt keeps contacts." }],
          },
        ],
      }),
    );
    const dossier = await writeDossier(input(), fetchImpl as unknown as typeof fetch);
    expect(dossier.indexOf("## Summary")).toBeLessThan(dossier.indexOf("## Facts"));
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.input).toContain("--- App.tsx ---");
    expect(body.store).toBe(false);
    model = null;
  });
});
