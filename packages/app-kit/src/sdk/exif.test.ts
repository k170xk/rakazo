import { describe, expect, it } from "vitest";
import { parseExif } from "./exif.js";

type Tag = { tag: number; type: 2 | 3 | 4 | 5 | 1; values: number[] | string };

/** A little-endian TIFF/EXIF block with IFD0 → Exif IFD and GPS IFD, wrapped in a JPEG APP1. */
function jpegWithExif(root: Tag[], exif: Tag[], gps: Tag[], bigEndian = false): DataView {
  const bytes: number[] = [];
  const little = !bigEndian;
  const u16 = (n: number) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const u32 = (n: number) =>
    little
      ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]
      : [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const size = (tag: Tag) =>
    typeof tag.values === "string"
      ? tag.values.length + 1
      : tag.values.length * (({ 1: 1, 3: 2, 4: 4, 5: 4 } as Record<number, number>)[tag.type] ?? 1);
  const count = (tag: Tag) =>
    typeof tag.values === "string"
      ? tag.values.length + 1
      : tag.type === 5
        ? tag.values.length / 2
        : tag.values.length;
  const encode = (tag: Tag) => {
    if (typeof tag.values === "string")
      return [...tag.values].map((c) => c.charCodeAt(0)).concat(0);
    if (tag.type === 5 || tag.type === 4) return tag.values.flatMap(u32);
    if (tag.type === 3) return tag.values.flatMap(u16);
    return tag.values;
  };
  // Layout: header(8) | IFD0 | Exif IFD | GPS IFD | data
  const ifdSize = (tags: Tag[]) => 2 + tags.length * 12 + 4;
  const rootTags: Tag[] = [
    ...root,
    { tag: 0x8769, type: 4, values: [0] },
    { tag: 0x8825, type: 4, values: [0] },
  ];
  const rootAt = 8;
  const exifAt = rootAt + ifdSize(rootTags);
  const gpsAt = exifAt + ifdSize(exif);
  let dataAt = gpsAt + ifdSize(gps);
  rootTags[rootTags.length - 2]!.values = [exifAt];
  rootTags[rootTags.length - 1]!.values = [gpsAt];
  const data: number[] = [];
  const ifd = (tags: Tag[]) => {
    const out = [...u16(tags.length)];
    for (const tag of tags) {
      const encoded = encode(tag);
      out.push(...u16(tag.tag), ...u16(tag.type), ...u32(count(tag)));
      if (size(tag) <= 4) out.push(...encoded, ...Array(4 - encoded.length).fill(0));
      else {
        out.push(...u32(dataAt));
        data.push(...encoded);
        dataAt += encoded.length;
      }
    }
    return out.concat(u32(0));
  };
  const tiff = [
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(8),
    ...ifd(rootTags),
    ...ifd(exif),
    ...ifd(gps),
    ...data,
  ];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  bytes.push(0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1);
  bytes.push(0xff, 0xda, 0, 2);
  return new DataView(new Uint8Array(bytes).buffer);
}

const dublinGps: Tag[] = [
  { tag: 1, type: 2, values: "N" },
  { tag: 2, type: 5, values: [53, 1, 20, 1, 3030, 100] },
  { tag: 3, type: 2, values: "W" },
  { tag: 4, type: 5, values: [6, 1, 15, 1, 3600, 100] },
  { tag: 5, type: 1, values: [0] },
  { tag: 6, type: 5, values: [125, 10] },
  { tag: 0x11, type: 5, values: [2705, 10] },
];

describe("parseExif", () => {
  it("reads GPS position, altitude, heading and the capture time", () => {
    const view = jpegWithExif(
      [],
      [
        { tag: 0x9003, type: 2, values: "2026:11:13 09:41:07" },
        { tag: 0x9011, type: 2, values: "+00:00" },
      ],
      dublinGps,
    );
    expect(parseExif(view)).toEqual({
      lat: 53.34175,
      lon: -6.26,
      altitude: 12.5,
      heading: 271,
      takenAt: "2026-11-13T09:41:07+00:00",
    });
  });

  it("reads big-endian files too", () => {
    const view = jpegWithExif(
      [],
      [{ tag: 0x9003, type: 2, values: "2025:06:01 12:00:00" }],
      dublinGps,
      true,
    );
    const result = parseExif(view);
    expect(result.lat).toBeCloseTo(53.34174, 4);
    expect(result.lon).toBeCloseTo(-6.26, 4);
    expect(result.takenAt).toBe("2025-06-01T12:00:00");
  });

  it("returns nothing for files without EXIF or with no fix", () => {
    expect(parseExif(new DataView(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer))).toEqual({});
    expect(parseExif(new DataView(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer))).toEqual(
      {},
    );
    const zero = jpegWithExif(
      [],
      [],
      [
        { tag: 1, type: 2, values: "N" },
        { tag: 2, type: 5, values: [0, 1, 0, 1, 0, 1] },
        { tag: 3, type: 2, values: "E" },
        { tag: 4, type: 5, values: [0, 1, 0, 1, 0, 1] },
      ],
    );
    expect(parseExif(zero)).toEqual({});
  });

  it("survives a truncated block", () => {
    const view = jpegWithExif([], [], dublinGps);
    const cut = new DataView(view.buffer.slice(0, 40));
    expect(() => parseExif(cut)).not.toThrow();
  });
});
