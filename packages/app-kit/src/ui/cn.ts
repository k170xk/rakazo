import type { Tone } from "../schema.js";

type ClassValue = string | false | null | undefined | 0;

const TEXT_SIZE = /^text-(?:xs|sm|base|lg|[2-9]?xl|\[\d)/;
const TEXT_ALIGN = /^text-(?:left|center|right|justify|start|end)$/;
const BG_OTHER =
  /^bg-(?:cover|contain|auto|center|top|bottom|left|right|fixed|local|scroll|repeat|no-repeat|clip-|origin-|blend-|\[length|\[position|\[size|grid|linear-|radial-|conic-|gradient)/;
const DISPLAY =
  /^(?:block|inline|inline-block|flex|inline-flex|grid|inline-grid|hidden|contents|table)$/;
const FONT_WEIGHT = /^font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/;
const SPACING =
  /^-?(p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|gap-x|gap-y|gap|w|h|size|min-w|min-h|max-w|max-h|top|right|bottom|left|inset-x|inset-y|inset|z|opacity|rounded(?=-(?:none|sm|md|lg|xl|2xl|3xl|full|\[))|shadow|leading|tracking|order|basis|grow|shrink)-/;

/** Which utilities a class competes with, so the later one wins (text-red over text-foreground). */
function conflictGroup(name: string): string | null {
  const bracket = name.lastIndexOf("]");
  const colon = name.lastIndexOf(":");
  const split =
    colon > bracket
      ? colon
      : name.slice(0, name.indexOf("[") === -1 ? name.length : name.indexOf("[")).lastIndexOf(":");
  const variant = split > -1 ? name.slice(0, split + 1) : "";
  const base = name.slice(variant.length).replace(/^!/, "");
  let group: string | null = null;
  if (DISPLAY.test(base)) group = "display";
  else if (FONT_WEIGHT.test(base)) group = "font-weight";
  else if (base.startsWith("text-"))
    group = TEXT_SIZE.test(base)
      ? "text-size"
      : TEXT_ALIGN.test(base)
        ? "text-align"
        : "text-color";
  else if (base.startsWith("bg-")) group = BG_OTHER.test(base) ? null : "bg-color";
  else if (
    /^border-(?!\d|\[\d|x|y|s-|e-|t-|r-|b-|l-|[trblxyse]$|solid|dashed|dotted|double|none|collapse|separate|spacing)/.test(
      base,
    )
  )
    group = "border-color";
  else if (/^(?:justify|items|self|content)-/.test(base)) group = base.split("-")[0] ?? null;
  else if (/^flex-(?:row|col)/.test(base)) group = "flex-direction";
  else {
    const match = SPACING.exec(base);
    if (match) group = match[1] ?? null;
  }
  return group ? `${variant}${group}` : null;
}

/** Joins class names, skipping empty ones; a later class replaces an earlier one it conflicts with. */
export function cn(...values: ClassValue[]): string {
  const classes = values.filter(Boolean).join(" ").split(/\s+/).filter(Boolean);
  const seen = new Map<string, number>();
  const keep: Array<string | null> = [];
  for (const name of classes) {
    const group = conflictGroup(name);
    if (group) {
      const earlier = seen.get(group);
      if (earlier !== undefined) keep[earlier] = null;
      seen.set(group, keep.length);
    }
    keep.push(name);
  }
  return keep.filter(Boolean).join(" ");
}

export const ease = [0.22, 1, 0.36, 1] as const;

/** Motion presets every component shares, so the whole app moves the same way. */
export const motionPresets = {
  fadeUp: {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, ease },
  },
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.2 },
  },
  pop: {
    initial: { opacity: 0, scale: 0.96, y: 6 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.97, y: 4 },
    transition: { type: "spring", stiffness: 420, damping: 32 },
  },
  spring: { type: "spring", stiffness: 380, damping: 30 },
} as const;

/** Staggered entrance for lists and grids: spread container on the parent, item on children. */
export const stagger = {
  container: {
    initial: "hidden",
    animate: "show",
    variants: { hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } } },
  },
  item: {
    variants: {
      hidden: { opacity: 0, y: 12 },
      show: { opacity: 1, y: 0, transition: { duration: 0.45, ease } },
    },
  },
} as const;

export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground ring-border",
  success: "bg-success/12 text-success ring-success/25",
  warning: "bg-warning/14 text-[hsl(32_90%_38%)] dark:text-warning ring-warning/30",
  danger: "bg-destructive/12 text-destructive ring-destructive/25",
  info: "bg-info/12 text-info ring-info/25",
  accent: "bg-primary/14 text-[hsl(95_55%_32%)] dark:text-primary ring-primary/30",
};

export const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground/60",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
  accent: "bg-primary",
};

const TONE_WORDS: Array<[RegExp, Tone]> = [
  [
    /^(done|complete(d)?|approved|paid|active|open|won|live|yes|on track|signed|passed|green|issued|closed won)$/i,
    "success",
  ],
  [
    /(overdue|late|blocked|rejected|failed|lost|cancel+ed|red|critical|high risk|at risk|expired|unpaid)/i,
    "danger",
  ],
  [
    /(pending|review|waiting|draft|amber|hold|in progress|progress|due|medium|submitted|tender)/i,
    "warning",
  ],
  [/(new|planned|scheduled|info|proposed|lead)/i, "info"],
];

/** A tone for a status word, so imported statuses get sensible colours without setup. */
export function toneFor(value: unknown, fallback: Tone = "neutral"): Tone {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  for (const [pattern, tone] of TONE_WORDS) if (pattern.test(text)) return tone;
  return fallback;
}

export const CHART_COLORS = [1, 2, 3, 4, 5, 6].map((index) => `hsl(var(--chart-${index}))`);
