export const APPEARANCE_PREFERENCES = ["system", "light", "dark"] as const;

export type AppearancePreference = (typeof APPEARANCE_PREFERENCES)[number];

export type ResolvedAppearance = "light" | "dark";

export const UI_APPEARANCE_STORAGE_KEY = "rakazo.uiAppearance";

/**
 * Semantic palette shared by web, Electron, and Expo. Names follow the shadcn
 * convention so the same slot means the same thing on every surface: a `border`
 * is always a border and never a fill.
 */
export type ColorTokens = {
  background: string;
  /** Modals: a step lighter than the page so they read as raised above it. */
  dialog: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  /** Fill and hairline where native Liquid Glass is unavailable (Android, iOS before 26). */
  glassFill: string;
  glassStroke: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  chatUser: string;
  /** White in both themes: the user bubble is a solid fill (light grey in dark, near-black in light). */
  chatUserForeground: string;
  muted: string;
  mutedForeground: string;
  /** Tertiary text: placeholders, list markers, quote bars, timestamps. */
  faintForeground: string;
  accent: string;
  accentForeground: string;
  /** Destructive text and outlines. */
  destructive: string;
  /** Solid destructive fill (Hang up, a filled Delete); its text is `destructiveForeground`. */
  destructiveFill: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarBorder: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  link: string;
  /** Backing behind a link's site icon. White in both themes so dark logos stay visible on any bubble. */
  faviconPlate: string;
  success: string;
  warning: string;
  statusWorking: string;
  /** Unread dot. The one blue in the inbox, in both themes. */
  unread: string;
  /** Working dot on a busy bot's avatar. The one green, in both themes. */
  workingDot: string;
  overlay: string;
  scrollbar: string;
  scrollbarHover: string;
  /** The folded page icon a chat names a page with: its sheet, edge, fold and two text lines. */
  pageIconSheet: string;
  pageIconEdge: string;
  pageIconFold: string;
  pageIconLine: string;
  pageIconLineSoft: string;
  /** The rounded page tile on a page card's footer: fill, edge and its text lines. */
  pageTile: string;
  pageTileEdge: string;
  pageTileLine: string;
};

export const darkTokens = {
  background: "#141414",
  dialog: "#1E1E1E",
  foreground: "#FFFFFF",
  card: "#202020",
  cardForeground: "#FFFFFF",
  popover: "#202020",
  popoverForeground: "#FFFFFF",
  glassFill: "#2C2C2E",
  glassStroke: "#FCFCFC26",
  primary: "#FFFFFF",
  primaryForeground: "#000000",
  secondary: "#7676803D",
  secondaryForeground: "#FFFFFF",
  chatUser: "#5C5C5C",
  chatUserForeground: "#FFFFFF",
  muted: "#202020",
  mutedForeground: "#EBEBF599",
  faintForeground: "#EBEBF573",
  accent: "#78788052",
  accentForeground: "#FFFFFF",
  destructive: "#FF9592",
  destructiveFill: "#E5484D",
  destructiveForeground: "#FFFFFF",
  border: "#FCFCFC14",
  input: "#54545899",
  ring: "#3B82F6",
  sidebar: "#1E1E1E",
  sidebarForeground: "#FFFFFF",
  sidebarBorder: "#FCFCFC14",
  sidebarAccent: "#2B2B2E",
  sidebarAccentForeground: "#FFFFFF",
  link: "#459FFE",
  faviconPlate: "#FFFFFF",
  success: "#3FA266",
  warning: "#DB941E",
  statusWorking: "#459FFE",
  unread: "#006CEB",
  workingDot: "#3FA266",
  overlay: "rgba(0, 0, 0, 0.28)",
  scrollbar: "#1E2026",
  scrollbarHover: "#2E313A",
  pageIconSheet: "#2C2C2E",
  pageIconEdge: "#363638",
  pageIconFold: "#3C3C3E",
  pageIconLine: "#6F6F71",
  pageIconLineSoft: "#616163",
  pageTile: "#343434",
  pageTileEdge: "#414141",
  pageTileLine: "#626262",
} as const satisfies ColorTokens;

export const lightTokens = {
  background: "#FCFCFC",
  dialog: "#FFFFFF",
  foreground: "#000000",
  card: "#EFEFEF",
  cardForeground: "#000000",
  popover: "#FFFFFF",
  popoverForeground: "#000000",
  glassFill: "#FFFFFF",
  glassStroke: "#14141416",
  primary: "#000000",
  primaryForeground: "#FFFFFF",
  secondary: "#7676801F",
  secondaryForeground: "#000000",
  chatUser: "#0B0B0B",
  chatUserForeground: "#FFFFFF",
  muted: "#F2F2F1",
  mutedForeground: "#3C3C43B3",
  faintForeground: "#3C3C4394",
  accent: "#78788029",
  accentForeground: "#000000",
  destructive: "#CE2C31",
  destructiveFill: "#E5484D",
  destructiveForeground: "#FFFFFF",
  border: "#14141414",
  input: "#3C3C434A",
  ring: "#6C6C70",
  sidebar: "#F7F7F7",
  sidebarForeground: "#000000",
  sidebarBorder: "#14141414",
  sidebarAccent: "#FFFFFF",
  sidebarAccentForeground: "#000000",
  link: "#0C64C1",
  faviconPlate: "#FFFFFF",
  success: "#007041",
  warning: "#885A07",
  statusWorking: "#0C64C1",
  unread: "#006CEB",
  workingDot: "#3FA266",
  overlay: "rgba(0, 0, 0, 0.19)",
  scrollbar: "#C8C8C4",
  scrollbarHover: "#A8A8A4",
  pageIconSheet: "#E8E8EA",
  pageIconEdge: "#D6D6DA",
  pageIconFold: "#D0D0D4",
  pageIconLine: "#8E8E93",
  pageIconLineSoft: "#A1A1A6",
  pageTile: "#ECECEE",
  pageTileEdge: "#DADADD",
  pageTileLine: "#A1A1A6",
} as const satisfies ColorTokens;

/** Web and Electron only: the primary fill's hover and disabled states. Mobile has no hover. */
export type WebColorTokens = ColorTokens & {
  primaryHover: string;
  primaryDisabled: string;
};

/**
 * Web and Electron values for the tokens they draw differently from the palettes above, which
 * follow the iOS system design for mobile. Mobile reads `darkTokens` / `lightTokens`; web reads
 * `tokens.css`, rendered from these merged palettes.
 *
 * They follow OCSC Evolve's theme (ocsc-cv-generator src/index.css) so both apps look like one
 * product: brand green for primary actions, focus rings and the person's own messages, slate
 * greys in light mode and Evolve's #141414 / #4C4C4C greys in dark mode.
 */
export const OCSC_GREEN = "#76BF43";

export const webDarkOverrides = {
  background: "#141414",
  dialog: "#1A1A1A",
  foreground: "#FFFFFF",
  card: "#1F1F1F",
  cardForeground: "#FFFFFF",
  popover: "#1A1A1A",
  popoverForeground: "#FFFFFF",
  primary: OCSC_GREEN,
  primaryHover: "#86CB55",
  primaryDisabled: "#76BF4340",
  primaryForeground: "#FFFFFF",
  secondary: "#333333",
  secondaryForeground: "#FFFFFF",
  chatUser: OCSC_GREEN,
  chatUserForeground: "#FFFFFF",
  muted: "#262626",
  mutedForeground: "#CCCCCC",
  faintForeground: "#999999",
  accent: "#333333",
  accentForeground: "#FFFFFF",
  destructive: "#FF6463",
  destructiveFill: "#CF2B35",
  border: "#3A3A3A",
  input: "#4C4C4C",
  ring: OCSC_GREEN,
  sidebar: "#1A1A1A",
  sidebarForeground: "#FFFFFF",
  sidebarBorder: "#404040",
  sidebarAccent: "#333333",
  sidebarAccentForeground: "#FFFFFF",
  link: "#8FD15F",
  success: OCSC_GREEN,
  warning: "#E28600",
  statusWorking: OCSC_GREEN,
  unread: "#4D9BFF",
  workingDot: OCSC_GREEN,
  overlay: "#000000B2",
  scrollbar: "#FFFFFF38",
  scrollbarHover: "#FFFFFF80",
} as const satisfies Partial<WebColorTokens>;

export const webLightOverrides = {
  background: "#FFFFFF",
  foreground: "#020817",
  card: "#F1F5F9",
  cardForeground: "#020817",
  popoverForeground: "#020817",
  primary: OCSC_GREEN,
  primaryHover: "#68AB3A",
  primaryDisabled: "#76BF4359",
  primaryForeground: "#FFFFFF",
  secondary: "#F1F5F9",
  secondaryForeground: "#0F172A",
  chatUser: OCSC_GREEN,
  muted: "#F1F5F9",
  mutedForeground: "#5E6E84",
  faintForeground: "#94A3B8",
  accent: "#F1F5F9",
  accentForeground: "#0F172A",
  destructive: "#C81E1E",
  destructiveFill: "#EF4444",
  border: "#E2E8F0",
  input: "#CBD5E1",
  ring: OCSC_GREEN,
  sidebar: "#FAFAFA",
  sidebarForeground: "#3F3F46",
  sidebarBorder: "#E5E7EB",
  sidebarAccent: "#F4F4F5",
  sidebarAccentForeground: "#18181B",
  link: "#3B7A1F",
  success: "#3B7A1F",
  warning: "#AA6300",
  statusWorking: OCSC_GREEN,
  unread: "#0B6DD3",
  workingDot: OCSC_GREEN,
  overlay: "#00000080",
  scrollbar: "#0F172A3D",
  scrollbarHover: "#0F172A85",
} as const satisfies Partial<WebColorTokens>;

export const webDarkTokens: WebColorTokens = { ...darkTokens, ...webDarkOverrides };
export const webLightTokens: WebColorTokens = { ...lightTokens, ...webLightOverrides };

/** Dark palette. Prefer `tokensForAppearance` when theme-aware. */
export const tokens = darkTokens;

/** OCSC Evolve's corner radius. */
export const RADIUS = "0.5rem";

export const fontWeight = { regular: "400", medium: "500", semibold: "600" } as const;

/**
 * Native text styles on the system font, in points: iOS body text is 17/22. Titles use the
 * font's own line spacing, written out so they don't inherit a smaller body line height.
 */
export const typeScale = {
  title: { fontSize: 22, lineHeight: 26, fontWeight: fontWeight.semibold },
  headline: { fontSize: 19, lineHeight: 23, fontWeight: fontWeight.semibold },
  cardTitle: { fontSize: 17, lineHeight: 22, fontWeight: fontWeight.medium },
  body: { fontSize: 17, lineHeight: 22 },
  secondary: { fontSize: 15, lineHeight: 19 },
  caption: { fontSize: 14, lineHeight: 18 },
  footnote: { fontSize: 12, lineHeight: 16 },
} as const;

/**
 * Text grows with the iOS text size until body text reaches 23pt, the xxxLarge size. Larger
 * accessibility sizes keep that size, so message bubbles, rows and cards keep their layout.
 */
export const MAX_FONT_SCALE = 23 / typeScale.body.fontSize;

/**
 * The rising bars on the page icon, the same in both themes. The folded icon was measured from
 * the chat chip; the card footer's tile draws them a little brighter.
 */
export const pageIconBars = ["#489D61", "#E7712E", "#BC3B3D", "#3E82F3"] as const;
export const pageTileBars = ["#5AC078", "#E9993A", "#E87031", "#3E82F4"] as const;

/**
 * Bot-built pages: data series and status tones for the sandboxed page document.
 * Primary actions, links, info accents and the first chart series use OCSC brand green
 * (#76BF43) so chat pages read as Evolve apps, not a generic blue/black kit.
 */
export const pageKitPalette = {
  dark: {
    c1: OCSC_GREEN,
    c2: "#FF9800",
    c3: "#00BCA6",
    c4: "#69D290",
    c5: "#E76265",
    rest: "#3B7A1F",
    area: ".24",
    other: "#777777",
    negative: "#FF263C",
    seq1: "#3B7A1F",
    seq2: "#68AB3A",
    seq3: OCSC_GREEN,
    seq4: "#86CB55",
    seq5: "#A8DB7A",
    success: "#38D591",
    warning: "#FFAF38",
    danger: "#FF5667",
    accent: "#8FD15F",
    accentDeep: "#A8DB7A",
    successDeep: "#78e2b4",
    warningDeep: "#ffc878",
    dangerDeep: "#ff8c98",
    div1: "#FF5667",
    div2: "#82131F",
    div3: "#262626",
    div4: "#3B7A1F",
    div5: OCSC_GREEN,
    fillStrong: "rgba(119,119,119,.17)",
    cardSurface: "#181818",
    cardShadowNear: "#0006",
    cardShadowFar: "#0000004d",
    controlFill: "#7777772c",
    controlHoverFill: "#77777747",
    buttonFill: OCSC_GREEN,
    buttonHoverFill: "#86CB55",
    buttonInk: "#FFFFFF",
    optionFill: "#181818",
    checkedFill: OCSC_GREEN,
  },
  light: {
    c1: OCSC_GREEN,
    c2: "#FF9800",
    c3: "#00BCA6",
    c4: "#009957",
    c5: "#C21D2E",
    rest: "#A8DB7A",
    area: ".16",
    other: "#777777",
    negative: "#FF263C",
    seq1: "#A8DB7A",
    seq2: "#86CB55",
    seq3: OCSC_GREEN,
    seq4: "#68AB3A",
    seq5: "#3B7A1F",
    // Tone inks are text too, so on white and on their own tint they hold 4.5:1.
    success: "#006B3C",
    warning: "#8A5100",
    danger: "#B01A2A",
    accent: "#3B7A1F",
    accentDeep: "#2F6218",
    successDeep: "#00673a",
    warningDeep: "#824e00",
    dangerDeep: "#82131f",
    div1: "#C21D2E",
    div2: "#FF8C98",
    div3: "#E8E8E8",
    div4: "#A8DB7A",
    div5: "#3B7A1F",
    fillStrong: "rgba(119,119,119,.11)",
    cardSurface: "#fcfcfc",
    cardShadowNear: "#0000000f",
    cardShadowFar: "#00000012",
    controlFill: "#77777717",
    controlHoverFill: "#77777726",
    buttonFill: OCSC_GREEN,
    buttonHoverFill: "#68AB3A",
    buttonInk: "#FFFFFF",
    optionFill: "#fcfcfc",
    checkedFill: OCSC_GREEN,
  },
  // The same in both themes: ink on colour, the print paper and shadows.
  shared: {
    onColor: "#fcfcfc",
    onTone: "#121212",
    onDeepTone: "#fff",
    paper: "#fff",
    mask: "#000",
    tipShadow: "rgba(0,0,0,.18)",
    dotShadow: "#00000059",
  },
} as const;

/** Code highlighting in editors, One Dark and One Light so code reads as it does elsewhere. */
export const codeSyntaxColors = {
  dark: {
    keyword: "#c678dd",
    string: "#98c379",
    number: "#d19a66",
    comment: "#7f848e",
    function: "#61afef",
    type: "#e5c07b",
    tag: "#e06c75",
    attribute: "#d19a66",
    punctuation: "#abb2bf",
    definition: "#e06c75",
    invalid: "#ff6b6b",
    searchMatch: "#e5c07b",
  },
  light: {
    keyword: "#a626a4",
    string: "#50a14f",
    number: "#986801",
    comment: "#a0a1a7",
    function: "#4078f2",
    type: "#c18401",
    tag: "#e45649",
    attribute: "#986801",
    punctuation: "#383a42",
    definition: "#e45649",
    invalid: "#e45649",
    searchMatch: "#c18401",
  },
} as const;

/** The ink of a drawn bot's eyes, the same on every body colour and in both themes. */
export const botEyeColor = "#101014";

export const botColors = [
  "#3EC5A8",
  "#F5A03C",
  "#6A6BF5",
  "#9B5CF6",
  "#3B82F6",
  "#F2622A",
  "#D9508A",
] as const;

export function isAppearancePreference(
  value: string | null | undefined,
): value is AppearancePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function normalizeAppearancePreference(
  raw: string | null | undefined,
): AppearancePreference {
  return isAppearancePreference(raw) ? raw : "system";
}

export type ResolveAppearancePreferenceOptions = {
  stored?: string | null;
  storage?: Pick<Storage, "getItem"> | null;
};

function getLocalStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function resolveAppearancePreference(
  options: ResolveAppearancePreferenceOptions = {},
): AppearancePreference {
  const stored =
    options.stored !== undefined
      ? options.stored
      : readStoredAppearance(options.storage ?? getLocalStorage());
  return normalizeAppearancePreference(stored);
}

export function persistAppearancePreference(
  preference: AppearancePreference,
  storage: Pick<Storage, "setItem"> | null = getLocalStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(UI_APPEARANCE_STORAGE_KEY, preference);
  } catch {
    // Ignore quota / private-mode failures; in-memory preference still applies.
  }
}

export function resolveAppearance(
  preference: AppearancePreference,
  system: ResolvedAppearance = "dark",
): ResolvedAppearance {
  if (preference === "system") return system;
  return preference;
}

export function tokensForAppearance(appearance: ResolvedAppearance): ColorTokens {
  return appearance === "light" ? lightTokens : darkTokens;
}

/** The web and Electron palette; `tokensForAppearance` is the mobile one. */
export function webTokensForAppearance(appearance: ResolvedAppearance): WebColorTokens {
  return appearance === "light" ? webLightTokens : webDarkTokens;
}

function readStoredAppearance(storage: Pick<Storage, "getItem"> | null | undefined): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(UI_APPEARANCE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** `cardForeground` -> `--card-foreground` */
export function cssVariableName(token: keyof WebColorTokens): string {
  return `--${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function renderBlock(selector: string, colorScheme: ResolvedAppearance, palette: WebColorTokens) {
  const lines = (Object.keys(palette) as (keyof WebColorTokens)[]).map(
    (token) => `  ${cssVariableName(token)}: ${palette[token].toLowerCase()};`,
  );
  return `${selector} {\n  color-scheme: ${colorScheme};\n${lines.join("\n")}\n  --radius: ${RADIUS};\n}`;
}

/** The CSS in `tokens.css` (web and Electron). Generated from the web palettes so both stay in sync. */
export function renderTokensCss(): string {
  return `${[
    "/* Generated by `pnpm --filter @rakazo/ui-tokens generate`. Edit src/index.ts instead. */",
    renderBlock(':root,\n[data-theme="dark"]', "dark", webDarkTokens),
    renderBlock('[data-theme="light"]', "light", webLightTokens),
  ].join("\n\n")}\n`;
}
