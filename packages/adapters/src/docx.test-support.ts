import { deflateRawSync } from "node:zlib";

/** A deflated zip of the given text files, enough for the readers here. */
export function zipOf(files: Record<string, string>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const raw = Buffer.from(text);
    const packed = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const BOXED_PARAGRAPH =
  '<w:p><w:r><w:t>Lead</w:t></w:r><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent><w:p><w:r><w:t>Box</w:t></w:r></w:p></w:txbxContent></wps:txbx></w:drawing></mc:Choice></mc:AlternateContent></w:r><w:r><w:t>tail</w:t></w:r></w:p>';

/** The same paragraph after an edit dropped the run that opened the text box. */
const BOX_OPENING_DROPPED =
  "<w:p><w:r><w:t>Lead changed</w:t></w:r><w:r><w:t>Box</w:t></w:r></w:p></w:txbxContent></wps:txbx></w:drawing></mc:Choice></mc:AlternateContent></w:r><w:r><w:t>tail</w:t></w:r></w:p>";

export const documentXml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`;

export const BOXED_DOCUMENT_XML = documentXml(BOXED_PARAGRAPH);
export const DAMAGED_DOCUMENT_XML = documentXml(BOX_OPENING_DROPPED);

export const soundDocx = () => zipOf({ "word/document.xml": BOXED_DOCUMENT_XML });
export const damagedDocx = () => zipOf({ "word/document.xml": DAMAGED_DOCUMENT_XML });
