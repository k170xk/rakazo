import type { LucideIcon } from "lucide-react";
import * as Lucide from "lucide-react";

/**
 * Resolves an arbitrary icon hint string from the AI (e.g. "check", "lightbulb",
 * "rocket", "✓", "⚡", "shield-check") into a Lucide React icon component.
 *
 * The video is rendered in headless Chromium which does NOT have a colour
 * emoji font installed, so unicode emojis render as blank tofu boxes. Lucide
 * icons are pure SVG and render reliably in every environment, so we map
 * everything to a Lucide component.
 */

// Common synonyms / emoji → canonical lucide name.
const ALIASES: Record<string, string> = {
  // ticks / done
  "✓": "check",
  "✔": "check",
  "✅": "check-circle-2",
  check: "check",
  done: "check",
  tick: "check",
  yes: "check-circle-2",
  success: "check-circle-2",

  // crosses / negative
  "✗": "x",
  "✘": "x",
  "❌": "x-circle",
  no: "x-circle",
  cross: "x",
  fail: "x-circle",
  failure: "x-circle",

  // stars / quality
  "★": "star",
  "⭐": "star",
  star: "star",
  quality: "award",
  premium: "crown",
  award: "award",
  trophy: "trophy",

  // speed / energy
  "⚡": "zap",
  "⚡️": "zap",
  fast: "zap",
  speed: "zap",
  quick: "zap",
  rapid: "zap",
  energy: "zap",
  power: "zap",

  // ideas
  "💡": "lightbulb",
  idea: "lightbulb",
  innovation: "lightbulb",
  insight: "lightbulb",

  // rocket / launch
  "🚀": "rocket",
  launch: "rocket",
  growth: "trending-up",

  // shield / safety
  "🛡": "shield",
  "🛡️": "shield",
  safe: "shield-check",
  safety: "shield-check",
  secure: "shield-check",
  security: "shield",
  protect: "shield",

  // time / clock
  "⏱": "timer",
  "⏰": "alarm-clock",
  "🕐": "clock",
  time: "clock",
  schedule: "calendar",
  deadline: "calendar-clock",

  // people / team
  "👥": "users",
  "👤": "user",
  team: "users",
  people: "users",
  user: "user",
  client: "user-round",
  customer: "user-round",

  // money / value
  "💰": "banknote",
  "💵": "banknote",
  "💲": "dollar-sign",
  "€": "euro",
  "£": "pound-sterling",
  cost: "banknote",
  budget: "wallet",
  value: "banknote",
  price: "tag",
  saving: "piggy-bank",
  savings: "piggy-bank",

  // location / building
  "📍": "map-pin",
  "🏢": "building-2",
  "🏗": "construction",
  "🏗️": "construction",
  location: "map-pin",
  site: "map-pin",
  office: "building-2",
  building: "building-2",
  construction: "construction",
  project: "building-2",

  // tools / engineering
  "🔧": "wrench",
  "🛠": "wrench",
  "🛠️": "wrench",
  "⚙": "settings",
  "⚙️": "settings",
  tools: "wrench",
  engineering: "wrench",
  mechanical: "cog",
  electrical: "plug",
  civil: "construction",
  structural: "building-2",
  sustainability: "leaf",
  environment: "leaf",
  eco: "leaf",
  green: "leaf",

  // documents
  "📄": "file-text",
  "📋": "clipboard-list",
  "📑": "files",
  document: "file-text",
  report: "file-text",
  doc: "file-text",
  spec: "file-text",

  // charts / data
  "📊": "bar-chart-3",
  "📈": "trending-up",
  "📉": "trending-down",
  data: "bar-chart-3",
  chart: "bar-chart-3",
  analytics: "bar-chart-3",
  metric: "bar-chart-3",

  // comms
  "📞": "phone",
  "📧": "mail",
  "✉": "mail",
  "✉️": "mail",
  email: "mail",
  phone: "phone",
  call: "phone",
  contact: "contact",

  // misc
  "🎯": "target",
  goal: "target",
  target: "target",
  objective: "target",
  "✨": "sparkles",
  feature: "sparkles",
  highlight: "sparkles",
  "🔍": "search",
  search: "search",
  review: "search",
  audit: "search-check",
  "🤝": "handshake",
  partnership: "handshake",
  collaboration: "handshake",
  "❤": "heart",
  "❤️": "heart",
  "🔒": "lock",
  "🔓": "unlock",
  "🌐": "globe",
  global: "globe",
  international: "globe",
  "📱": "smartphone",
  mobile: "smartphone",
  app: "smartphone",
  "💻": "laptop",
  "🖥": "monitor",
  "🖥️": "monitor",
  software: "laptop",
  digital: "laptop",
  tech: "cpu",
  technology: "cpu",
  ai: "sparkles",
  cloud: "cloud",
  database: "database",
  api: "code",
  code: "code-2",
};

const FALLBACK: LucideIcon = Lucide.Sparkles;

/** Convert "check-circle-2" / "check_circle" / "CheckCircle2" → "CheckCircle2". */
function toPascal(name: string): string {
  return name
    .replace(/[\s_-]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, (_, c: string) => c.toUpperCase());
}

export function resolveIcon(hint: string | undefined | null): LucideIcon {
  if (!hint) return FALLBACK;
  const raw = String(hint).trim();
  if (!raw) return FALLBACK;

  // 1. Direct alias / emoji match (case-insensitive lookup of full string).
  const direct = ALIASES[raw] || ALIASES[raw.toLowerCase()];
  const candidate = direct || raw;

  // 2. Try Lucide named export from canonical alias or raw hint.
  const pascal = toPascal(candidate.replace(/[^\w\s_-]/g, "").toLowerCase());
  const found = (Lucide as unknown as Record<string, LucideIcon>)[pascal];
  if (found && typeof found === "function") return found;

  // 3. Try first word only (e.g. "fast delivery" → "Fast" then "Zap" via alias).
  const firstWord = raw.split(/\s+/)[0];
  if (firstWord && firstWord !== raw) {
    return resolveIcon(firstWord);
  }

  return FALLBACK;
}
