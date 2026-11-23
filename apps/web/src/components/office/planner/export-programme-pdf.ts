import { calculateCriticalPath, diffDays, type Task } from "@jantt/core";
import { jsPDF } from "@rakazo/app-kit/pdf/render";
import { isSummaryTask, outlineDepth } from "./ms-project-plan";
import type { PlanDocument } from "./plan";
import { evolveLinkOf, planTitle, taskLabel } from "./plan";

/** ISO landscape sheets in millimetres [width, height]. */
export const PROGRAMME_SHEETS = {
  a4: { id: "a4" as const, w: 297, h: 210 },
  a3: { id: "a3" as const, w: 420, h: 297 },
  a1: { id: "a1" as const, w: 841, h: 594 },
  a0: { id: "a0" as const, w: 1189, h: 841 },
};

export type ProgrammeSheetId = keyof typeof PROGRAMME_SHEETS;

const ARTWORK = {
  header: "/brand/pdf/ocsc-header.jpg",
  /** A plain strip cut from the header's left edge, so the extension matches its green exactly. */
  headerFill: "/brand/pdf/ocsc-header-fill.jpg",
  footer: "/brand/pdf/ocsc-footer.png",
};

/**
 * The artwork is drawn for A4 portrait (210 mm wide) and is never stretched: the header keeps its
 * proportions on the right (logo) and its green is continued to the left edge; the footer stays
 * centred and its bottom rule is continued to both edges. Colours and rule positions are sampled
 * from the artwork files (1999×186 header, 819×56 footer).
 */
const CHROME = {
  artworkWidth: 210,
  headerAspect: 1999 / 186,
  footerAspect: 819 / 56,
  headerGreen: [119, 190, 68] as const,
  headerRule: [0, 25, 0] as const,
  headerRuleFraction: 1 / 186,
  footerRule: [120, 193, 68] as const,
  footerRuleTop: 50.5 / 56,
  footerRuleHeight: 5.5 / 56,
  /** Where the OCSC logo begins across the header artwork; header text stays left of it. */
  logoStart: 1570 / 1999,
};

/** Vertical layout shared by the sheet picker and the drawing, so the chosen sheet really fits. */
function pageLayout(sheet: { w: number; h: number }) {
  const { headerH, footerH } = chromeSize(sheet);
  const contentTop = headerH + 5;
  const contentBottom = sheet.h - footerH - LEGEND_H - 2;
  const timelineHeaderH = 10;
  const rowsAreaTop = contentTop + timelineHeaderH;
  return { contentTop, contentBottom, timelineHeaderH, rowsAreaTop, rowsAreaH: contentBottom - rowsAreaTop };
}

/** A4 landscape uses the A4 artwork size; bigger sheets scale it up to 1.5×, leaving room for rows. */
function chromeSize(sheet: { w: number; h: number }) {
  const scale = Math.min(1.5, Math.max(1, sheet.h / 210));
  const headerW = CHROME.artworkWidth * scale;
  const footerW = CHROME.artworkWidth * scale;
  return {
    scale,
    headerW,
    headerH: headerW / CHROME.headerAspect,
    footerW,
    footerH: footerW / CHROME.footerAspect,
  };
}

export const PROGRAMME_PDF_COLORS = {
  text: "#1F2937",
  muted: "#6B7280",
  line: "#D1D5DB",
  summaryBg: "#E9F5DF",
  summaryBar: "#1F2937",
  task: "#76BF43",
  critical: "#DC2626",
  progress: "#4B8A22",
  milestone: "#111827",
  weekend: "#F3F4F6",
  headerBand: "#F2F6EE",
  white: "#FFFFFF",
};

const COLORS = PROGRAMME_PDF_COLORS;

/** Minimum row height that still keeps ~7pt labels readable on large sheets. */
const MIN_ROW_MM = 2.5;
const MIN_DAY_MM = 0.22;
const MIN_FONT = 7;
/** Typical table width, only for choosing the sheet; the drawn table is sized from its text. */
const TABLE_W = 135;
const CELL_PAD = 1.6;
const MIN_NAME_W = 45;
/** Widest possible date, so the Start/Finish columns never depend on which dates happen to appear. */
const WIDEST_DATE = "Wed 28/09/28";
const MARGIN = 8;
const LEGEND_H = 16;
type Pred = { id: string; type: string };

function dayKey(value: string): string {
  return value.slice(0, 10);
}

function parseDate(value: string): Date {
  const [y, m, d] = dayKey(value).split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

function formatUk(value: string): string {
  const dt = parseDate(value);
  if (Number.isNaN(dt.getTime())) return value.slice(0, 10);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
  return `${days[dt.getUTCDay()]} ${String(dt.getUTCDate()).padStart(2, "0")}/${months[dt.getUTCMonth()]}/${String(dt.getUTCFullYear()).slice(2)}`;
}

function durationLabel(task: Task): string {
  if (task.milestone) return "0 days";
  const start = task.start ? dayKey(task.start) : "";
  const end = task.end ? dayKey(task.end) : start;
  if (!start) return "—";
  const days = Math.max(task.milestone ? 0 : 1, diffDays(start, end) + 1);
  return `${days} days`;
}

function predecessorsOf(task: Task): Pred[] {
  const raw = task.dependsOn;
  if (!raw) return [];
  const items = Array.isArray(raw) ? raw : [raw];
  const out: Pred[] = [];
  for (const item of items) {
    if (typeof item === "string" && item.trim()) out.push({ id: item.trim(), type: "FS" });
    else if (item && typeof item === "object" && "id" in item && typeof (item as { id: unknown }).id === "string") {
      const typed = item as { id: string; type?: string };
      out.push({ id: typed.id, type: typed.type || "FS" });
    }
  }
  return out;
}

function printable(value: string): string {
  return value.replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]/g, "");
}

async function fetchDataUrl(url: string): Promise<string | undefined> {
  const response = await fetch(url, { credentials: "same-origin" }).catch(() => null);
  if (!response?.ok) return undefined;
  const blob = await response.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(blob);
  });
}

function spanOf(tasks: Task[]): { start: string; end: string; days: number } | null {
  const starts = tasks.map((t) => t.start && dayKey(t.start)).filter(Boolean) as string[];
  const ends = tasks.map((t) => t.end && dayKey(t.end)).filter(Boolean) as string[];
  if (!starts.length || !ends.length) return null;
  starts.sort();
  ends.sort();
  const start = starts[0]!;
  const end = ends[ends.length - 1]!;
  return { start, end, days: Math.max(1, diffDays(start, end) + 1) };
}

/**
 * Smallest landscape ISO sheet that keeps rows and timeline legible.
 * Tall programmes still pick a sheet, then paginate vertically.
 */
export function pickProgrammeSheetSize(input: {
  taskCount: number;
  spanDays: number;
}): ProgrammeSheetId {
  const { taskCount, spanDays } = input;
  const order: ProgrammeSheetId[] = ["a4", "a3", "a1", "a0"];
  for (const id of order) {
    const sheet = PROGRAMME_SHEETS[id];
    const usableW = sheet.w - MARGIN * 2 - TABLE_W;
    const rowH = pageLayout(sheet).rowsAreaH / Math.max(1, taskCount);
    const dayW = usableW / Math.max(1, spanDays);
    if (rowH >= MIN_ROW_MM && dayW >= MIN_DAY_MM) return id;
  }
  return "a0";
}

/** Longest prefix of `text` (plus an ellipsis) that fits `maxWidth` at the document's current font. */
function fitText(doc: jsPDF, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (doc.getTextWidth(`${text.slice(0, mid).trimEnd()}…`) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return low > 0 ? `${text.slice(0, low).trimEnd()}…` : "";
}

function monthLabel(date: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[date.getUTCMonth()]} '${String(date.getUTCFullYear()).slice(2)}`;
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

export type ProgrammePdfResult = {
  blob: Blob;
  sheet: ProgrammeSheetId;
  pages: number;
  fileName: string;
};

/** Draw an OCSC-branded landscape programme PDF (Mountjoy-style table + Gantt + legend). */
export async function exportProgrammePdf(
  plan: PlanDocument,
  options?: { fileName?: string },
): Promise<ProgrammePdfResult> {
  const tasks = [...(plan.tasks ?? [])];
  const title = planTitle(plan, "Programme");
  const job = evolveLinkOf(plan);
  const subtitleLead = job
    ? [`Job ${job.jobNumber}${job.name ? ` - ${job.name}` : ""}`, "Project Programme"]
    : ["Project Programme"];
  const span = spanOf(tasks) ?? {
    start: new Date().toISOString().slice(0, 10),
    end: new Date().toISOString().slice(0, 10),
    days: 30,
  };
  const sheetId = pickProgrammeSheetSize({ taskCount: Math.max(1, tasks.length), spanDays: span.days });
  const sheet = PROGRAMME_SHEETS[sheetId];
  const critical = calculateCriticalPath(tasks);
  const criticalIds = critical.criticalTaskIds;

  const [headerArt, headerFillArt, footerArt] = await Promise.all([
    fetchDataUrl(ARTWORK.header),
    fetchDataUrl(ARTWORK.headerFill),
    fetchDataUrl(ARTWORK.footer),
  ]);

  const doc = new jsPDF({
    unit: "mm",
    format: [sheet.w, sheet.h],
    orientation: "landscape",
    compress: true,
  });
  doc.setProperties({
    title: printable(title),
    subject: "Project programme",
    author: "OCSC",
    creator: "OCSC Intelligence",
  });

  const chrome = chromeSize(sheet);
  const headerH = chrome.headerH;
  const footerH = chrome.footerH;

  const { contentTop, contentBottom, timelineHeaderH, rowsAreaTop, rowsAreaH } = pageLayout(sheet);
  const rowH = Math.max(MIN_ROW_MM, Math.min(6.5, rowsAreaH / Math.max(1, tasks.length)));
  const rowsPerPage = Math.max(1, Math.floor(rowsAreaH / rowH));
  const pages = Math.max(1, Math.ceil(Math.max(1, tasks.length) / rowsPerPage));
  const fontSize = Math.max(MIN_FONT, Math.min(9, rowH * 1.55));
  const headerFontSize = Math.max(6.5, fontSize - 0.5);
  const indentOf = (task: Task) => Math.min(18, outlineDepth(task) * 2.2);

  // Every column is as wide as its widest text at the printed size, so nothing overlaps.
  const widest = (texts: string[], bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    return Math.max(0, ...texts.map((text) => doc.getTextWidth(text)));
  };
  doc.setFontSize(headerFontSize);
  const headerWidths = {
    id: widest(["ID"], true),
    name: widest(["Task Name"], true),
    dur: widest(["Duration"], true),
    date: widest(["Start", "Finish"], true),
  };
  doc.setFontSize(fontSize);
  const idW = Math.max(headerWidths.id, widest([String(Math.max(1, tasks.length))], true)) + CELL_PAD * 2;
  const durW = Math.max(headerWidths.dur, widest(["999 days", ...tasks.map(durationLabel)])) + CELL_PAD * 2;
  const dateW = Math.max(headerWidths.date, widest([WIDEST_DATE])) + CELL_PAD * 2;
  doc.setFont("helvetica", "bold");
  const longestName = Math.max(
    headerWidths.name,
    ...tasks.map((task) => doc.getTextWidth(printable(taskLabel(task))) + indentOf(task)),
  );
  const fixedW = idW + durW + dateW * 2;
  const maxTableW = sheet.w * (sheet.w <= 420 ? 0.5 : 0.4);
  const nameW = Math.max(MIN_NAME_W, Math.min(longestName + CELL_PAD * 2, maxTableW - fixedW));
  const tableW = fixedW + nameW;
  const col = {
    id: MARGIN,
    name: MARGIN + idW,
    dur: MARGIN + idW + nameW,
    start: MARGIN + idW + nameW + durW,
    finish: MARGIN + idW + nameW + durW + dateW,
  };

  const ganttLeft = MARGIN + tableW;
  const ganttWidth = sheet.w - MARGIN - ganttLeft;
  const dayW = ganttWidth / span.days;

  const taskIndex = new Map(tasks.map((task, i) => [task.id, i]));
  const barGeom = (task: Task, pageRow: number) => {
    const start = dayKey(task.start || span.start);
    const end = dayKey(task.end || task.start || span.start);
    const x0 = ganttLeft + diffDays(span.start, start) * dayW;
    const x1 = ganttLeft + (diffDays(span.start, end) + (task.milestone ? 0 : 1)) * dayW;
    const y = rowsAreaTop + pageRow * rowH;
    return { x0, x1, y, midY: y + rowH / 2 };
  };

  const drawChrome = (page: number) => {
    // Header: green band across the sheet, artwork (logo) at its own proportions on the right.
    const headerLeft = sheet.w - chrome.headerW;
    if (headerFillArt) doc.addImage(headerFillArt, "JPEG", 0, 0, headerLeft + 0.5, headerH);
    else {
      const ruleH = Math.max(0.15, headerH * CHROME.headerRuleFraction);
      doc.setFillColor(...CHROME.headerGreen);
      doc.rect(0, 0, headerLeft + 0.5, headerH, "F");
      doc.setFillColor(...CHROME.headerRule);
      doc.rect(0, headerH - ruleH, headerLeft + 0.5, ruleH, "F");
    }
    if (headerArt) doc.addImage(headerArt, "JPEG", headerLeft, 0, chrome.headerW, headerH);
    else {
      doc.setFillColor(...CHROME.headerGreen);
      doc.rect(headerLeft, 0, chrome.headerW, headerH, "F");
    }

    // Footer: artwork centred at its own proportions, its bottom rule continued to both edges.
    const footerTop = sheet.h - footerH;
    const footerLeft = (sheet.w - chrome.footerW) / 2;
    doc.setFillColor(...CHROME.footerRule);
    doc.rect(
      0,
      footerTop + footerH * CHROME.footerRuleTop,
      sheet.w,
      footerH * CHROME.footerRuleHeight,
      "F",
    );
    if (footerArt) doc.addImage(footerArt, "PNG", footerLeft, footerTop, chrome.footerW, footerH);
    // Title and subtitle in the green band, left-aligned, sized like the data sheet / CV banners.
    const s = chrome.scale;
    const textW = headerLeft + chrome.headerW * CHROME.logoStart - 6 * s - MARGIN;
    const subtitle = [
      ...subtitleLead,
      `${formatUk(span.start)} - ${formatUk(span.end)}`,
      `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`,
      ...(pages > 1 ? [`Page ${page} of ${pages}`] : []),
    ].join("   |   ");
    doc.setTextColor("#FFFFFF");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18 * s);
    doc.text(fitText(doc, printable(title), textW), MARGIN, headerH * 0.52);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5 * s);
    doc.text(fitText(doc, printable(subtitle), textW), MARGIN, headerH * 0.52 + 3.9 * s);
  };

  const drawTimelineHeader = () => {
    doc.setFillColor(COLORS.headerBand);
    doc.rect(ganttLeft, contentTop, ganttWidth, timelineHeaderH, "F");
    doc.setDrawColor(COLORS.line);
    doc.setLineWidth(0.15);
    let cursor = parseDate(span.start);
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
    const end = parseDate(span.end);
    while (cursor <= end) {
      const next = addMonths(cursor, 1);
      const key = cursor.toISOString().slice(0, 10);
      const x = ganttLeft + Math.max(0, diffDays(span.start, key)) * dayW;
      const x2 = ganttLeft + Math.min(span.days, diffDays(span.start, next.toISOString().slice(0, 10))) * dayW;
      if (x2 > ganttLeft && x < ganttLeft + ganttWidth) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(headerFontSize);
        doc.setTextColor(COLORS.muted);
        const left = Math.max(ganttLeft, x);
        const room = Math.min(x2, ganttLeft + ganttWidth) - left;
        const name = monthLabel(cursor).slice(0, 3);
        const fitted = [name, name[0] ?? ""].find((label) => doc.getTextWidth(label) + 0.6 <= room);
        if (fitted) {
          doc.text(fitted, left + room / 2, contentTop + timelineHeaderH * 0.75, {
            baseline: "middle",
            align: "center",
          });
        }
        const isYearStart = cursor.getUTCMonth() === 0;
        doc.line(left, isYearStart ? contentTop : contentTop + timelineHeaderH / 2, left, contentBottom);
      }
      cursor = next;
    }
    // Year band above the months, labelled wherever the year's slice has room.
    doc.line(ganttLeft, contentTop + timelineHeaderH / 2, ganttLeft + ganttWidth, contentTop + timelineHeaderH / 2);
    const firstYear = parseDate(span.start).getUTCFullYear();
    const lastYear = parseDate(span.end).getUTCFullYear();
    for (let year = firstYear; year <= lastYear; year++) {
      const x = ganttLeft + Math.max(0, diffDays(span.start, `${year}-01-01`)) * dayW;
      const x2 = ganttLeft + Math.min(span.days, diffDays(span.start, `${year + 1}-01-01`)) * dayW;
      const label = String(year);
      if (doc.getTextWidth(label) + 1 <= x2 - x) {
        doc.text(label, (x + x2) / 2, contentTop + timelineHeaderH * 0.25, { baseline: "middle", align: "center" });
      }
    }
    // Table header
    doc.setFillColor(COLORS.headerBand);
    doc.rect(MARGIN, contentTop, tableW, timelineHeaderH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(headerFontSize);
    doc.setTextColor(COLORS.muted);
    const headerY = contentTop + timelineHeaderH / 2;
    doc.text("ID", col.id + CELL_PAD, headerY, { baseline: "middle" });
    doc.text("Task Name", col.name + CELL_PAD, headerY, { baseline: "middle" });
    doc.text("Duration", col.dur + CELL_PAD, headerY, { baseline: "middle" });
    doc.text("Start", col.start + CELL_PAD, headerY, { baseline: "middle" });
    doc.text("Finish", col.finish + CELL_PAD, headerY, { baseline: "middle" });
    doc.setDrawColor(COLORS.line);
    doc.setLineWidth(0.1);
    for (const x of [col.name, col.dur, col.start, col.finish]) doc.line(x, contentTop, x, contentBottom);
  };

  const drawLegend = () => {
    const y = sheet.h - footerH - LEGEND_H + 4;
    const items: Array<{ label: string; draw: (x: number, yy: number) => void }> = [
      {
        label: "Task",
        draw: (x, yy) => {
          doc.setFillColor(COLORS.task);
          doc.rect(x, yy - 1.6, 8, 2.4, "F");
        },
      },
      {
        label: "Summary",
        draw: (x, yy) => {
          doc.setFillColor(COLORS.summaryBar);
          doc.rect(x, yy - 0.7, 8, 1.2, "F");
          doc.triangle(x, yy + 0.5, x + 1.2, yy + 0.5, x + 0.6, yy + 1.6, "F");
          doc.triangle(x + 8, yy + 0.5, x + 6.8, yy + 0.5, x + 7.4, yy + 1.6, "F");
        },
      },
      {
        label: "Milestone",
        draw: (x, yy) => {
          doc.setFillColor(COLORS.milestone);
          doc.triangle(x + 2, yy - 2, x + 4, yy, x + 2, yy + 2, "F");
          doc.triangle(x + 2, yy - 2, x, yy, x + 2, yy + 2, "F");
        },
      },
      {
        label: "Critical",
        draw: (x, yy) => {
          doc.setFillColor(COLORS.critical);
          doc.rect(x, yy - 1.6, 8, 2.4, "F");
        },
      },
      {
        label: "Progress",
        draw: (x, yy) => {
          doc.setFillColor(COLORS.task);
          doc.rect(x, yy - 1.6, 8, 2.4, "F");
          doc.setFillColor(COLORS.progress);
          doc.rect(x, yy - 1.6, 4.5, 2.4, "F");
        },
      },
    ];
    let x = MARGIN;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(COLORS.text);
    for (const item of items) {
      item.draw(x, y);
      doc.text(item.label, x + 10, y + 1);
      x += 38;
    }
  };

  for (let page = 0; page < pages; page++) {
    if (page > 0) doc.addPage([sheet.w, sheet.h], "landscape");
    drawChrome(page + 1);
    drawTimelineHeader();
    drawLegend();

    const slice = tasks.slice(page * rowsPerPage, (page + 1) * rowsPerPage);

    // Dependency lines first (under bars)
    doc.setDrawColor(140, 140, 150);
    doc.setLineWidth(0.12);
    for (let i = 0; i < slice.length; i++) {
      const task = slice[i]!;
      const to = barGeom(task, i);
      for (const pred of predecessorsOf(task)) {
        const predTask = tasks[taskIndex.get(pred.id) ?? -1];
        if (!predTask) continue;
        const predPage = Math.floor((taskIndex.get(pred.id) ?? 0) / rowsPerPage);
        if (predPage !== page) continue;
        const fromRow = (taskIndex.get(pred.id) ?? 0) - page * rowsPerPage;
        const from = barGeom(predTask, fromRow);
        const xStart = predTask.milestone ? from.x0 : from.x1;
        const xEnd = task.milestone ? to.x0 : to.x0;
        const criticalDep = criticalIds.has(task.id) && criticalIds.has(pred.id);
        if (criticalDep) {
          doc.setDrawColor(COLORS.critical);
          doc.setLineWidth(0.25);
        } else {
          doc.setDrawColor(150, 150, 160);
          doc.setLineWidth(0.12);
        }
        const midX = (xStart + xEnd) / 2;
        doc.line(xStart, from.midY, midX, from.midY);
        doc.line(midX, from.midY, midX, to.midY);
        doc.line(midX, to.midY, xEnd, to.midY);
      }
    }

    for (let i = 0; i < slice.length; i++) {
      const task = slice[i]!;
      const y = rowsAreaTop + i * rowH;
      const summary = isSummaryTask(task);
      const criticalTask = criticalIds.has(task.id);
      if (summary) {
        doc.setFillColor(COLORS.summaryBg);
        doc.rect(MARGIN, y, sheet.w - MARGIN * 2, rowH, "F");
      } else if (i % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(MARGIN, y, tableW, rowH, "F");
      }

      doc.setDrawColor(COLORS.line);
      doc.setLineWidth(0.08);
      doc.line(MARGIN, y + rowH, sheet.w - MARGIN, y + rowH);

      const idText = String(i + 1 + page * rowsPerPage);
      const name = printable(taskLabel(task));
      const indent = indentOf(task);
      const textY = y + rowH / 2;
      doc.setFont("helvetica", summary ? "bold" : "normal");
      doc.setFontSize(fontSize);
      doc.setTextColor(COLORS.text);
      doc.text(idText, col.id + CELL_PAD, textY, { baseline: "middle" });
      doc.text(fitText(doc, name, nameW - indent - CELL_PAD * 2), col.name + CELL_PAD + indent, textY, {
        baseline: "middle",
      });
      doc.setFont("helvetica", "normal");
      doc.text(durationLabel(task), col.dur + CELL_PAD, textY, { baseline: "middle" });
      doc.text(task.start ? formatUk(task.start) : "—", col.start + CELL_PAD, textY, { baseline: "middle" });
      doc.text(task.end ? formatUk(task.end) : "—", col.finish + CELL_PAD, textY, { baseline: "middle" });

      const geom = barGeom(task, i);
      if (task.milestone) {
        const s = Math.min(2.2, rowH * 0.35);
        doc.setFillColor(criticalTask ? COLORS.critical : COLORS.milestone);
        doc.triangle(geom.x0, geom.midY - s, geom.x0 + s, geom.midY, geom.x0, geom.midY + s, "F");
        doc.triangle(geom.x0, geom.midY - s, geom.x0 - s, geom.midY, geom.x0, geom.midY + s, "F");
      } else if (summary) {
        const barY = geom.midY - 0.7;
        const w = Math.max(1.5, geom.x1 - geom.x0);
        doc.setFillColor(COLORS.summaryBar);
        doc.rect(geom.x0, barY, w, 1.4, "F");
        doc.triangle(geom.x0, barY + 1.4, geom.x0 + 1.4, barY + 1.4, geom.x0 + 0.7, barY + 2.6, "F");
        doc.triangle(geom.x0 + w, barY + 1.4, geom.x0 + w - 1.4, barY + 1.4, geom.x0 + w - 0.7, barY + 2.6, "F");
      } else {
        const barH = Math.min(3.2, rowH * 0.55);
        const barY = geom.midY - barH / 2;
        const w = Math.max(1.2, geom.x1 - geom.x0);
        doc.setFillColor(criticalTask ? COLORS.critical : COLORS.task);
        doc.roundedRect(geom.x0, barY, w, barH, 0.4, 0.4, "F");
        const progress = typeof task.progress === "number" ? Math.min(1, Math.max(0, task.progress)) : 0;
        if (progress > 0) {
          doc.setFillColor(COLORS.progress);
          doc.roundedRect(geom.x0, barY, Math.max(0.6, w * progress), barH, 0.4, 0.4, "F");
        }
      }
    }

    // Splitter
    doc.setDrawColor(COLORS.line);
    doc.setLineWidth(0.3);
    doc.line(ganttLeft, contentTop, ganttLeft, contentBottom);
  }

  const fileName =
    options?.fileName?.replace(/\.(jantt|pdf)$/i, "") ||
    title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") ||
    "Programme";
  const buffer = doc.output("arraybuffer") as ArrayBuffer;
  return {
    blob: new Blob([new Uint8Array(buffer)], { type: "application/pdf" }),
    sheet: sheetId,
    pages,
    fileName: `${fileName}.pdf`,
  };
}
