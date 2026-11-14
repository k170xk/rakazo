/**
 * Colours the ribbon writes into documents. They are document data, not interface colours, so they
 * live here rather than in the components that show them.
 */

/** Ten hues across, as the swatch grid shows them, then lighter and darker steps. */
export const SWATCHES: readonly string[] = [
  "#000000",
  "#434343",
  "#666666",
  "#999999",
  "#B7B7B7",
  "#D9D9D9",
  "#EFEFEF",
  "#FFFFFF",
  "#76BF43",
  "#1F3864",
  "#C00000",
  "#FF0000",
  "#FFC000",
  "#FFFF00",
  "#92D050",
  "#00B050",
  "#00B0F0",
  "#0070C0",
  "#002060",
  "#7030A0",
  "#F4CCCC",
  "#FCE5CD",
  "#FFF2CC",
  "#D9EAD3",
  "#D0E0E3",
  "#CFE2F3",
  "#D9D2E9",
  "#EAD1DC",
  "#E2EFDA",
  "#DDEBF7",
  "#990000",
  "#B45F06",
  "#BF9000",
  "#38761D",
  "#134F5C",
  "#0B5394",
  "#351C75",
  "#741B47",
  "#375623",
  "#203764",
];

/** The colours each picker applies before anything else is chosen. */
export const DEFAULT_TEXT_COLOR = "#C00000";
export const DEFAULT_HIGHLIGHT = "#FFFF00";
export const DEFAULT_FILL = "#FFFF00";
export const DEFAULT_SHAPE_FILL = "#76BF43";
export const DEFAULT_OUTLINE = "#1F2937";

/** `#RRGGBB` in capitals, or null for anything that is not a six-digit colour. */
export function normalizeHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const hex = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toUpperCase()}`;
  if (/^[0-9a-f]{8}$/i.test(hex)) return `#${hex.slice(2).toUpperCase()}`;
  return null;
}
