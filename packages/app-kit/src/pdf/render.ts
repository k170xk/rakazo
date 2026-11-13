import { jsPDF } from "jspdf";
import type { CellHookData } from "jspdf-autotable";
import { autoTable } from "jspdf-autotable";
import type { PdfBlock, PdfDocument, PdfPicture, PdfTone } from "./model.js";

/**
 * Lays a report out on OCSC's standard PDF template, the one Evolve's inspection and tender
 * reports print with: the green OCSC banner across the top and the skyline across the bottom of
 * every page, Helvetica text in dark grey, brand green for numbering and accents, light grey
 * panels, and "Page n of N" over the footer. Text stays text, so the PDF can be searched.
 */

/** Pictures and artwork the host has already fetched: JPEG or PNG data URLs. */
export type PdfResources = {
  header?: string;
  footer?: string;
  /** By asset id, and by data URL for pictures drawn in the app. */
  pictures: Map<string, string>;
  /** Map snapshots by the index of their block. */
  maps: Map<number, string>;
};

const COLORS = {
  primary: "#77bf43",
  secondary: "#F59E0B",
  text: "#1F2937",
  muted: "#6B7280",
  label: "#9CA3AF",
  lightGray: "#F3F4F6",
  mediumGray: "#E5E7EB",
  white: "#FFFFFF",
  danger: "#EF4444",
  info: "#3B82F6",
};

const FONT = "helvetica";
const MARGIN = 16;
const PT = 0.3528;

/** Characters the built-in fonts can't draw, swapped for ones they can. */
const SWAPS: Record<string, string> = {
  "\u2212": "-",
  "\u2264": "<=",
  "\u2265": ">=",
  "\u2192": "->",
  "\u2190": "<-",
  "\u2713": "Yes",
  "\u2714": "Yes",
  "\u2717": "No",
  "\u2715": "No",
  "\u00a0": " ",
  "\u2009": " ",
  "\u202f": " ",
};
const WIN_ANSI = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

export function printable(value: string): string {
  let out = "";
  for (const char of value) {
    const swap = SWAPS[char];
    if (swap !== undefined) out += swap;
    else if (char.codePointAt(0)! <= 0xff || WIN_ANSI.has(char) || char === "\n") out += char;
  }
  return out;
}

type Run = { text: string; bold: boolean };

export function renderPdf(input: PdfDocument, resources: PdfResources): ArrayBuffer {
  const landscape = input.orientation === "landscape";
  const doc = new jsPDF({
    unit: "mm",
    format: "a4",
    orientation: landscape ? "l" : "p",
    compress: true,
  });
  doc.setProperties({
    title: printable(input.title),
    subject: printable(input.subtitle ?? input.kind ?? "Report"),
    author: printable(input.author ?? "OCSC"),
    creator: "OCSC Intelligence",
  });
  const plain = input.template?.plain === true;
  const accent = input.template?.accent ?? COLORS.primary;
  const toneColor = (tone: PdfTone | undefined): string =>
    tone === "neutral"
      ? COLORS.muted
      : tone === "warning"
        ? COLORS.secondary
        : tone === "danger"
          ? COLORS.danger
          : tone === "info"
            ? COLORS.info
            : accent;
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const content = width - MARGIN * 2;
  const artHeight = (art: string | undefined) => {
    if (plain || !art) return 0;
    const size = doc.getImageProperties(art);
    return (width * size.height) / size.width;
  };
  const headerHeight = artHeight(resources.header);
  const footerHeight = artHeight(resources.footer);
  const top = (headerHeight || 4) + 12;
  const bottom = footerHeight + 22;
  const pageEnd = height - bottom;
  let y = top;

  const font = (size: number, bold = false, colour = COLORS.text) => {
    doc.setFont(FONT, bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(colour);
  };
  const lineHeight = (size: number) => size * PT * 1.42;
  const newPage = () => {
    doc.addPage();
    y = top;
  };
  const ensure = (needed: number) => {
    if (y + needed > pageEnd && y > top) newPage();
  };
  const wrap = (value: string, w: number, size: number, bold = false): string[] => {
    font(size, bold);
    return doc.splitTextToSize(printable(value), w) as string[];
  };
  const short = (value: string, w: number, size: number, count: number, bold = false) => {
    const all = wrap(value, w, size, bold);
    if (all.length <= count) return all;
    const clipped = all.slice(0, count);
    let last = clipped[count - 1] ?? "";
    while (doc.getTextWidth(`${last}...`) > w && last.length) last = last.slice(0, -1);
    clipped[count - 1] = `${last.trim()}...`;
    return clipped;
  };
  const rule = (gap = 7) => {
    doc.setDrawColor(COLORS.mediumGray);
    doc.setLineWidth(0.25);
    doc.line(MARGIN, y, width - MARGIN, y);
    y += gap;
  };
  const caps = (value: string, x: number, at: number, colour = COLORS.label, size = 7.5) => {
    font(size, true, colour);
    doc.text(printable(value.toUpperCase()), x, at);
  };

  /** A paragraph with **bold** runs, wrapped to width; returns its lines. */
  const runs = (value: string, w: number, size: number): Run[][] => {
    const words: Run[] = [];
    printable(value)
      .split(/(\*\*[^*]+\*\*)/)
      .forEach((part) => {
        const bold = /^\*\*[^*]+\*\*$/.test(part);
        const text = bold ? part.slice(2, -2) : part;
        for (const word of text.split(/(?<=\s)/)) if (word) words.push({ text: word, bold });
      });
    const lines: Run[][] = [];
    let line: Run[] = [];
    let used = 0;
    const measure = (run: Run) => {
      font(size, run.bold);
      return doc.getTextWidth(run.text);
    };
    for (const word of words) {
      let piece = word;
      let wide = measure(piece);
      while (wide > w) {
        let cut = piece.text.length - 1;
        while (cut > 1 && measure({ ...piece, text: piece.text.slice(0, cut) }) > w - used) cut--;
        if (used > 0 && cut <= 1) {
          lines.push(line);
          line = [];
          used = 0;
          continue;
        }
        line.push({ ...piece, text: piece.text.slice(0, cut) });
        lines.push(line);
        line = [];
        used = 0;
        piece = { ...piece, text: piece.text.slice(cut) };
        wide = measure(piece);
      }
      if (used + wide > w && used > 0) {
        lines.push(line);
        line = [];
        used = 0;
        if (!piece.text.trim()) continue;
      }
      line.push(piece);
      used += wide;
    }
    if (line.length) lines.push(line);
    return lines;
  };
  const drawRuns = (line: Run[], x: number, at: number, size: number, colour: string) => {
    let cursor = x;
    for (const run of line) {
      font(size, run.bold, colour);
      doc.text(run.text, cursor, at);
      cursor += doc.getTextWidth(run.text);
    }
  };
  const paragraph = (value: string, x: number, w: number, size: number, colour = COLORS.text) => {
    const step = lineHeight(size);
    const blocks = value.replace(/\r/g, "").split(/\n\s*\n/);
    blocks.forEach((block, index) => {
      for (const source of block.split("\n")) {
        for (const line of runs(source, w, size)) {
          ensure(step);
          drawRuns(line, x, y + size * PT, size, colour);
          y += step;
        }
      }
      if (index < blocks.length - 1) y += step * 0.5;
    });
  };
  const pictureOf = (pic: PdfPicture | undefined) =>
    pic ? resources.pictures.get("asset" in pic ? pic.asset : pic.src) : undefined;
  const imageFormat = (data: string) => (data.startsWith("data:image/png") ? "PNG" : "JPEG");
  /** Draws a picture inside a box, keeping its shape; returns the height used. */
  const fitImage = (data: string, x: number, at: number, w: number, maxH: number) => {
    const size = doc.getImageProperties(data);
    let drawW = w;
    let drawH = (w * size.height) / size.width;
    if (drawH > maxH) {
      drawH = maxH;
      drawW = (maxH * size.width) / size.height;
    }
    const left = x + (w - drawW) / 2;
    doc.addImage(data, imageFormat(data), left, at, drawW, drawH, undefined, "FAST");
    doc.setDrawColor(COLORS.mediumGray);
    doc.setLineWidth(0.2);
    doc.rect(left, at, drawW, drawH);
    return drawH;
  };
  const missing = (x: number, at: number, w: number, h: number) => {
    doc.setFillColor(COLORS.lightGray);
    doc.rect(x, at, w, h, "F");
    font(8, false, COLORS.label);
    doc.text("Picture not available", x + w / 2, at + h / 2, { align: "center" });
  };
  const when = (value: string | undefined) => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
  };
  const cellText = (value: string | number | boolean | null | undefined) =>
    value === null || value === undefined
      ? ""
      : typeof value === "boolean"
        ? value
          ? "Yes"
          : "No"
        : typeof value === "number"
          ? value.toLocaleString("en-IE", { maximumFractionDigits: 2 })
          : printable(value);
  const formatValue = (value: number, format: "number" | "currency" | "percent" | undefined) =>
    format === "currency"
      ? `€${value.toLocaleString("en-IE", { maximumFractionDigits: 0 })}`
      : format === "percent"
        ? `${value.toLocaleString("en-IE", { maximumFractionDigits: 1 })}%`
        : value.toLocaleString("en-IE", { maximumFractionDigits: 2 });

  // First page: what it is, the title, and who and when, as on Evolve's report front sheets.
  caps(input.kind ?? "Report", MARGIN, y, accent, 9);
  font(9, false, COLORS.label);
  doc.text(
    printable(
      input.date ??
        new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    ),
    width - MARGIN,
    y,
    { align: "right" },
  );
  y += 12;
  const title = short(input.title, content, 24, 3, true);
  font(24, true);
  title.forEach((line, i) => {
    doc.text(line, MARGIN, y + i * lineHeight(24));
  });
  y += title.length * lineHeight(24) + 1;
  if (input.subtitle) {
    const sub = short(input.subtitle, content, 11.5, 3);
    font(11.5, false, COLORS.muted);
    sub.forEach((line, i) => {
      doc.text(line, MARGIN, y + i * lineHeight(11.5));
    });
    y += sub.length * lineHeight(11.5) + 2;
  }
  const front = [
    input.reference ? ["Reference", input.reference] : null,
    input.author ? ["Prepared by", input.author] : null,
  ].filter((item): item is string[] => Boolean(item));
  if (front.length) {
    y += 3;
    front.forEach(([label, value], i) => {
      const x = MARGIN + i * (content / 2);
      caps(label!, x, y);
      font(10.5, true);
      doc.text(short(value!, content / 2 - 6, 10.5, 1, true), x, y + 5.5);
    });
    y += 11;
  }
  y += 2;
  rule(9);

  let section = 0;
  input.blocks.forEach((item: PdfBlock, index) => {
    switch (item.type) {
      case "heading": {
        if (item.newPage) newPage();
        else ensure(38);
        if (y > top) y += 5;
        section += 1;
        caps(item.number ?? String(section).padStart(2, "0"), MARGIN, y, accent, 9);
        const lines = short(item.text, content, 17, 2, true);
        font(17, true);
        lines.forEach((line, i) => {
          doc.text(line, MARGIN, y + 8 + i * lineHeight(17));
        });
        y += 8 + lines.length * lineHeight(17);
        if (item.subtitle) {
          font(9, false, COLORS.label);
          doc.text(short(item.subtitle, content, 9, 1), MARGIN, y);
          y += 6;
        }
        y += 3;
        break;
      }
      case "subheading": {
        ensure(16);
        y += 2;
        const lines = short(item.text, content, 11.5, 2, true);
        font(11.5, true);
        lines.forEach((line, i) => {
          doc.text(line, MARGIN, y + 3.5 + i * lineHeight(11.5));
        });
        y += lines.length * lineHeight(11.5) + 2.5;
        break;
      }
      case "text": {
        const size = item.size === "small" ? 8.5 : item.size === "large" ? 12 : 10;
        paragraph(item.text, MARGIN, content, size, item.muted ? COLORS.muted : COLORS.text);
        y += 3;
        break;
      }
      case "bullets": {
        item.items.forEach((entry, i) => {
          ensure(lineHeight(10));
          const at = y;
          if (item.numbered) {
            font(10, true, accent);
            doc.text(`${i + 1}.`, MARGIN, at + 10 * PT);
          } else {
            doc.setFillColor(accent);
            doc.circle(MARGIN + 1.2, at + 10 * PT - 1.1, 0.9, "F");
          }
          paragraph(entry, MARGIN + 6, content - 6, 10);
          y += 1;
        });
        y += 2;
        break;
      }
      case "stats": {
        const perRow = Math.min(4, Math.max(1, item.items.length));
        const gap = 4;
        const w = (content - gap * (perRow - 1)) / perRow;
        for (let start = 0; start < item.items.length; start += perRow) {
          ensure(30);
          item.items.slice(start, start + perRow).forEach((stat, i) => {
            const x = MARGIN + i * (w + gap);
            doc.setFillColor(COLORS.lightGray);
            doc.rect(x, y, w, 26, "F");
            doc.setFillColor(toneColor(stat.tone));
            doc.rect(x, y, w, 1, "F");
            caps(short(stat.label, w - 8, 7.5, 1, true)[0] ?? "", x + 4, y + 8);
            const value = typeof stat.value === "number" ? cellText(stat.value) : stat.value || "-";
            const lines = short(value, w - 8, 14, 2, true);
            font(14, true);
            lines.forEach((line, l) => {
              doc.text(line, x + 4, y + 17 + l * 5.6);
            });
          });
          y += 30;
        }
        y += 2;
        break;
      }
      case "facts": {
        const colW = content / 2;
        for (let i = 0; i < item.items.length; i += 2) {
          const pair = item.items.slice(i, i + 2);
          const heights = pair.map(
            (fact) =>
              wrap(fact.value === null ? "-" : String(fact.value), colW - 6, 10.5, true).slice(0, 4)
                .length,
          );
          const rowH = 6 + Math.max(...heights) * lineHeight(10.5) + 3;
          ensure(rowH);
          pair.forEach((fact, c) => {
            const x = MARGIN + c * colW;
            caps(fact.label, x, y + 3);
            const lines = short(
              fact.value === null || fact.value === "" ? "-" : String(fact.value),
              colW - 6,
              10.5,
              4,
              true,
            );
            font(10.5, true);
            lines.forEach((line, l) => {
              doc.text(line, x, y + 8.5 + l * lineHeight(10.5));
            });
          });
          y += rowH;
        }
        y += 2;
        break;
      }
      case "table": {
        const columns = item.columns.map((column) =>
          typeof column === "string" ? { label: column } : column,
        );
        if (item.caption) {
          ensure(18);
          font(8.5, true, COLORS.muted);
          doc.text(short(item.caption, content, 8.5, 1, true), MARGIN, y + 3);
          y += 6;
        } else ensure(14);
        const total = item.total ? item.rows.length - 1 : -1;
        autoTable(doc, {
          startY: y,
          head: [columns.map((column) => printable(column.label))],
          body: item.rows.map((row) => columns.map((_, c) => cellText(row[c]))),
          theme: "plain",
          margin: { top, bottom, left: MARGIN, right: MARGIN },
          styles: {
            font: FONT,
            fontSize: 8.8,
            textColor: COLORS.text,
            cellPadding: { top: 2.2, bottom: 2.2, left: 2.4, right: 2.4 },
            overflow: "linebreak",
            lineColor: COLORS.mediumGray,
            lineWidth: { bottom: 0.2 },
          },
          headStyles: {
            fillColor: accent,
            textColor: COLORS.white,
            fontStyle: "bold",
            lineWidth: 0,
          },
          alternateRowStyles: { fillColor: "#F9FAFB" },
          columnStyles: Object.fromEntries(
            columns.map((column, c) => [
              c,
              {
                halign:
                  column.align ??
                  (item.rows.every((row) => row[c] === null || typeof row[c] === "number") &&
                  item.rows.length
                    ? "right"
                    : "left"),
                ...(column.width ? { cellWidth: column.width } : {}),
              },
            ]),
          ),
          didParseCell: (data: CellHookData) => {
            if (data.section === "head") {
              const align = columns[data.column.index]?.align;
              if (align) data.cell.styles.halign = align;
            }
            if (data.section === "body" && data.row.index === total) {
              data.cell.styles.fontStyle = "bold";
              data.cell.styles.fillColor = COLORS.lightGray;
            }
          },
          rowPageBreak: "avoid",
        });
        y =
          ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 8;
        break;
      }
      case "photos": {
        const columns = item.columns ?? 2;
        const gap = 5;
        const w = (content - gap * (columns - 1)) / columns;
        const maxH = columns === 1 ? 120 : columns === 2 ? 72 : 52;
        for (let start = 0; start < item.photos.length; start += columns) {
          const row = item.photos.slice(start, start + columns);
          const layouts = row.map((photo) => {
            const data = pictureOf(photo);
            let imgH = maxH * 0.75;
            if (data) {
              const size = doc.getImageProperties(data);
              imgH = Math.min(maxH, (w * size.height) / size.width);
            }
            const caption = photo.caption ? short(photo.caption, w, 8.8, 3) : [];
            const where =
              photo.lat !== undefined && photo.lon !== undefined
                ? `${photo.lat.toFixed(5)}, ${photo.lon.toFixed(5)}`
                : "";
            const meta = [where, when(photo.takenAt)].filter(Boolean).join("  ·  ");
            return { data, imgH, caption, meta };
          });
          const rowH = Math.max(
            ...layouts.map(
              (l) => l.imgH + 2 + l.caption.length * lineHeight(8.8) + (l.meta ? 4.5 : 0),
            ),
          );
          ensure(rowH + 4);
          layouts.forEach((layout, i) => {
            const x = MARGIN + i * (w + gap);
            let at = y;
            if (layout.data) at += fitImage(layout.data, x, at, w, maxH);
            else {
              missing(x, at, w, layout.imgH);
              at += layout.imgH;
            }
            at += 2;
            font(8.8);
            layout.caption.forEach((line) => {
              doc.text(line, x, at + 8.8 * PT);
              at += lineHeight(8.8);
            });
            if (layout.meta) {
              font(7.5, false, COLORS.muted);
              doc.text(printable(layout.meta), x, at + 7.5 * PT + 0.6);
            }
          });
          y += rowH + 5;
        }
        break;
      }
      case "image": {
        const data = pictureOf(item);
        const w = item.width === "half" ? content / 2 : content;
        const maxH = pageEnd - top - 12;
        let h = maxH * 0.4;
        if (data) {
          const size = doc.getImageProperties(data);
          h = Math.min(maxH, (w * size.height) / size.width);
        }
        ensure(h + (item.caption ? 8 : 2));
        if (data) fitImage(data, MARGIN, y, w, maxH);
        else missing(MARGIN, y, w, h);
        y += h + 2;
        if (item.caption) {
          font(8.5, false, COLORS.muted);
          short(item.caption, w, 8.5, 2).forEach((line) => {
            doc.text(line, MARGIN, y + 8.5 * PT);
            y += lineHeight(8.5);
          });
        }
        y += 4;
        break;
      }
      case "checklist": {
        const tally = { pass: 0, fail: 0, na: 0, open: 0 };
        for (const check of item.items) tally[check.result ?? "open"] += 1;
        ensure(16);
        font(8.5, true, COLORS.muted);
        doc.text(
          [
            `${tally.pass} pass`,
            `${tally.fail} fail`,
            `${tally.na} not applicable`,
            tally.open ? `${tally.open} not checked` : "",
          ]
            .filter(Boolean)
            .join("   ·   "),
          MARGIN,
          y + 3,
        );
        y += 7;
        for (const check of item.items) {
          const label = wrap(check.label, content - 24, 10);
          const note = check.note ? wrap(check.note, content - 24, 8.5) : [];
          const rowH = Math.max(
            8,
            label.length * lineHeight(10) + note.length * lineHeight(8.5) + 4,
          );
          ensure(rowH);
          const badge =
            check.result === "pass"
              ? { text: "PASS", fill: COLORS.primary }
              : check.result === "fail"
                ? { text: "FAIL", fill: COLORS.danger }
                : check.result === "na"
                  ? { text: "N/A", fill: COLORS.label }
                  : { text: "-", fill: COLORS.mediumGray };
          doc.setFillColor(badge.fill);
          doc.roundedRect(MARGIN, y + 0.8, 15, 5, 1.2, 1.2, "F");
          font(7, true, badge.text === "-" ? COLORS.muted : COLORS.white);
          doc.text(badge.text, MARGIN + 7.5, y + 4.2, { align: "center" });
          let at = y;
          font(10);
          label.forEach((line) => {
            doc.text(line, MARGIN + 20, at + 10 * PT + 0.8);
            at += lineHeight(10);
          });
          font(8.5, false, COLORS.muted);
          note.forEach((line) => {
            doc.text(line, MARGIN + 20, at + 8.5 * PT + 0.8);
            at += lineHeight(8.5);
          });
          y += rowH;
          doc.setDrawColor(COLORS.mediumGray);
          doc.setLineWidth(0.2);
          doc.line(MARGIN, y - 1.5, width - MARGIN, y - 1.5);
        }
        y += 4;
        break;
      }
      case "callout": {
        const textLines = wrap(item.text, content - 12, 10);
        const maxLines = Math.floor((pageEnd - top - 16) / lineHeight(10));
        const shown = textLines.slice(0, maxLines);
        const h = 7 + (item.title ? 6 : 0) + shown.length * lineHeight(10) + 2;
        ensure(h + 3);
        doc.setFillColor(COLORS.lightGray);
        doc.rect(MARGIN, y, content, h, "F");
        doc.setFillColor(toneColor(item.tone));
        doc.rect(MARGIN, y, 1.5, h, "F");
        let at = y + 6;
        if (item.title) {
          font(9.5, true, toneColor(item.tone));
          doc.text(short(item.title, content - 12, 9.5, 1, true), MARGIN + 6, at);
          at += 6;
        }
        font(10);
        shown.forEach((line) => {
          doc.text(line, MARGIN + 6, at);
          at += lineHeight(10);
        });
        y += h + 5;
        break;
      }
      case "bars": {
        if (item.title) {
          ensure(16);
          font(10, true, accent);
          doc.text(short(item.title, content, 10, 1, true), MARGIN, y + 3);
          y += 8;
        }
        const max = Math.max(1, ...item.items.map((bar) => Math.abs(bar.value)));
        const labelW = Math.min(60, content * 0.32);
        const valueW = 26;
        const barW = content - labelW - valueW - 4;
        for (const bar of item.items) {
          ensure(8);
          font(9);
          doc.text(short(bar.label, labelW - 3, 9, 1)[0] ?? "", MARGIN, y + 4);
          doc.setFillColor(COLORS.lightGray);
          doc.rect(MARGIN + labelW, y + 0.8, barW, 4.4, "F");
          doc.setFillColor(toneColor(bar.tone));
          doc.rect(
            MARGIN + labelW,
            y + 0.8,
            Math.max(0.6, (barW * Math.abs(bar.value)) / max),
            4.4,
            "F",
          );
          font(9, true);
          doc.text(formatValue(bar.value, item.format), width - MARGIN, y + 4, { align: "right" });
          y += 7.2;
        }
        y += 4;
        break;
      }
      case "map": {
        const data = resources.maps.get(index);
        const h = content / 2;
        ensure(h + 10);
        if (data) fitImage(data, MARGIN, y, content, h);
        else missing(MARGIN, y, content, h);
        y += h + 2;
        if (item.caption) {
          font(8.5, false, COLORS.muted);
          doc.text(short(item.caption, content, 8.5, 1), MARGIN, y + 3);
          y += 6;
        }
        const named = (item.points ?? [])
          .map((point, i) => ({ ...point, n: i + 1 }))
          .filter((point) => point.label);
        if (item.legend !== false && named.length) {
          const colW = content / 2;
          for (let i = 0; i < named.length; i += 2) {
            ensure(5.5);
            named.slice(i, i + 2).forEach((point, c) => {
              const x = MARGIN + c * colW;
              doc.setFillColor(toneColor(point.tone));
              doc.circle(x + 2, y + 1.8, 2, "F");
              font(6.5, true, COLORS.white);
              doc.text(String(point.n), x + 2, y + 2.6, { align: "center" });
              font(8.5);
              doc.text(short(point.label ?? "", colW - 10, 8.5, 1)[0] ?? "", x + 6, y + 3);
            });
            y += 5.5;
          }
        }
        y += 4;
        break;
      }
      case "signatures": {
        const per = Math.min(3, Math.max(1, item.items.length));
        const gap = 8;
        const w = (content - gap * (per - 1)) / per;
        for (let start = 0; start < item.items.length; start += per) {
          ensure(42);
          item.items.slice(start, start + per).forEach((sign, i) => {
            const x = MARGIN + i * (w + gap);
            const data = pictureOf(sign.signature);
            if (data) {
              const size = doc.getImageProperties(data);
              const h = Math.min(20, (w * 0.8 * size.height) / size.width);
              const drawW = (h * size.width) / size.height;
              doc.addImage(data, imageFormat(data), x, y + 20 - h, drawW, h, undefined, "FAST");
            }
            doc.setDrawColor(COLORS.text);
            doc.setLineWidth(0.3);
            doc.line(x, y + 22, x + w, y + 22);
            caps(sign.label, x, y + 27);
            if (sign.name) {
              font(10, true);
              doc.text(short(sign.name, w, 10, 1, true), x, y + 32);
            }
            if (sign.date) {
              font(8.5, false, COLORS.muted);
              doc.text(printable(sign.date), x, y + 36.5);
            }
          });
          y += 42;
        }
        break;
      }
      case "divider":
        ensure(8);
        y += 1;
        rule(7);
        break;
      case "pageBreak":
        newPage();
        break;
    }
  });

  const pages = doc.getNumberOfPages();
  const footerText = printable(
    input.footer ?? ["OCSC", input.title, input.reference].filter(Boolean).join("  |  "),
  );
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    if (!plain && resources.header)
      doc.addImage(resources.header, "JPEG", 0, 0, width, headerHeight);
    if (!plain && resources.footer)
      doc.addImage(resources.footer, "PNG", 0, height - footerHeight, width, footerHeight);
    const base = height - footerHeight - 2;
    doc.setDrawColor(COLORS.mediumGray);
    doc.setLineWidth(0.25);
    doc.line(MARGIN, base - 10, width - MARGIN, base - 10);
    font(8);
    const meta = (doc.splitTextToSize(footerText, content - 30) as string[])[0] ?? "";
    doc.text(meta, MARGIN, base - 5);
    doc.text(`Page ${page} of ${pages}`, width - MARGIN, base - 5, { align: "right" });
  }
  return doc.output("arraybuffer");
}
