import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isMppBinary, mppBytesToMsProjectXml } from "./mpp-convert.js";

const FIXTURES = [
  "/Users/keith/Downloads/07 Criterion A3 - Mountjoy Square - Project Programme.mpp",
  "/Users/keith/Downloads/Charleville - Tender Programme - JWB.mpp",
  "/Users/keith/Downloads/Criterion B Ballyraggett Weir Programme.mpp",
  "/Users/keith/Downloads/04 Criterion A - Programme FINAL.mpp",
] as const;

describe("mpp convert", () => {
  it("detects OLE compound-document magic", () => {
    expect(isMppBinary(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe(true);
    expect(isMppBinary(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
  });

  it.each(FIXTURES)("converts %s to MSPDI with tasks and predecessors", async (path) => {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(path));
    } catch {
      return;
    }
    expect(isMppBinary(bytes)).toBe(true);
    const xml = await mppBytesToMsProjectXml(bytes);
    expect(xml).toMatch(/<Project[\s>]/);
    expect(xml.match(/<Task>/g)?.length ?? 0).toBeGreaterThan(10);
    expect(xml).toMatch(/<PredecessorLink>/);
    expect(xml).toMatch(/<Start>/);
    expect(xml).toMatch(/<Finish>/);
  }, 60_000);
});
