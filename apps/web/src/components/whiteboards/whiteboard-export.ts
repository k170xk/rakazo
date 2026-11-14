import { printable } from "@rakazo/app-kit/pdf/render";
import type { BoardColor, BoardItem } from "@rakazo/app-kit/ui";
import { readBoard } from "@rakazo/app-kit/ui";
import { computeBoardArrows } from "@rakazo/contracts";

const FILL: Record<BoardColor, string> = {
  yellow: "#FEF3A0",
  green: "#C9EBB2",
  blue: "#BFDDF8",
  pink: "#F8C8DC",
  orange: "#FDD5AE",
  purple: "#DCCDF6",
  grey: "#E5E7EB",
  ink: "#1F2937",
};

const INK: Record<BoardColor, string> = {
  yellow: "#CA8A04",
  green: "#4D9A2A",
  blue: "#2563EB",
  pink: "#DB2777",
  orange: "#EA580C",
  purple: "#7C3AED",
  grey: "#6B7280",
  ink: "#1E293B",
};

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const n = Number.parseInt(clean.length === 3 ? clean.replace(/(.)/g, "$1$1") : clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function blendWithWhite(hex: string, alpha: number): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return [
    Math.round(r * alpha + 255 * (1 - alpha)),
    Math.round(g * alpha + 255 * (1 - alpha)),
    Math.round(b * alpha + 255 * (1 - alpha)),
  ];
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function rasterizeForPdf(
  src: string,
): Promise<{ dataUrl: string; format: "PNG" | "JPEG" } | null> {
  const img = await loadImage(src);
  if (!img) return null;
  const w = Math.max(1, img.naturalWidth || img.width || 640);
  const h = Math.max(1, img.naturalHeight || img.height || 360);
  const scale = Math.min(2, 1800 / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL("image/png"), format: "PNG" };
}

export function boardBoundsWithArrows(items: readonly BoardItem[]) {
  const routed = computeBoardArrows(items);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    if (item.kind === "arrow") continue;
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + item.w);
    maxY = Math.max(maxY, item.y + item.h);
  }
  for (const r of routed.values()) {
    for (const pt of r.points) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }
    if (r.label) {
      minX = Math.min(minX, r.label.x);
      minY = Math.min(minY, r.label.y);
      maxX = Math.max(maxX, r.label.x + r.label.w);
      maxY = Math.max(maxY, r.label.y + r.label.h);
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 640, h: 360 };
  return { x: minX, y: minY, w: Math.max(120, maxX - minX), h: Math.max(120, maxY - minY) };
}

export async function exportWhiteboardPdf({
  title,
  code,
  resolveAsset,
}: {
  title: string;
  code: string;
  resolveAsset?: (assetId: string) => Promise<string | null>;
}): Promise<ArrayBuffer> {
  const { jsPDF } = await import("jspdf");
  const items = readBoard(code).items;
  const bounds = boardBoundsWithArrows(items);
  const routedMap = computeBoardArrows(items);

  const landscape = bounds.w >= bounds.h * 0.9;
  const doc = new jsPDF({
    unit: "mm",
    format: "a3",
    orientation: landscape ? "l" : "p",
    compress: true,
  });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const headerH = 14;
  const footerH = 8;

  // Crisp header bar
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageW, pageH, "F");
  doc.setFillColor(118, 191, 67);
  doc.rect(margin, margin, 3.5, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(30, 41, 59);
  doc.text(printable(title || "Whiteboard"), margin + 6.5, margin + 5.8);

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(margin, margin + 10.5, pageW - margin, margin + 10.5);

  const canvasTop = margin + headerH;
  const availW = pageW - margin * 2;
  const availH = pageH - canvasTop - margin - footerH;
  const pad = 28;
  const totalW = bounds.w + pad * 2;
  const totalH = bounds.h + pad * 2;
  const scale = Math.min(availW / totalW, availH / totalH);
  const offsetX = margin + (availW - totalW * scale) / 2 + (pad - bounds.x) * scale;
  const offsetY = canvasTop + (availH - totalH * scale) / 2 + (pad - bounds.y) * scale;

  const tx = (x: number) => offsetX + x * scale;
  const ty = (y: number) => offsetY + y * scale;
  const tw = (w: number) => w * scale;
  const mmToPt = (mm: number) => mm / 0.352778;

  // Preload any image assets
  const imageMap = new Map<string, { dataUrl: string; format: "PNG" | "JPEG" }>();
  if (resolveAsset) {
    await Promise.all(
      items
        .filter((i) => i.kind === "image" && i.asset)
        .map(async (item) => {
          const url = await resolveAsset(item.asset!).catch(() => null);
          if (!url) return;
          const raster = await rasterizeForPdf(url);
          if (raster) imageMap.set(item.id, raster);
        }),
    );
  }

  const ordered = [...items].sort((a, b) =>
    a.kind === b.kind ? 0 : a.kind === "section" ? -1 : b.kind === "section" ? 1 : 0,
  );

  const drawWrappedText = (
    rawText: string,
    xMm: number,
    yMm: number,
    wMm: number,
    hMm: number,
    opts: { align: "center" | "left"; fontPx: number; bold?: boolean; colorHex: string },
  ) => {
    const clean = printable(rawText).trim();
    if (!clean || wMm <= 2 || hMm <= 2) return;
    const fontPt = Math.max(5.5, Math.min(18, mmToPt(opts.fontPx * scale)));
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(fontPt);
    const [r, g, b] = hexToRgb(opts.colorHex);
    doc.setTextColor(r, g, b);
    const lines = doc.splitTextToSize(clean, Math.max(4, wMm)) as string[];
    const lineH = fontPt * 0.352778 * 1.28;
    const maxLines = Math.max(1, Math.floor(hMm / lineH));
    const clipped = lines.slice(0, maxLines);
    const blockH = clipped.length * lineH;
    let curY =
      opts.align === "center"
        ? yMm + (hMm - blockH) / 2 + fontPt * 0.352778 * 0.82
        : yMm + fontPt * 0.352778 * 0.95;
    for (const line of clipped) {
      doc.text(line, opts.align === "center" ? xMm + wMm / 2 : xMm, curY, {
        align: opts.align,
      });
      curY += lineH;
    }
  };

  // Pass 1: Sections & Shapes
  for (const item of ordered) {
    if (item.kind === "arrow") continue;
    const colorName =
      item.color ??
      (item.kind === "diamond"
        ? "orange"
        : item.kind === "cylinder"
          ? "blue"
          : item.kind === "cloud"
            ? "green"
            : item.kind === "queue"
              ? "purple"
              : item.kind === "sticky"
                ? "yellow"
                : "grey");
    const inkHex = INK[item.color ?? "ink"];
    const [ir, ig, ib] = hexToRgb(inkHex);
    const fillRgb =
      item.color === "ink"
        ? ([255, 255, 255] as [number, number, number])
        : blendWithWhite(
            FILL[colorName],
            item.kind === "section" ? 0.24 : item.kind === "sticky" ? 1 : 0.72,
          );

    const x = tx(item.x);
    const y = ty(item.y);
    const w = tw(item.w);
    const h = tw(item.h);

    doc.setDrawColor(ir, ig, ib);
    doc.setFillColor(fillRgb[0], fillRgb[1], fillRgb[2]);
    doc.setLineWidth(Math.max(0.25, tw(2)));

    if (item.kind === "section") {
      doc.roundedRect(x, y, w, h, tw(16), tw(16), "FD");
      const [lr, lg, lb] = blendWithWhite(inkHex, 0.25);
      doc.setDrawColor(lr, lg, lb);
      doc.setLineWidth(0.25);
      doc.line(x + tw(16), y + tw(48), x + w - tw(16), y + tw(48));
      if (item.text) {
        drawWrappedText(item.text, x + tw(16), y + tw(10), w - tw(32), tw(34), {
          align: "left",
          fontPx: 14,
          bold: true,
          colorHex: inkHex,
        });
      }
      continue;
    }

    if (item.kind === "pen") {
      const pts = item.points ?? [];
      if (pts.length >= 2) {
        doc.setLineWidth(Math.max(0.35, tw(2.8)));
        for (let i = 0; i < pts.length - 1; i++) {
          doc.line(
            tx(item.x + pts[i]![0]),
            ty(item.y + pts[i]![1]),
            tx(item.x + pts[i + 1]![0]),
            ty(item.y + pts[i + 1]![1]),
          );
        }
      }
      continue;
    }

    if (item.kind === "image") {
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.35);
      doc.roundedRect(x, y, w, h, tw(10), tw(10), "FD");
      const hasCap = Boolean((item.text ?? "").trim());
      const imgH = hasCap ? Math.max(tw(36), h - tw(30)) : h;
      const raster = imageMap.get(item.id);
      if (raster) {
        doc.addImage(
          raster.dataUrl,
          raster.format,
          x + tw(4),
          y + tw(4),
          Math.max(1, w - tw(8)),
          Math.max(1, imgH - tw(8)),
          undefined,
          "FAST",
        );
      }
      if (hasCap && item.text) {
        drawWrappedText(item.text, x + tw(10), y + h - tw(26), w - tw(20), tw(22), {
          align: "center",
          fontPx: 12,
          bold: false,
          colorHex: "#1E293B",
        });
      }
      continue;
    }

    if (item.kind === "diamond") {
      doc.lines(
        [
          [w / 2, h / 2],
          [-w / 2, h / 2],
          [-w / 2, -h / 2],
        ],
        x + w / 2,
        y,
        [1, 1],
        "FD",
        true,
      );
      if (item.text) {
        drawWrappedText(item.text, x + w * 0.18, y + h * 0.18, w * 0.64, h * 0.64, {
          align: "center",
          fontPx: 14,
          colorHex: "#111827",
        });
      }
      continue;
    }

    if (item.kind === "ellipse" || item.kind === "cloud") {
      doc.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, "FD");
    } else if (item.kind === "sticky") {
      doc.roundedRect(x, y, w, h, tw(6), tw(6), "F");
    } else if (item.kind === "text") {
      // No border box for standalone text
    } else {
      doc.roundedRect(x, y, w, h, tw(10), tw(10), "FD");
      if (item.kind === "cylinder") {
        doc.ellipse(x + w / 2, y + tw(14), w / 2, tw(10), "FD");
      }
    }

    if (item.text) {
      const padIn = item.kind === "text" ? tw(6) : tw(12);
      const topExtra = item.kind === "cylinder" ? tw(14) : 0;
      drawWrappedText(
        item.text,
        x + padIn,
        y + padIn + topExtra,
        w - padIn * 2,
        h - padIn * 2 - topExtra,
        {
          align: item.kind === "text" ? "left" : "center",
          fontPx: item.kind === "text" ? 20 : item.kind === "sticky" ? 15 : 14,
          bold: item.kind === "text",
          colorHex: item.kind === "text" ? inkHex : "#111827",
        },
      );
    }
  }

  // Pass 2: Orthogonal Connector Lines + Arrowheads
  for (const item of ordered) {
    if (item.kind !== "arrow") continue;
    const routed = routedMap.get(item.id);
    if (!routed || routed.points.length < 2) continue;
    const inkHex = INK[item.color ?? "ink"];
    const [ir, ig, ib] = hexToRgb(inkHex);
    doc.setDrawColor(ir, ig, ib);
    doc.setFillColor(ir, ig, ib);
    doc.setLineWidth(Math.max(0.35, tw(2.2)));

    const pts = routed.points;
    for (let i = 0; i < pts.length - 1; i++) {
      doc.line(tx(pts[i]!.x), ty(pts[i]!.y), tx(pts[i + 1]!.x), ty(pts[i + 1]!.y));
    }

    const prev = pts[pts.length - 2]!;
    const end = pts[pts.length - 1]!;
    const angle = Math.atan2(end.y - prev.y, end.x - prev.x);
    const headLen = Math.max(1.8, tw(9));
    const headHalf = headLen * 0.52;
    const ex = tx(end.x);
    const ey = ty(end.y);
    const bx1 = ex - Math.cos(angle) * headLen + Math.sin(angle) * headHalf;
    const by1 = ey - Math.sin(angle) * headLen - Math.cos(angle) * headHalf;
    const bx2 = ex - Math.cos(angle) * headLen - Math.sin(angle) * headHalf;
    const by2 = ey - Math.sin(angle) * headLen + Math.cos(angle) * headHalf;
    doc.triangle(ex, ey, bx1, by1, bx2, by2, "F");
  }

  // Pass 3: Non-overlapping Arrow Label Pills
  for (const item of ordered) {
    if (item.kind !== "arrow" || !(item.text ?? "").trim()) continue;
    const routed = routedMap.get(item.id);
    if (!routed?.label) continue;
    const lx = tx(routed.label.x);
    const ly = ty(routed.label.y);
    const lw = tw(routed.label.w);
    const lh = tw(routed.label.h);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.25);
    doc.roundedRect(lx, ly, lw, lh, lh / 2, lh / 2, "FD");
    drawWrappedText(item.text!, lx + tw(6), ly + tw(2), lw - tw(12), lh - tw(4), {
      align: "center",
      fontPx: 11.5,
      bold: false,
      colorHex: INK[item.color ?? "ink"],
    });
  }

  // Footer caption
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text("OCSC Intelligence Whiteboard", margin, pageH - margin + 2);

  return doc.output("arraybuffer");
}
