/**
 * A printable report, described rather than drawn: an app lists headings, text, tables, photos and
 * the like, and the host lays them out on OCSC's standard PDF template (the green header banner,
 * the skyline footer and page numbers Evolve's inspection and tender reports use), with real text
 * that can be searched and copied. The same description prints the same way everywhere.
 */

export type PdfTone = "accent" | "neutral" | "success" | "warning" | "danger" | "info";

/** A picture: one the app saved (its asset id), or a PNG/JPEG data URL drawn in the app. */
export type PdfPicture = { asset: string } | { src: string };

export type PdfPhoto = PdfPicture & {
  caption?: string;
  /** Printed under the photo as coordinates, with the time it was taken. */
  lat?: number;
  lon?: number;
  takenAt?: string;
};

export type PdfMapPoint = { lat: number; lon: number; label?: string; tone?: PdfTone };

export type PdfBlock =
  /** A numbered section ("02 / Findings"); numbering is automatic unless number is given. */
  | { type: "heading"; text: string; number?: string; subtitle?: string; newPage?: boolean }
  | { type: "subheading"; text: string }
  /** Paragraphs; blank lines start a new one. **bold** marks a bold run within a line. */
  | { type: "text"; text: string; size?: "small" | "normal" | "large"; muted?: boolean }
  | { type: "bullets"; items: string[]; numbered?: boolean }
  /** Up to four figure tiles in a row, like the front of a tender report. */
  | { type: "stats"; items: Array<{ label: string; value: string | number; tone?: PdfTone }> }
  /** Label and value pairs in two columns: client, job number, inspector, date. */
  | { type: "facts"; items: Array<{ label: string; value: string | number | null }> }
  | {
      type: "table";
      columns: Array<
        string | { label: string; align?: "left" | "right" | "center"; width?: number }
      >;
      rows: Array<Array<string | number | boolean | null>>;
      caption?: string;
      /** Bold last row, for totals. */
      total?: boolean;
    }
  | { type: "photos"; photos: PdfPhoto[]; columns?: 1 | 2 | 3 }
  | (PdfPicture & { type: "image"; caption?: string; width?: "full" | "half" })
  | {
      type: "checklist";
      items: Array<{ label: string; result: "pass" | "fail" | "na" | null; note?: string }>;
    }
  | { type: "callout"; title?: string; text: string; tone?: PdfTone }
  /** Horizontal bars, labelled, scaled to the largest value. */
  | {
      type: "bars";
      title?: string;
      items: Array<{ label: string; value: number; tone?: PdfTone }>;
      format?: "number" | "currency" | "percent";
    }
  /** A map printed from the same free tiles the app shows, with numbered pins, routes and areas. */
  | {
      type: "map";
      points?: PdfMapPoint[];
      lines?: Array<{ points: Array<[number, number]>; tone?: PdfTone }>;
      areas?: Array<{ points: Array<[number, number]>; tone?: PdfTone; label?: string }>;
      style?: "streets" | "satellite" | "terrain";
      caption?: string;
      /** List the numbered pins under the map. Defaults to true. */
      legend?: boolean;
    }
  | {
      type: "signatures";
      items: Array<{ label: string; name?: string; date?: string; signature?: PdfPicture }>;
    }
  | { type: "divider" }
  | { type: "pageBreak" };

export type PdfDocument = {
  title: string;
  subtitle?: string;
  /** Small capitals above the title on the first page, such as "SITE INSPECTION REPORT". */
  kind?: string;
  /** Job number or document reference; printed on the first page and in the footer. */
  reference?: string;
  /** Printed on the first page; today when left out. */
  date?: string;
  /** Who prepared it, printed on the first page. */
  author?: string;
  /** Footer text on every page; "OCSC | <title>" when left out. */
  footer?: string;
  orientation?: "portrait" | "landscape";
  /**
   * The OCSC template is the standard. Only when someone asks for another look: plain drops the
   * banner and footer artwork; accent replaces the brand green (a #rrggbb colour).
   */
  template?: { plain?: boolean; accent?: string };
  blocks: PdfBlock[];
};

export const PDF_LIMITS = {
  blocks: 3000,
  text: 40_000,
  tableRows: 10_000,
  cells: 60,
  cell: 4000,
  pictures: 400,
  mapPoints: 2000,
  /** The whole description as JSON, pictures drawn in the app included. */
  bytes: 12_000_000,
} as const;

const TONES = new Set<PdfTone>(["accent", "neutral", "success", "warning", "danger", "info"]);
const ASSET_ID = /^[A-Za-z0-9_-]{8,64}$/;
const DATA_URL = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

class PdfError extends Error {}

const str = (value: unknown, max: number = PDF_LIMITS.text): string =>
  value === null || value === undefined ? "" : String(value).slice(0, max);
const optional = (value: unknown, max = 400): string | undefined =>
  value === null || value === undefined || value === "" ? undefined : str(value, max);
const tone = (value: unknown): PdfTone | undefined =>
  TONES.has(value as PdfTone) ? (value as PdfTone) : undefined;
const list = (value: unknown, max: number): unknown[] =>
  Array.isArray(value) ? value.slice(0, max) : [];
const num = (value: unknown): number | undefined => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};
const coord = (value: unknown, limit: number) => {
  const n = num(value);
  return n !== undefined && Math.abs(n) <= limit ? n : undefined;
};

function picture(value: unknown, count: { pictures: number }): PdfPicture | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (++count.pictures > PDF_LIMITS.pictures)
    throw new PdfError("A report can hold up to 400 pictures.");
  if (typeof item.asset === "string" && ASSET_ID.test(item.asset)) return { asset: item.asset };
  if (typeof item.src === "string" && DATA_URL.test(item.src)) return { src: item.src };
  if (typeof item.src === "string" && ASSET_ID.test(item.src)) return { asset: item.src };
  return null;
}

function pair(value: unknown): [number, number] | null {
  if (!Array.isArray(value)) return null;
  const lat = coord(value[0], 90);
  const lon = coord(value[1], 180);
  return lat === undefined || lon === undefined ? null : [lat, lon];
}

function block(value: unknown, count: { pictures: number }): PdfBlock | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  switch (item.type) {
    case "heading":
      return {
        type: "heading",
        text: str(item.text, 300),
        ...(optional(item.number, 12) ? { number: optional(item.number, 12) } : {}),
        ...(optional(item.subtitle) ? { subtitle: optional(item.subtitle) } : {}),
        ...(item.newPage === true ? { newPage: true } : {}),
      };
    case "subheading":
      return { type: "subheading", text: str(item.text, 300) };
    case "text":
      return {
        type: "text",
        text: str(item.text),
        ...(item.size === "small" || item.size === "large" ? { size: item.size } : {}),
        ...(item.muted === true ? { muted: true } : {}),
      };
    case "bullets":
      return {
        type: "bullets",
        items: list(item.items, 500).map((entry) => str(entry, 4000)),
        ...(item.numbered === true ? { numbered: true } : {}),
      };
    case "stats":
      return {
        type: "stats",
        items: list(item.items, 8).map((entry) => {
          const stat = (entry ?? {}) as Record<string, unknown>;
          return {
            label: str(stat.label, 60),
            value: typeof stat.value === "number" ? stat.value : str(stat.value, 60),
            ...(tone(stat.tone) ? { tone: tone(stat.tone) } : {}),
          };
        }),
      };
    case "facts":
      return {
        type: "facts",
        items: list(item.items, 60).map((entry) => {
          const fact = (entry ?? {}) as Record<string, unknown>;
          return {
            label: str(fact.label, 80),
            value: fact.value === null || fact.value === undefined ? null : str(fact.value, 1000),
          };
        }),
      };
    case "table": {
      const columns = list(item.columns, PDF_LIMITS.cells).map((column) => {
        if (typeof column === "string" || typeof column === "number") return str(column, 200);
        const c = (column ?? {}) as Record<string, unknown>;
        const align: "right" | "center" | undefined =
          c.align === "right" || c.align === "center" ? c.align : undefined;
        const width = num(c.width);
        return {
          label: str(c.label, 200),
          ...(align ? { align } : {}),
          ...(width && width > 0 && width <= 200 ? { width } : {}),
        };
      });
      const rows = list(item.rows, PDF_LIMITS.tableRows).map((row) =>
        list(row, PDF_LIMITS.cells).map((cell) =>
          cell === null || cell === undefined
            ? null
            : typeof cell === "number" || typeof cell === "boolean"
              ? cell
              : str(cell, PDF_LIMITS.cell),
        ),
      );
      return {
        type: "table",
        columns,
        rows: rows as Array<Array<string | number | boolean | null>>,
        ...(optional(item.caption) ? { caption: optional(item.caption) } : {}),
        ...(item.total === true ? { total: true } : {}),
      };
    }
    case "photos": {
      const photos: PdfPhoto[] = [];
      for (const entry of list(item.photos, PDF_LIMITS.pictures)) {
        const pic = picture(entry, count);
        if (!pic) continue;
        const photo = entry as Record<string, unknown>;
        const lat = coord(photo.lat, 90);
        const lon = coord(photo.lon, 180);
        photos.push({
          ...pic,
          ...(optional(photo.caption, 600) ? { caption: optional(photo.caption, 600) } : {}),
          ...(lat !== undefined && lon !== undefined ? { lat, lon } : {}),
          ...(optional(photo.takenAt, 40) ? { takenAt: optional(photo.takenAt, 40) } : {}),
        });
      }
      const columns = item.columns === 1 || item.columns === 3 ? item.columns : 2;
      return { type: "photos", photos, columns };
    }
    case "image": {
      const pic = picture(item, count);
      if (!pic) return null;
      return {
        type: "image",
        ...pic,
        ...(optional(item.caption, 600) ? { caption: optional(item.caption, 600) } : {}),
        ...(item.width === "half" ? { width: "half" as const } : {}),
      };
    }
    case "checklist":
      return {
        type: "checklist",
        items: list(item.items, 1000).map((entry) => {
          const check = (entry ?? {}) as Record<string, unknown>;
          const result =
            check.result === "pass" || check.result === "fail" || check.result === "na"
              ? check.result
              : null;
          return {
            label: str(check.label, 600),
            result,
            ...(optional(check.note, 2000) ? { note: optional(check.note, 2000) } : {}),
          };
        }),
      };
    case "callout":
      return {
        type: "callout",
        text: str(item.text, 8000),
        ...(optional(item.title, 200) ? { title: optional(item.title, 200) } : {}),
        ...(tone(item.tone) ? { tone: tone(item.tone) } : {}),
      };
    case "bars":
      return {
        type: "bars",
        items: list(item.items, 60).map((entry) => {
          const bar = (entry ?? {}) as Record<string, unknown>;
          return {
            label: str(bar.label, 120),
            value: num(bar.value) ?? 0,
            ...(tone(bar.tone) ? { tone: tone(bar.tone) } : {}),
          };
        }),
        ...(optional(item.title, 200) ? { title: optional(item.title, 200) } : {}),
        ...(item.format === "currency" || item.format === "percent" ? { format: item.format } : {}),
      };
    case "map": {
      const points = list(item.points, PDF_LIMITS.mapPoints).flatMap((entry) => {
        const p = (entry ?? {}) as Record<string, unknown>;
        const lat = coord(p.lat, 90);
        const lon = coord(p.lon, 180);
        if (lat === undefined || lon === undefined) return [];
        return [
          {
            lat,
            lon,
            ...(optional(p.label, 200) ? { label: optional(p.label, 200) } : {}),
            ...(tone(p.tone) ? { tone: tone(p.tone) } : {}),
          },
        ];
      });
      const shape = (entry: unknown) => {
        const s = (entry ?? {}) as Record<string, unknown>;
        return {
          points: list(s.points, PDF_LIMITS.mapPoints).flatMap((p) => {
            const at = pair(p);
            return at ? [at] : [];
          }),
          ...(tone(s.tone) ? { tone: tone(s.tone) } : {}),
          ...(optional(s.label, 120) ? { label: optional(s.label, 120) } : {}),
        };
      };
      const lines = list(item.lines, 50)
        .map(shape)
        .filter((line) => line.points.length > 1);
      const areas = list(item.areas, 50)
        .map(shape)
        .filter((area) => area.points.length > 2);
      if (!points.length && !lines.length && !areas.length) return null;
      return {
        type: "map",
        ...(points.length ? { points } : {}),
        ...(lines.length ? { lines } : {}),
        ...(areas.length ? { areas } : {}),
        style: item.style === "satellite" || item.style === "terrain" ? item.style : "streets",
        ...(optional(item.caption, 600) ? { caption: optional(item.caption, 600) } : {}),
        ...(item.legend === false ? { legend: false } : {}),
      };
    }
    case "signatures":
      return {
        type: "signatures",
        items: list(item.items, 6).map((entry) => {
          const sign = (entry ?? {}) as Record<string, unknown>;
          const pic = sign.signature ? picture(sign.signature, count) : null;
          return {
            label: str(sign.label, 80),
            ...(optional(sign.name, 120) ? { name: optional(sign.name, 120) } : {}),
            ...(optional(sign.date, 40) ? { date: optional(sign.date, 40) } : {}),
            ...(pic ? { signature: pic } : {}),
          };
        }),
      };
    case "divider":
      return { type: "divider" };
    case "pageBreak":
      return { type: "pageBreak" };
    default:
      return null;
  }
}

/** A report from an app made safe to print, or an error saying what is wrong with it. */
export function readPdfDocument(value: unknown): PdfDocument {
  if (!value || typeof value !== "object") throw new PdfError("A report needs a title and blocks.");
  const doc = value as Record<string, unknown>;
  const title = str(doc.title, 300).trim();
  if (!title) throw new PdfError("A report needs a title.");
  if (!Array.isArray(doc.blocks)) throw new PdfError("A report needs a list of blocks.");
  if (doc.blocks.length > PDF_LIMITS.blocks) throw new PdfError("That report has too many blocks.");
  const count = { pictures: 0 };
  const blocks = doc.blocks.flatMap((item) => {
    const clean = block(item, count);
    return clean ? [clean] : [];
  });
  const template = (doc.template ?? {}) as Record<string, unknown>;
  const accent =
    typeof template.accent === "string" && HEX.test(template.accent) ? template.accent : undefined;
  return {
    title,
    blocks,
    ...(optional(doc.subtitle) ? { subtitle: optional(doc.subtitle) } : {}),
    ...(optional(doc.kind, 80) ? { kind: optional(doc.kind, 80) } : {}),
    ...(optional(doc.reference, 120) ? { reference: optional(doc.reference, 120) } : {}),
    ...(optional(doc.date, 60) ? { date: optional(doc.date, 60) } : {}),
    ...(optional(doc.author, 120) ? { author: optional(doc.author, 120) } : {}),
    ...(optional(doc.footer, 160) ? { footer: optional(doc.footer, 160) } : {}),
    ...(doc.orientation === "landscape" ? { orientation: "landscape" as const } : {}),
    ...(template.plain === true || accent
      ? {
          template: {
            ...(template.plain === true ? { plain: true } : {}),
            ...(accent ? { accent } : {}),
          },
        }
      : {}),
  };
}

/** The asset ids a report prints, so the host can fetch each once. */
export function pdfAssets(doc: PdfDocument): string[] {
  const ids = new Set<string>();
  const add = (pic: PdfPicture | undefined) => {
    if (pic && "asset" in pic) ids.add(pic.asset);
  };
  for (const item of doc.blocks) {
    if (item.type === "photos") item.photos.forEach(add);
    else if (item.type === "image") add(item);
    else if (item.type === "signatures") for (const sign of item.items) add(sign.signature);
  }
  return [...ids];
}

/** A safe file name for a report: its title, ending .pdf. */
export function pdfFilename(name: string | undefined, title: string): string {
  const base = (name || title)
    .replace(/\.pdf$/i, "")
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .trim();
  return `${base.slice(0, 100) || "Report"}.pdf`;
}
