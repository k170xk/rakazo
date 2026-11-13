import type { PdfBlock, PdfTone } from "@rakazo/app-kit/pdf";
import { pdfAssets, pdfFilename, readPdfDocument } from "@rakazo/app-kit/pdf";
import { APP_MAPS_PATH, MAP_STYLES } from "@rakazo/app-kit/protocol";

/**
 * Prints an app's report: checks the description, fetches its pictures as the viewer, draws its
 * maps from the same tiles the app shows, and lays it out on OCSC's PDF template.
 */

const ARTWORK = { header: "/brand/pdf/ocsc-header.jpg", footer: "/brand/pdf/ocsc-footer.png" };
/** Pictures are printed at most this many pixels on their longer side; enough for A4 at 200 dpi. */
const MAX_SIDE = 1800;
const TILE = 256;
const MAP_W = 1600;
const MAP_H = 800;

const TONE: Record<PdfTone, string> = {
  accent: "#77bf43",
  neutral: "#6B7280",
  success: "#77bf43",
  warning: "#F59E0B",
  danger: "#EF4444",
  info: "#3B82F6",
};

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("A picture couldn't be read."));
    reader.readAsDataURL(blob);
  });
}

async function fetchDataUrl(url: string): Promise<string | undefined> {
  const response = await fetch(url, { credentials: "same-origin" }).catch(() => null);
  if (!response?.ok) return undefined;
  return readBlob(await response.blob());
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A picture couldn't be drawn."));
    image.src = src;
  });
}

/** A picture as JPEG, or PNG when it may be see-through (signatures), no larger than needed. */
async function printablePicture(src: string): Promise<string | undefined> {
  const image = await loadImage(src).catch(() => null);
  if (!image?.naturalWidth) return undefined;
  const png = src.startsWith("data:image/png");
  const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  if (scale === 1 && (png || src.startsWith("data:image/jpeg"))) return src;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  if (!png) {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(png ? "image/png" : "image/jpeg", 0.86);
}

function project(lat: number, lon: number, zoom: number) {
  const scale = TILE * 2 ** zoom;
  const sin = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/** A map block drawn to a picture: tiles, then areas, routes and numbered pins over them. */
async function drawMap(block: Extract<PdfBlock, { type: "map" }>): Promise<string | undefined> {
  const style = MAP_STYLES[block.style ?? "streets"] ? (block.style ?? "streets") : "streets";
  const all: Array<[number, number]> = [
    ...(block.points ?? []).map((point) => [point.lat, point.lon] as [number, number]),
    ...(block.lines ?? []).flatMap((line) => line.points),
    ...(block.areas ?? []).flatMap((area) => area.points),
  ];
  if (!all.length) return undefined;
  const maxZoom = Math.min(18, MAP_STYLES[style].maxZoom);
  let zoom = maxZoom;
  for (; zoom > 2; zoom--) {
    const projected = all.map(([lat, lon]) => project(lat, lon, zoom));
    const spanX = Math.max(...projected.map((p) => p.x)) - Math.min(...projected.map((p) => p.x));
    const spanY = Math.max(...projected.map((p) => p.y)) - Math.min(...projected.map((p) => p.y));
    if (spanX <= MAP_W - 200 && spanY <= MAP_H - 200) break;
  }
  if (all.length === 1) zoom = Math.min(zoom, 17);
  const projected = all.map(([lat, lon]) => project(lat, lon, zoom));
  const centre = {
    x: (Math.max(...projected.map((p) => p.x)) + Math.min(...projected.map((p) => p.x))) / 2,
    y: (Math.max(...projected.map((p) => p.y)) + Math.min(...projected.map((p) => p.y))) / 2,
  };
  const left = centre.x - MAP_W / 2;
  const topEdge = centre.y - MAP_H / 2;
  const canvas = document.createElement("canvas");
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.fillStyle = "#e5e7eb";
  context.fillRect(0, 0, MAP_W, MAP_H);
  const count = 2 ** zoom;
  const tiles: Array<Promise<void>> = [];
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + MAP_W) / TILE); tx++) {
    for (let ty = Math.floor(topEdge / TILE); ty <= Math.floor((topEdge + MAP_H) / TILE); ty++) {
      if (ty < 0 || ty >= count) continue;
      const wrapped = ((tx % count) + count) % count;
      tiles.push(
        fetchDataUrl(`${APP_MAPS_PATH}/tile/${style}/${zoom}/${wrapped}/${ty}`)
          .then((url) => (url ? loadImage(url) : null))
          .then((image) => {
            if (image) context.drawImage(image, tx * TILE - left, ty * TILE - topEdge, TILE, TILE);
          })
          .catch(() => undefined),
      );
    }
  }
  await Promise.all(tiles);
  const at = ([lat, lon]: [number, number]) => {
    const p = project(lat, lon, zoom);
    return [p.x - left, p.y - topEdge] as const;
  };
  for (const area of block.areas ?? []) {
    context.beginPath();
    area.points.forEach((point, i) => {
      const [x, y] = at(point);
      if (i === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.fillStyle = `${TONE[area.tone ?? "accent"]}40`;
    context.fill();
    context.lineWidth = 4;
    context.strokeStyle = TONE[area.tone ?? "accent"];
    context.stroke();
  }
  for (const line of block.lines ?? []) {
    context.beginPath();
    line.points.forEach((point, i) => {
      const [x, y] = at(point);
      if (i === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.lineWidth = 7;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.strokeStyle = "#ffffff";
    context.stroke();
    context.lineWidth = 4;
    context.strokeStyle = TONE[line.tone ?? "info"];
    context.stroke();
  }
  (block.points ?? []).forEach((point, i) => {
    const [x, y] = at([point.lat, point.lon]);
    context.beginPath();
    context.arc(x, y, 17, 0, Math.PI * 2);
    context.fillStyle = TONE[point.tone ?? "accent"];
    context.fill();
    context.lineWidth = 4;
    context.strokeStyle = "#ffffff";
    context.stroke();
    context.fillStyle = "#ffffff";
    context.font = "bold 17px Helvetica, Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(i + 1), x, y + 1);
  });
  const credit = MAP_STYLES[style].attribution;
  context.font = "15px Helvetica, Arial, sans-serif";
  const creditWidth = context.measureText(credit).width;
  context.fillStyle = "rgba(255,255,255,0.85)";
  context.fillRect(MAP_W - creditWidth - 16, MAP_H - 26, creditWidth + 16, 26);
  context.fillStyle = "#374151";
  context.textAlign = "right";
  context.textBaseline = "middle";
  context.fillText(credit, MAP_W - 8, MAP_H - 13);
  return canvas.toDataURL("image/jpeg", 0.88);
}

export async function buildAppPdf({
  document: raw,
  filename,
  asset,
  maps,
}: {
  document: unknown;
  filename: unknown;
  asset: (id: string) => Promise<{ mime: string; base64: string }>;
  maps: boolean;
}): Promise<{ filename: string; base64: string }> {
  const doc = readPdfDocument(raw);
  const pictures = new Map<string, string>();
  const plain = doc.template?.plain === true;
  const [render, header, footer] = await Promise.all([
    import("@rakazo/app-kit/pdf/render"),
    plain ? undefined : fetchDataUrl(ARTWORK.header),
    plain ? undefined : fetchDataUrl(ARTWORK.footer),
    Promise.all(
      pdfAssets(doc).map(async (id) => {
        const file = await asset(id).catch(() => null);
        if (!file) return;
        const picture = await printablePicture(`data:${file.mime};base64,${file.base64}`);
        if (picture) pictures.set(id, picture);
      }),
    ),
    Promise.all(
      doc.blocks.flatMap((block) => {
        const sources =
          block.type === "photos"
            ? block.photos
            : block.type === "image"
              ? [block]
              : block.type === "signatures"
                ? block.items.flatMap((item) => (item.signature ? [item.signature] : []))
                : [];
        return sources.flatMap((source) =>
          "src" in source && !pictures.has(source.src)
            ? [
                printablePicture(source.src).then((picture) => {
                  if (picture) pictures.set(source.src, picture);
                }),
              ]
            : [],
        );
      }),
    ),
  ]);
  const mapImages = new Map<number, string>();
  if (maps) {
    await Promise.all(
      doc.blocks.map(async (block, index) => {
        if (block.type !== "map") return;
        const image = await drawMap(block).catch(() => undefined);
        if (image) mapImages.set(index, image);
      }),
    );
  }
  const bytes = render.renderPdf(doc, { header, footer, pictures, maps: mapImages });
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return {
    filename: pdfFilename(typeof filename === "string" ? filename : undefined, doc.title),
    base64: btoa(binary),
  };
}
