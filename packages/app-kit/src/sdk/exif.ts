/**
 * Where and when a photo was taken, read from the EXIF block a phone camera writes into a JPEG.
 * Photos are shrunk through a canvas before they are saved, which drops EXIF, so this runs on the
 * original file first. Only the GPS position, altitude, compass direction and capture time are
 * read; nothing else in the file is looked at.
 */
export type PhotoExif = {
  lat?: number;
  lon?: number;
  /** Metres above sea level. */
  altitude?: number;
  /** Compass direction the camera faced, degrees from north. */
  heading?: number;
  /** ISO date and time from the camera's clock, with its offset when the camera recorded one. */
  takenAt?: string;
};

const SCAN_BYTES = 256 * 1024;

export async function readPhotoExif(file: Blob): Promise<PhotoExif> {
  const buffer = await file.slice(0, SCAN_BYTES).arrayBuffer();
  try {
    return parseExif(new DataView(buffer));
  } catch {
    return {};
  }
}

/** The EXIF facts in the start of a JPEG; empty when it has none. */
export function parseExif(view: DataView): PhotoExif {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return {};
  let at = 2;
  while (at + 4 <= view.byteLength) {
    if (view.getUint8(at) !== 0xff) return {};
    const marker = view.getUint8(at + 1);
    const length = view.getUint16(at + 2);
    if (marker === 0xe1 && at + 10 <= view.byteLength && view.getUint32(at + 4) === 0x45786966) {
      return readTiff(view, at + 10, Math.min(view.byteLength, at + 2 + length));
    }
    if (marker === 0xda || marker === 0xd9) return {};
    at += 2 + length;
  }
  return {};
}

function readTiff(view: DataView, start: number, end: number): PhotoExif {
  const little = view.getUint16(start) === 0x4949;
  const u16 = (offset: number) => view.getUint16(start + offset, little);
  const u32 = (offset: number) => view.getUint32(start + offset, little);
  if (u16(2) !== 42) return {};
  type Entry = { type: number; count: number; valueAt: number };
  const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const ifd = (offset: number): Map<number, Entry> => {
    const entries = new Map<number, Entry>();
    if (offset <= 0 || start + offset + 2 > end) return entries;
    const count = u16(offset);
    for (let i = 0; i < count && i < 512; i++) {
      const base = offset + 2 + i * 12;
      if (start + base + 12 > end) break;
      const type = u16(base + 2);
      const n = u32(base + 4);
      const size = (SIZES[type] ?? 1) * n;
      entries.set(u16(base), { type, count: n, valueAt: size <= 4 ? base + 8 : u32(base + 8) });
    }
    return entries;
  };
  const inside = (entry: Entry, bytes: number) => start + entry.valueAt + bytes <= end;
  const ascii = (entry: Entry | undefined) => {
    if (entry?.type !== 2 || !inside(entry, entry.count)) return undefined;
    let text = "";
    for (let i = 0; i < entry.count; i++) {
      const code = view.getUint8(start + entry.valueAt + i);
      if (!code) break;
      text += String.fromCharCode(code);
    }
    return text.trim() || undefined;
  };
  const rationals = (entry: Entry | undefined): number[] => {
    if (!entry || (entry.type !== 5 && entry.type !== 10) || !inside(entry, entry.count * 8))
      return [];
    const out: number[] = [];
    for (let i = 0; i < entry.count && i < 8; i++) {
      const at = entry.valueAt + i * 8;
      const top = entry.type === 10 ? view.getInt32(start + at, little) : u32(at);
      const bottom = entry.type === 10 ? view.getInt32(start + at + 4, little) : u32(at + 4);
      out.push(bottom ? top / bottom : Number.NaN);
    }
    return out;
  };
  const pointer = (entry: Entry | undefined) =>
    entry && entry.type === 4 ? u32(entry.valueAt) : 0;

  const root = ifd(u32(4));
  const exif = ifd(pointer(root.get(0x8769)));
  const gps = ifd(pointer(root.get(0x8825)));
  const result: PhotoExif = {};

  const degrees = (value: number[], ref: string | undefined, negative: string) => {
    if (value.length < 1 || value.some((part) => !Number.isFinite(part))) return undefined;
    const total = (value[0] ?? 0) + (value[1] ?? 0) / 60 + (value[2] ?? 0) / 3600;
    return ref?.toUpperCase() === negative ? -total : total;
  };
  const lat = degrees(rationals(gps.get(2)), ascii(gps.get(1)), "S");
  const lon = degrees(rationals(gps.get(4)), ascii(gps.get(3)), "W");
  if (
    lat !== undefined &&
    lon !== undefined &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    (lat || lon)
  ) {
    result.lat = Math.round(lat * 1e7) / 1e7;
    result.lon = Math.round(lon * 1e7) / 1e7;
    const altitude = rationals(gps.get(6))[0];
    const below = gps.get(5);
    if (altitude !== undefined && Number.isFinite(altitude)) {
      const sign = below && inside(below, 1) && view.getUint8(start + below.valueAt) === 1 ? -1 : 1;
      result.altitude = Math.round(sign * altitude * 10) / 10;
    }
    const heading = rationals(gps.get(0x11))[0];
    if (heading !== undefined && Number.isFinite(heading))
      result.heading = Math.round(heading) % 360;
  }
  const stamp = ascii(exif.get(0x9003)) ?? ascii(root.get(0x0132));
  const match = stamp && /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(stamp);
  if (match && match[1] !== "0000") {
    const offset = ascii(exif.get(0x9011));
    result.takenAt = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : ""}`;
  }
  return result;
}
