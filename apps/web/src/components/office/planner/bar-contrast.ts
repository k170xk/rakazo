/** Parse the computed/inline CSS colours Jantt writes on bars: rgb()/rgba() or #rgb/#rrggbb. */
function parseColor(value: string): [number, number, number] | null {
  const rgb = value.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * True when dark text reads better than white on this bar colour (WCAG contrast).
 * 0.179 is where black and white give equal contrast.
 */
export function prefersDarkText(background: string): boolean {
  const color = parseColor(background);
  return color ? luminance(color) > 0.179 : false;
}
