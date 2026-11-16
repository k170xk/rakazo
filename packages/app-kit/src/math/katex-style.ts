import ams from "katex/dist/fonts/KaTeX_AMS-Regular.woff2" with { type: "bytes" };
import mainBold from "katex/dist/fonts/KaTeX_Main-Bold.woff2" with { type: "bytes" };
import mainItalic from "katex/dist/fonts/KaTeX_Main-Italic.woff2" with { type: "bytes" };
import mainRegular from "katex/dist/fonts/KaTeX_Main-Regular.woff2" with { type: "bytes" };
import mathBoldItalic from "katex/dist/fonts/KaTeX_Math-BoldItalic.woff2" with { type: "bytes" };
import mathItalic from "katex/dist/fonts/KaTeX_Math-Italic.woff2" with { type: "bytes" };
import size1 from "katex/dist/fonts/KaTeX_Size1-Regular.woff2" with { type: "bytes" };
import size2 from "katex/dist/fonts/KaTeX_Size2-Regular.woff2" with { type: "bytes" };
import size3 from "katex/dist/fonts/KaTeX_Size3-Regular.woff2" with { type: "bytes" };
import size4 from "katex/dist/fonts/KaTeX_Size4-Regular.woff2" with { type: "bytes" };
import katexCss from "katex/dist/katex.min.css" with { type: "text" };

export type FontFile = {
  family: string;
  weight: number;
  style: "normal" | "italic";
  bytes: unknown;
};

/**
 * The faces calculation sheets use (roman, italic, bold, symbols, big delimiters). Script,
 * Fraktur, sans and typewriter letters fall back to the page font to keep apps small.
 */
const FONTS: FontFile[] = [
  { family: "KaTeX_Main", weight: 400, style: "normal", bytes: mainRegular },
  { family: "KaTeX_Main", weight: 700, style: "normal", bytes: mainBold },
  { family: "KaTeX_Main", weight: 400, style: "italic", bytes: mainItalic },
  { family: "KaTeX_Math", weight: 400, style: "italic", bytes: mathItalic },
  { family: "KaTeX_Math", weight: 700, style: "italic", bytes: mathBoldItalic },
  { family: "KaTeX_AMS", weight: 400, style: "normal", bytes: ams },
  { family: "KaTeX_Size1", weight: 400, style: "normal", bytes: size1 },
  { family: "KaTeX_Size2", weight: 400, style: "normal", bytes: size2 },
  { family: "KaTeX_Size3", weight: 400, style: "normal", bytes: size3 },
  { family: "KaTeX_Size4", weight: 400, style: "normal", bytes: size4 },
];

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const PRINT = "@media print{.katex,.katex-display{break-inside:avoid;color:#000}}";

/**
 * The stylesheet with the bundled faces as data URIs. The sandbox only loads data: fonts, so the
 * stylesheet's own font URLs are dropped; faces that arrive as anything but bytes are skipped.
 */
export function katexStylesheet(css: unknown = katexCss, fonts: FontFile[] = FONTS): string {
  const rules = typeof css === "string" ? css.replace(/@font-face\{[^}]*\}/g, "") : "";
  const faces = fonts
    .filter((font) => font.bytes instanceof Uint8Array)
    .map(
      (font) =>
        `@font-face{font-family:${font.family};font-style:${font.style};font-weight:${font.weight};font-display:block;src:url(data:font/woff2;base64,${base64(font.bytes as Uint8Array)}) format("woff2")}`,
    );
  return `${faces.join("")}${rules}${PRINT}`;
}

let injected = false;

/** Adds the stylesheet to the page once, the first time math is shown. */
export function ensureKatexStyle() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const style = document.createElement("style");
  style.dataset.ocsc = "math";
  style.textContent = katexStylesheet();
  document.head.appendChild(style);
}
