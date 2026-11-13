import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { importWorkbook, zipUnpackedSize } from "./workbook.js";

function xlsx(): Uint8Array {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Job", "Name"],
    ["J1", "Quay bridge"],
    ["J2", "Mill road"],
  ]);
  XLSX.utils.book_append_sheet(book, sheet, "Jobs");
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

/** The same file with its first central directory entry claiming `size` unpacked bytes. */
function claiming(bytes: Uint8Array, size: number): Uint8Array {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer);
  for (let at = copy.length - 22; at >= 0; at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      view.setUint32(view.getUint32(at + 16, true) + 24, size, true);
      return copy;
    }
  }
  throw new Error("no central directory");
}

describe("workbook unpacked size", () => {
  it("imports an ordinary workbook and csv", () => {
    const bytes = xlsx();
    expect(zipUnpackedSize(bytes)).toBeGreaterThan(0);
    expect(importWorkbook(bytes).tables).toHaveLength(1);
    expect(
      importWorkbook(new TextEncoder().encode("Job,Name\nJ1,Quay bridge\n")).tables,
    ).toHaveLength(1);
  });

  it("refuses a zip that unpacks past the limit before inflating it", () => {
    expect(() => importWorkbook(claiming(xlsx(), 0x7fff_ffff))).toThrow(
      /unpacks to more than 200 MB/,
    );
  });

  it("refuses a damaged or zip64 workbook", () => {
    const bytes = xlsx();
    expect(() => importWorkbook(bytes.slice(0, bytes.length - 30))).toThrow(/could not be read/);
    expect(zipUnpackedSize(claiming(bytes, 0xffff_ffff))).toBeNull();
  });
});
