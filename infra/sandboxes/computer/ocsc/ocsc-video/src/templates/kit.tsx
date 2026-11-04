/**
 * The shared kit for the motion templates, adapted from Remotion Templates by RVE
 * (https://www.reactvideoeditor.com/remotion-templates, MIT licence).
 *
 * Every template draws on a 960-wide stage (540 wide for a vertical video) that is scaled up to the
 * video's real size, so the same template is sharp at 1080p and 4K. Colours come from `palette()`.
 */
import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";

export const OCSC_GREEN = "#76bf43";
export const OCSC_INK = "#102a0a";
export const FONT = "Inter, Arial, sans-serif";
/** The default line under the logo. The logo already reads "Multidisciplinary Consulting Engineers". */
export const OCSC_SECTORS = "Civil · Structural · Mechanical · Electrical · Environmental · Sustainability · BIM";
/** The sectors on two lines, for under the logo. */
export const OCSC_SECTORS_TWO_LINES = "Civil · Structural · Mechanical · Electrical\nEnvironmental · Sustainability · BIM";
/** Keeps line breaks in the text and wraps long lines into even rows. */
export const BALANCED = { textWrap: "balance", whiteSpace: "pre-line" } as CSSProperties;

/** Every template receives its own props plus these. */
export type BrandProps = {
  brandColor?: string;
  /** The OCSC logo for light backgrounds. */
  logoUrl?: string;
  /** The OCSC logo for dark backgrounds (white lettering). */
  logoOnDarkUrl?: string;
};

export type TemplateCategory =
  | "charts"
  | "text"
  | "content"
  | "background"
  | "cinematic"
  | "logo"
  | "intro"
  | "media"
  // The cinematic shot library (adapted from video-shotcraft, 1920x1080 stage).
  | "opening"
  | "camera"
  | "shot-transition"
  | "typography"
  | "ui"
  | "interaction"
  | "data"
  | "effects"
  | "rhythm"
  | "outro";

export type TemplateMeta = {
  name: string;
  category: TemplateCategory;
  /** One line: what it shows and when to use it. */
  description: string;
  /** Each prop the Bot can set, with its type and default, e.g. "value: number (default 1247)". */
  props: Record<string, string>;
  /** A good length on screen. */
  seconds: number;
  /** True when the background is transparent, so it can sit over another scene as an overlay. */
  overlay?: boolean;
  /** "shot" for the cinematic shot library: fixed choreography, timed for 30 fps. */
  kind?: "template" | "shot";
  /** What it needs: "none", "photo", "photos" or "an overlay on footage". */
  media?: string;
  /** How much content fits on screen. */
  fits?: string;
  /** Which scene to pick instead, and when. */
  instead?: string;
  /** A full-frame photo or video, drawn edge to edge without the skyline footer, like the image scene. */
  fullBleed?: boolean;
  /** Draws the OCSC logo itself, so the corner logo is left off. */
  ownLogo?: boolean;
};

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

function rgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const n = Number.parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [118, 191, 67];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Mixes a colour towards another; amount 0 keeps it, 1 is the other colour. */
export function mix(from: string, to: string, amount: number): string {
  const a = rgb(from);
  const b = rgb(to);
  return hex([
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ]);
}

/** The colour with an alpha, for shadows, glows and translucent panels. */
export function alpha(color: string, a: number): string {
  const [r, g, b] = rgb(color);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export type Palette = {
  /** The brand colour: OCSC green unless the spec sets brandColor. */
  primary: string;
  light: string;
  lighter: string;
  /** The brand colour again: OCSC uses one green, so no darker shade. */
  dark: string;
  /** Deep backgrounds. */
  ink: string;
  inkSoft: string;
  /** Light backgrounds. */
  paper: string;
  paperAlt: string;
  /** Text on light and dark backgrounds. */
  text: string;
  textMuted: string;
  onDark: string;
  onDarkMuted: string;
  /** A neutral second series colour for charts, beside the brand colour. */
  slate: string;
  /** Series colours for charts, brand first. */
  series: string[];
  /** Ready-made backgrounds. */
  darkGradient: string;
  brandGradient: string;
  lightGradient: string;
};

export function palette(brandColor: string = OCSC_GREEN): Palette {
  const primary = /^#[0-9a-f]{3,6}$/i.test(brandColor)
    ? brandColor
    : OCSC_GREEN;
  const ink = OCSC_INK;
  const inkSoft = mix(ink, primary, 0.18);
  return {
    primary,
    light: mix(primary, "#ffffff", 0.35),
    lighter: mix(primary, "#ffffff", 0.75),
    dark: primary,
    ink,
    inkSoft,
    paper: "#ffffff",
    paperAlt: mix(primary, "#ffffff", 0.92),
    text: "#0f172a",
    textMuted: "#6b7280",
    onDark: "#ffffff",
    onDarkMuted: "rgba(255, 255, 255, 0.72)",
    slate: "#64748b",
    series: [
      primary,
      "#94a3b8",
      mix(primary, "#ffffff", 0.45),
      "#475569",
      mix(primary, "#ffffff", 0.72),
      "#cbd5e1",
    ],
    darkGradient: `linear-gradient(135deg, ${ink} 0%, ${inkSoft} 100%)`,
    brandGradient: `linear-gradient(135deg, ${primary} 0%, ${primary} 100%)`,
    lightGradient: "#ffffff",
  };
}

/**
 * Video pixels kept clear at the bottom of the frame for the skyline footer. The video sets it on
 * branded scenes; the stage is shortened by it, so templates lay out above the footer.
 */
export const FooterSpace = createContext(0);

/** The stage's size in stage pixels: 960 wide (540 for vertical), with the video's aspect ratio. */
export function useStage() {
  const video = useVideoConfig();
  const footer = useContext(FooterSpace);
  const base = video.width >= video.height ? 960 : 540;
  const scale = video.width / base;
  return {
    ...video,
    width: base,
    height: Math.round((video.height - footer) / scale),
    scale,
    vertical: video.height > video.width,
  };
}

/**
 * The template's canvas. Draw in stage pixels; it is scaled to the video. `background` fills the
 * whole frame; leave it out for an overlay.
 */
export const Stage: React.FC<{
  background?: string;
  style?: CSSProperties;
  children: ReactNode;
}> = ({ background, style, children }) => {
  const stage = useStage();
  return (
    <AbsoluteFill style={{ background, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: stage.width,
          height: stage.height,
          transform: `scale(${stage.scale})`,
          transformOrigin: "0 0",
          fontFamily: FONT,
          overflow: "hidden",
          ...style,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

/** Text props arrive as strings, numbers or nothing; this keeps a template from printing "undefined". */
export const str = (v: unknown, fallback: string): string =>
  typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : fallback;

export const num = (v: unknown, fallback: number): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
};

export function list<T>(v: unknown, fallback: T[]): T[] {
  return Array.isArray(v) && v.length ? (v as T[]) : fallback;
}

/**
 * The canvas for the cinematic shots, which are choreographed on a fixed 1920x1080 frame. The shot
 * is scaled to fit the video and letterboxed on OCSC ink when the video is vertical or square.
 */
export const ShotStage: React.FC<{ background?: string; children: ReactNode }> = ({
  background = OCSC_INK,
  children,
}) => {
  const { width, height } = useVideoConfig();
  const scale = Math.min(width / 1920, height / 1080);
  return (
    <AbsoluteFill style={{ background, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: (width - 1920 * scale) / 2,
          top: (height - 1080 * scale) / 2,
          width: 1920,
          height: 1080,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
          fontFamily: FONT,
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};
