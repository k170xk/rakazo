/** File types a memory note can be made from, for the file picker. */
export const MEMORY_IMPORT_ACCEPT =
  ".txt,.md,.markdown,.docx,.pdf,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export class MemoryImportError extends Error {
  constructor(readonly reason: "legacy-doc" | "unsupported" | "empty" | "unreadable") {
    super(reason);
  }
}

/** Reads an uploaded file as plain text a bot can use, keeping headings and bullets. */
export async function readMemoryFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  let text: string;
  if (name.endsWith(".doc")) throw new MemoryImportError("legacy-doc");
  if (name.endsWith(".docx")) {
    text = await readDocx(await file.arrayBuffer()).catch(() => {
      throw new MemoryImportError("unreadable");
    });
  } else if (name.endsWith(".pdf")) {
    text = await readPdf(await file.arrayBuffer()).catch(() => {
      throw new MemoryImportError("unreadable");
    });
  } else if (/\.(txt|md|markdown)$/.test(name) || file.type.startsWith("text/")) {
    text = await file.text();
  } else {
    throw new MemoryImportError("unsupported");
  }
  const tidy = tidyText(text);
  if (!tidy) throw new MemoryImportError("empty");
  return tidy;
}

function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Word's text, one paragraph per line, with headings as # and list items as -. */
export async function readDocx(bytes: ArrayBuffer): Promise<string> {
  const xml = await unzipEntry(bytes, "word/document.xml");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Invalid document");
  const lines: string[] = [];
  for (const paragraph of Array.from(doc.getElementsByTagNameNS(WORD_NS, "p"))) {
    let text = "";
    for (const node of Array.from(paragraph.getElementsByTagNameNS(WORD_NS, "*"))) {
      if (node.localName === "t") text += node.textContent ?? "";
      else if (node.localName === "tab") text += "\t";
      else if (node.localName === "br" || node.localName === "cr") text += "\n";
    }
    const style =
      paragraph
        .getElementsByTagNameNS(WORD_NS, "pStyle")[0]
        ?.getAttributeNS(WORD_NS, "val")
        ?.toLowerCase() ?? "";
    const heading = /^heading([1-6])$/.exec(style) ?? (style === "title" ? ["title", "1"] : null);
    const listed = paragraph.getElementsByTagNameNS(WORD_NS, "numPr").length > 0;
    if (text.trim() && heading) lines.push(`${"#".repeat(Number(heading[1]))} ${text.trim()}`);
    else if (text.trim() && listed) lines.push(`- ${text.trim()}`);
    else lines.push(text);
  }
  return lines.join("\n");
}

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** One file from a zip, through the browser's own inflate so no zip library ships. */
async function unzipEntry(bytes: ArrayBuffer, wanted: string): Promise<string> {
  const view = new DataView(bytes);
  let end = -1;
  for (let at = bytes.byteLength - 22; at >= Math.max(0, bytes.byteLength - 65_557); at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error("Not a zip file");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("Broken zip directory");
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localHeader = view.getUint32(at + 42, true);
    const name = decoder.decode(new Uint8Array(bytes, at + 46, nameLength));
    if (name === wanted) {
      const dataStart =
        localHeader +
        30 +
        view.getUint16(localHeader + 26, true) +
        view.getUint16(localHeader + 28, true);
      const data = new Uint8Array(bytes, dataStart, compressedSize);
      if (method === 0) return decoder.decode(data);
      if (method !== 8) throw new Error("Unsupported zip compression");
      const stream = new Response(data).body?.pipeThrough(new DecompressionStream("deflate-raw"));
      return await new Response(stream).text();
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`${wanted} missing`);
}

async function readPdf(bytes: ArrayBuffer): Promise<string> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: bytes });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const content = await (await pdf.getPage(number)).getTextContent();
      let page = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        page += item.str + (item.hasEOL ? "\n" : "");
      }
      pages.push(page);
    }
    return pages.join("\n\n");
  } finally {
    void task.destroy();
  }
}
