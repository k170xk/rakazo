import { describe, expect, it } from "vitest";
import { pdfAssets, pdfFilename, readPdfDocument } from "./model.js";
import { printable, renderPdf } from "./render.js";

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("readPdfDocument", () => {
  it("needs a title and a list of blocks", () => {
    expect(() => readPdfDocument(null)).toThrow("title");
    expect(() => readPdfDocument({ title: " ", blocks: [] })).toThrow("needs a title");
    expect(() => readPdfDocument({ title: "Report" })).toThrow("list of blocks");
  });

  it("keeps known blocks, drops unknown ones and anything unsafe", () => {
    const doc = readPdfDocument({
      title: "Site inspection",
      kind: "SITE INSPECTION REPORT",
      orientation: "sideways",
      template: { accent: "red", plain: "yes" },
      blocks: [
        { type: "heading", text: "Findings", newPage: "true" },
        { type: "script", text: "alert(1)" },
        { type: "callout", text: "Check the roof", tone: "rainbow" },
        {
          type: "photos",
          photos: [
            { asset: "pic_12345678", lat: 53.3, lon: -6.2, caption: "North wall" },
            { src: "https://example.com/a.jpg" },
            { src: PIXEL },
          ],
        },
        {
          type: "map",
          points: [
            { lat: 95, lon: 0 },
            { lat: 53.3, lon: -6.2, label: "Gate" },
          ],
        },
      ],
    });
    expect(doc.orientation).toBeUndefined();
    expect(doc.template).toBeUndefined();
    expect(doc.blocks.map((block) => block.type)).toEqual(["heading", "callout", "photos", "map"]);
    expect(doc.blocks[0]).toEqual({ type: "heading", text: "Findings" });
    expect(doc.blocks[1]).toEqual({ type: "callout", text: "Check the roof" });
    const photos = doc.blocks[2] as Extract<(typeof doc.blocks)[number], { type: "photos" }>;
    expect(photos.photos).toHaveLength(2);
    expect(photos.photos[0]).toMatchObject({ asset: "pic_12345678", lat: 53.3, lon: -6.2 });
    const map = doc.blocks[3] as Extract<(typeof doc.blocks)[number], { type: "map" }>;
    expect(map.points).toEqual([{ lat: 53.3, lon: -6.2, label: "Gate" }]);
  });

  it("keeps a requested look only when it is valid", () => {
    expect(
      readPdfDocument({ title: "T", blocks: [], template: { accent: "#123abc" } }).template,
    ).toEqual({ accent: "#123abc" });
  });

  it("lists every saved picture once", () => {
    const doc = readPdfDocument({
      title: "T",
      blocks: [
        { type: "image", asset: "pic_aaaaaaaa" },
        { type: "photos", photos: [{ asset: "pic_aaaaaaaa" }, { asset: "pic_bbbbbbbb" }] },
        {
          type: "signatures",
          items: [{ label: "Inspector", signature: { asset: "pic_cccccccc" } }],
        },
      ],
    });
    expect(pdfAssets(doc).sort()).toEqual(["pic_aaaaaaaa", "pic_bbbbbbbb", "pic_cccccccc"]);
  });
});

describe("pdfFilename", () => {
  it("makes a safe name ending .pdf", () => {
    expect(pdfFilename(undefined, "Site / inspection: 12")).toBe("Site - inspection- 12.pdf");
    expect(pdfFilename("report.PDF", "x")).toBe("report.pdf");
    expect(pdfFilename("", "")).toBe("Report.pdf");
  });
});

describe("renderPdf", () => {
  it("swaps characters the PDF fonts lack", () => {
    expect(printable("Café “quoted” ✓ 中")).toBe("Café “quoted” Yes ");
  });

  it("renders every block type into a PDF", () => {
    const doc = readPdfDocument({
      title: "Quarterly report",
      subtitle: "Dublin office",
      reference: "J-1001",
      author: "Keith",
      blocks: [
        { type: "heading", text: "Summary" },
        { type: "text", text: "A **bold** start.\n\nSecond paragraph." },
        { type: "bullets", items: ["One", "Two"], numbered: true },
        { type: "stats", items: [{ label: "Fees", value: "€12k" }] },
        { type: "facts", items: [{ label: "Client", value: "OCSC" }] },
        {
          type: "table",
          columns: ["Item", { label: "Cost", align: "right" }],
          rows: [
            ["A", 1],
            ["Total", 1],
          ],
          total: true,
        },
        { type: "checklist", items: [{ label: "Roof", result: "fail", note: "Leak" }] },
        { type: "callout", title: "Note", text: "Watch this", tone: "warning" },
        { type: "bars", items: [{ label: "A", value: 3 }], format: "number" },
        { type: "image", src: PIXEL, caption: "Pixel" },
        { type: "photos", photos: [{ src: PIXEL, caption: "Photo", lat: 53.3, lon: -6.2 }] },
        { type: "map", points: [{ lat: 53.3, lon: -6.2, label: "Gate" }] },
        { type: "signatures", items: [{ label: "Inspector", name: "Keith" }] },
        { type: "divider" },
        { type: "pageBreak" },
        { type: "subheading", text: "Appendix" },
      ],
    });
    const bytes = new Uint8Array(renderPdf(doc, { pictures: new Map(), maps: new Map() }));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(2000);
  });
});
