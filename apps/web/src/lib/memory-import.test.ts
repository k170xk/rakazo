// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MemoryImportError, readDocx, readMemoryFile } from "./memory-import";

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Writing style</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Use British </w:t></w:r><w:r><w:t>spelling.</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Short sentences</w:t></w:r></w:p>
<w:p><w:r><w:t>Kind regards,</w:t><w:br/><w:t>Keith</w:t></w:r></w:p>
</w:body></w:document>`;

async function deflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Response(data).body?.pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A minimal zip with one entry, stored or deflated, as Word would write it. */
async function zip(name: string, content: string, deflate: boolean): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(name);
  const raw = encoder.encode(content);
  const data: Uint8Array<ArrayBuffer> = deflate ? await deflateRaw(raw) : raw;
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(8, deflate ? 8 : 0, true);
  local.setUint32(18, data.length, true);
  local.setUint32(22, raw.length, true);
  local.setUint16(26, nameBytes.length, true);
  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(10, deflate ? 8 : 0, true);
  central.setUint32(20, data.length, true);
  central.setUint32(24, raw.length, true);
  central.setUint16(28, nameBytes.length, true);
  central.setUint32(42, 0, true);
  const centralStart = 30 + nameBytes.length + data.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, 1, true);
  end.setUint16(10, 1, true);
  end.setUint32(12, 46 + nameBytes.length, true);
  end.setUint32(16, centralStart, true);
  return new Blob([local, nameBytes, data, central, nameBytes, end]).arrayBuffer();
}

const EXPECTED = "# Writing style\nUse British spelling.\n- Short sentences\nKind regards,\nKeith";

describe("memory file import", () => {
  it("reads Word paragraphs, headings and bullets from a deflated or stored docx", async () => {
    expect(await readDocx(await zip("word/document.xml", DOCUMENT, true))).toBe(EXPECTED);
    expect(await readDocx(await zip("word/document.xml", DOCUMENT, false))).toBe(EXPECTED);
  });

  it("reads plain text and refuses files it cannot turn into a note", async () => {
    const text = new File(["Hello\r\n\r\n\r\n\r\nthere  \n"], "notes.md", { type: "" });
    expect(await readMemoryFile(text)).toBe("Hello\n\nthere");
    await expect(readMemoryFile(new File(["x"], "Old.DOC"))).rejects.toMatchObject({
      reason: "legacy-doc",
    });
    await expect(readMemoryFile(new File(["x"], "photo.png"))).rejects.toBeInstanceOf(
      MemoryImportError,
    );
    await expect(readMemoryFile(new File(["  \n"], "blank.txt"))).rejects.toMatchObject({
      reason: "empty",
    });
    await expect(readMemoryFile(new File(["not a zip"], "broken.docx"))).rejects.toMatchObject({
      reason: "unreadable",
    });
  });
});
