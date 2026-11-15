/**
 * What the chat beside Evolve PDF Studio is told about the person's view: the page, the ribbon
 * tab and tool, the part of the drawing on screen, where they last clicked, and what they have
 * selected. Every position is in the app's points (PDF points from the page's top-left at 100%
 * zoom, y downward), the same units as the ocsc-pdf-studio tools, so the assistant can place
 * markups exactly where the person points.
 */

export type PdfRect = { x: number; y: number; width: number; height: number };

/** A selected markup as the app's `pdf_context` describes it; `id` survives saving. */
export type PdfMarkup = {
  id: string;
  type?: string;
  page?: number;
  bounds?: PdfRect;
  text?: string;
} & Record<string, unknown>;

/** The answer of the app's `pdf_context` tool (evolve/ai-tools.js in the app). */
export type PdfAppContext = {
  document?: {
    fileName?: string;
    pageCount?: number;
    modified?: boolean;
    readOnly?: boolean;
    revision?: string;
  };
  page?: { number?: number; width?: number; height?: number; viewRotation?: number };
  view?: { mode?: string; zoomPercent?: number; visible?: PdfRect | null };
  ribbonTab?: { id?: string; label?: string } | null;
  tool?: string | null;
  selectedCount?: number;
  selected?: PdfMarkup[];
  selectedText?: { page: number; text: string; rects?: PdfRect[] } | null;
  lastClick?: { page: number; x: number; y: number; secondsAgo?: number } | null;
  measureScale?: { unit?: string; ratio?: string; pointsPerUnit?: number } | null;
  editing?: boolean;
};

/** Per markup, so a long polyline's points can't crowd the others out of the chat's note. */
export const MARKUP_JSON_MAX = 600;
/** Selected text quoted in the note. */
const SELECTED_TEXT_MAX = 1500;
/** The longest side of the selection picture, in pixels. */
const PICTURE_MAX_PX = 1600;
const PICTURE_MAX_DPI = 200;

const pt = (value: number) => String(Math.round(value));

function rectText(rect: PdfRect): string {
  return `x ${pt(rect.x)}, y ${pt(rect.y)}, ${pt(rect.width)} x ${pt(rect.height)} pt`;
}

/** The tool id as words: "measureDistance" -> "measure distance". */
function toolName(tool: string): string {
  return tool.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

/** One line on where the person is: page, sheet size, ribbon tab, tool and zoom. */
export function pdfWhere(context: PdfAppContext | null): string | null {
  const page = context?.page?.number;
  const count = context?.document?.pageCount;
  if (!page || !count) return null;
  const parts = [`page ${page} of ${count}`];
  const { width, height } = context.page ?? {};
  if (width && height) parts[0] += ` (${pt(width)} x ${pt(height)} pt)`;
  const tab = context.ribbonTab?.label;
  if (tab) parts.push(`the ${tab} tab`);
  if (context.tool && context.tool !== "select") parts.push(`the ${toolName(context.tool)} tool`);
  const zoom = context.view?.zoomPercent;
  if (zoom) parts.push(`${zoom}% zoom`);
  return parts.join(", ");
}

/** What is on screen there: the visible area, the last click, the selected text and the scale. */
export function pdfDetail(context: PdfAppContext | null): string | null {
  if (!context?.page?.number) return null;
  const lines: string[] = [];
  const visible = context.view?.visible;
  if (visible) {
    const whole =
      context.page.width &&
      context.page.height &&
      visible.width >= context.page.width - 1 &&
      visible.height >= context.page.height - 1;
    lines.push(`Visible on screen: ${rectText(visible)}${whole ? " (the whole page)" : ""}.`);
  }
  const click = context.lastClick;
  if (click) {
    const ago = click.secondsAgo !== undefined ? ` ${click.secondsAgo} s ago` : "";
    lines.push(
      `They last clicked page ${click.page} at x ${pt(click.x)}, y ${pt(click.y)}${ago}; "here" or "this spot" means that point.`,
    );
  }
  const text = context.selectedText;
  if (text?.text && context.selected?.length) {
    lines.push(`Selected text on page ${text.page}: "${text.text.slice(0, 300)}".`);
  }
  const scale = context.measureScale;
  if (scale?.ratio || scale?.unit) {
    lines.push(
      `Drawing scale: ${[scale.ratio, scale.unit ? `measured in ${scale.unit}` : ""].filter(Boolean).join(", ")}.`,
    );
  }
  return lines.length ? lines.join("\n") : null;
}

/** The selected markups (or, with none, the selected text) for the chat's note. */
export function pdfSelection(
  context: PdfAppContext | null,
): { kind: "markups"; count: number; content: string } | { kind: "text"; content: string } | null {
  const markups = context?.selected ?? [];
  if (markups.length) {
    const count = Math.max(context?.selectedCount ?? 0, markups.length);
    const lines = markups.map((markup) => JSON.stringify(markup).slice(0, MARKUP_JSON_MAX));
    if (count > markups.length) lines.push(`(${count - markups.length} more selected, not listed)`);
    return { kind: "markups", count, content: lines.join("\n") };
  }
  const text = context?.selectedText;
  if (text?.text?.trim()) {
    const where = text.rects?.length ? ` at ${rectText(unionRect(text.rects)!)}` : "";
    return {
      kind: "text",
      content: `On page ${text.page}${where}: "${text.text.trim().slice(0, SELECTED_TEXT_MAX)}"`,
    };
  }
  return null;
}

export function unionRect(rects: readonly PdfRect[]): PdfRect | null {
  if (!rects.length) return null;
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The `pdf_capture_region` input for a picture of the selection with some room around it, or
 * null without one. Only markups on one page are pictured, the first selected one's page.
 */
export function selectionCapture(
  context: PdfAppContext | null,
): { page: number; x: number; y: number; width: number; height: number; dpi: number } | null {
  const markups = context?.selected ?? [];
  let page: number | undefined;
  let rects: PdfRect[] = [];
  if (markups.length) {
    page = markups[0]!.page ?? context?.page?.number;
    rects = markups
      .filter((markup) => (markup.page ?? page) === page && markup.bounds)
      .map((markup) => markup.bounds!);
  } else if (context?.selectedText?.rects?.length) {
    page = context.selectedText.page;
    rects = context.selectedText.rects;
  }
  const box = unionRect(rects);
  if (!page || !box) return null;
  const pad = Math.max(40, Math.max(box.width, box.height) * 0.15);
  const pageWidth = context?.page?.number === page ? context.page.width : undefined;
  const pageHeight = context?.page?.number === page ? context.page.height : undefined;
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const right = pageWidth ? Math.min(pageWidth, box.x + box.width + pad) : box.x + box.width + pad;
  const bottom = pageHeight
    ? Math.min(pageHeight, box.y + box.height + pad)
    : box.y + box.height + pad;
  const width = Math.max(1, right - x);
  const height = Math.max(1, bottom - y);
  const dpi = Math.max(
    18,
    Math.min(PICTURE_MAX_DPI, Math.floor((PICTURE_MAX_PX * 72) / Math.max(width, height))),
  );
  return {
    page,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    dpi,
  };
}

/** What changes the chat's note; the edit fingerprint and saved state do not. */
export function noteKey(context: PdfAppContext | null): string {
  if (!context) return "";
  const { document: _document, editing: _editing, lastClick, ...shown } = context;
  return JSON.stringify({
    ...shown,
    pageCount: context.document?.pageCount,
    lastClick: lastClick ? [lastClick.page, lastClick.x, lastClick.y] : null,
  });
}

/** Below this shorter screen side a touch device is a phone; the app then shows its phone layout. */
export const PHONE_SHORT_SIDE = 600;

type ScreenWindow = Pick<Window, "matchMedia"> & { screen: Pick<Screen, "width" | "height"> };

/**
 * Whether the PDF app shows its phone layout (evolve/host.js isPhoneScreen in the app): a touch
 * screen whose shorter side is under PHONE_SHORT_SIDE. That layout has no bar along the bottom,
 * so the floating composer needs no lift.
 */
export function isPhoneScreen(win: ScreenWindow | undefined = globalThis.window): boolean {
  if (!win?.screen || typeof win.matchMedia !== "function") return false;
  const shortSide = Math.min(win.screen.width || Infinity, win.screen.height || Infinity);
  return shortSide < PHONE_SHORT_SIDE && win.matchMedia("(pointer: coarse)").matches;
}
