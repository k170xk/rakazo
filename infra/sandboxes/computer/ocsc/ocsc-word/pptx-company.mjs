/**
 * The OCSC introduction slides ("about" and "services") drawn natively in the deck's own card
 * style, from the facts on the company template's slides, so they match the styled slides around
 * them and build in like them.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GREEN, INK, MUTED } from "./pptx-native.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export const OFFICES_MAP = join(HERE, "templates", "ocsc-offices-map.png");
/** Pictures shipped with the tool that a slide may use besides workspace files and https URLs. */
export const BUNDLED_IMAGES = new Set([OFFICES_MAP]);

const CARD_TINT = "F3F7F0";
const AREA = { top: 184, bottom: 880, left: 72, right: 1848 };

const OFFICES = ["Dublin", "Cork", "Galway", "Belfast", "London", "Birmingham"];

const FACTS = [
  { value: "35+", label: "Years in practice" },
  { value: "11,000+", label: "Projects delivered" },
  { value: "15", label: "Countries" },
];

const SERVICES = [
  "BIM",
  "Civil",
  "Contracts",
  "Due Diligence",
  "Employer's Representative",
  "Environment & Ecology",
  "Expert Witness",
  "Health & Safety / PSDP",
  "Infrastructure",
  "Mechanical & Electrical",
  "Planning",
  "Project Management",
  "Public Procurement",
  "Strategic Purchase Advice",
  "Structural",
  "Traffic & Transport",
  "Temporary Works & Construction Engineering",
];

const SECTORS = [
  "Bridges",
  "Commercial",
  "Education",
  "Environmental",
  "Health Care",
  "Industrial",
  "Infrastructure",
  "Leisure & Tourism",
  "Multidisciplinary",
  "PSDP",
  "Public Buildings",
  "Refurbishments",
  "Residential",
  "Sustainability",
  "Transport",
];

const card = (x, y, w, h, radius = 14) => ({
  type: "shape",
  shape: "rounded",
  x,
  y,
  w,
  h,
  fill: CARD_TINT,
  radius,
});

const label = (text, x, y, w) => [
  { type: "shape", shape: "rect", x, y, w: 64, h: 6, fill: GREEN },
  {
    type: "text",
    text: text.toUpperCase(),
    x,
    y: y + 20,
    w,
    h: 44,
    size: 20,
    bold: true,
    color: GREEN,
    letter_spacing: 1,
  },
];

function aboutElements() {
  const left = AREA.left;
  const width = 1040;
  const els = [
    {
      type: "text",
      text: "Founded over 35 years ago as a small Dublin structural practice, OCSC is today the leading Irish-owned multidisciplinary consulting engineering firm, advising clients across every sector.",
      x: left,
      y: AREA.top,
      w: width,
      h: 200,
      size: 18,
      color: INK,
      line_height: 1.2,
    },
  ];
  const gap = 20;
  const tileW = (width - gap * (FACTS.length - 1)) / FACTS.length;
  for (const [i, fact] of FACTS.entries()) {
    const x = left + i * (tileW + gap);
    els.push(card(x, 412, tileW, 180, 16));
    els.push({
      type: "text",
      text: fact.value,
      x,
      y: 428,
      w: tileW,
      h: 96,
      size: 38,
      bold: true,
      color: GREEN,
      align: "center",
      valign: "middle",
    });
    els.push({
      type: "text",
      text: fact.label.toUpperCase(),
      x: x + 12,
      y: 528,
      w: tileW - 24,
      h: 44,
      size: 14,
      color: MUTED,
      align: "center",
      letter_spacing: 1,
    });
  }
  els.push(...label("Our offices", left, 632, width));
  const chipW = (width - gap * 2) / 3;
  for (const [i, office] of OFFICES.entries()) {
    const x = left + (i % 3) * (chipW + gap);
    const y = 716 + Math.floor(i / 3) * 88;
    els.push(card(x, y, chipW, 70, 12));
    els.push({ type: "shape", shape: "ellipse", x: x + 26, y: y + 27, w: 16, h: 16, fill: GREEN });
    els.push({
      type: "text",
      text: office,
      x: x + 58,
      y,
      w: chipW - 72,
      h: 70,
      size: 19,
      bold: true,
      color: INK,
      valign: "middle",
    });
  }
  els.push({ type: "image", image: OFFICES_MAP, x: 1200, y: 168, w: 648, h: 720, fit: "contain" });
  return els;
}

const ROW_H = 58;
const LINE_H = 38;

/** A tinted panel listing `items` in two columns, each row led by a green dot; the last row may wrap. */
function listPanel(title, items, x, w) {
  const els = [card(x, AREA.top, w, AREA.bottom - AREA.top, 18)];
  els.push(...label(title, x + 44, AREA.top + 48, w - 88));
  const half = Math.ceil(items.length / 2);
  const colW = (w - 88 - 32) / 2;
  for (const [c, column] of [items.slice(0, half), items.slice(half)].entries())
    for (const [r, item] of column.entries()) {
      const cx = x + 44 + c * (colW + 32);
      const y = AREA.top + 140 + r * ROW_H;
      els.push({
        type: "shape",
        shape: "ellipse",
        x: cx,
        y: y + ROW_H / 2 - 6,
        w: 12,
        h: 12,
        fill: GREEN,
      });
      els.push({
        type: "text",
        text: item,
        x: cx + 28,
        y: y + (ROW_H - LINE_H) / 2,
        w: colW - 28,
        h: r === column.length - 1 ? LINE_H * 2 + 4 : LINE_H,
        size: 16,
        color: INK,
      });
    }
  return els;
}

function servicesElements() {
  const gap = 32;
  const servicesW = 1000;
  return [
    ...listPanel("Services", SERVICES, AREA.left, servicesW),
    ...listPanel(
      "Sectors",
      SECTORS,
      AREA.left + servicesW + gap,
      AREA.right - AREA.left - servicesW - gap,
    ),
  ];
}

const NATIVE_COMPANY = {
  about: () => ({
    heading: "About OCSC",
    subheading: "O'Connor Sutton Cronin: multidisciplinary consulting engineers for over 35 years",
    elements: aboutElements(),
  }),
  services: () => ({
    heading: "Services & Sectors",
    subheading: "What we do, and the sectors we do it for",
    elements: servicesElements(),
  }),
};

/**
 * Swaps the "about" and "services" company slides for native slides in the deck's style when the
 * deck has the template's plain layout; other company slides stay copies of the template's.
 */
export function placeCompany(items, { plain }) {
  if (!plain) return items;
  return items.map((item) => {
    const make = item && typeof item === "object" && NATIVE_COMPANY[item.include];
    if (!make) return item;
    const { include, ...rest } = item;
    return { ...rest, layout: "custom", ...make() };
  });
}
