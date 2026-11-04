// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  type Palette,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "matrix-rain",
  category: "background",
  description:
    "A green 'data rain' of digits and engineering symbols falling in columns over white (or the dark OCSC background). Use it behind digital engineering, BIM, data or modelling content.",
  props: {
    heading: 'string: centred over the background, empty for none (default "")',
    subheading: 'string: under the heading, empty for none (default "")',
    characters: 'string: the symbols that fall (default "0123456789+−×÷=±√πΣΔΩ°∫≈")',
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 6,
  media: "none",
  fits: "A heading of up to 6 words and a short subheading.",
  instead: "Use it mostly for digital engineering, BIM, data and modelling topics.",
};

type Props = BrandProps & {
  heading?: string;
  subheading?: string;
  characters?: string;
  dark?: boolean;
};

function Heading({
  heading,
  subheading,
  p,
  dark,
}: {
  heading: string;
  subheading: string;
  p: Palette;
  dark: boolean;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stage = useStage();
  if (!heading && !subheading) return null;
  const enter = spring({ frame: frame - 8, fps, config: { damping: 16, mass: 0.7 } });
  const shadow = dark ? `0 2px 24px ${alpha(p.ink, 0.8)}` : "0 1px 18px rgba(255, 255, 255, 0.9)";
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: "0 40px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        opacity: enter,
        transform: `translateY(${(1 - enter) * 24}px)`,
      }}
    >
      {heading ? (
        <div
          style={{
            color: dark ? p.onDark : p.text,
            fontSize: stage.vertical ? 40 : 52,
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: "-0.01em",
            textShadow: shadow,
          }}
        >
          {heading}
        </div>
      ) : null}
      {subheading ? (
        <div
          style={{
            color: dark ? p.lighter : p.textMuted,
            fontSize: stage.vertical ? 18 : 22,
            fontWeight: 500,
            marginTop: heading ? 14 : 0,
            letterSpacing: "0.02em",
            textShadow: shadow,
          }}
        >
          {subheading}
        </div>
      ) : null}
    </div>
  );
}

const COLUMN = 20;
const ROW = 22;

export default function MatrixRain(props: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { width, height } = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const characters = Array.from(str(props.characters, "0123456789+−×÷=±√πΣΔΩ°∫≈"));
  const t = frame / fps;
  const columns = Math.floor(width / COLUMN);
  // Symbols change a few times a second rather than every frame, so the rain reads calmly.
  const tick = Math.floor(frame / Math.max(1, Math.round(fps / 5)));

  const cells: { x: number; y: number; char: string; opacity: number; head: boolean; key: string }[] = [];
  for (let i = 0; i < columns; i++) {
    const trail = 5 + Math.floor(random(`rain-trail-${i}`) * 8);
    const speed = 50 + random(`rain-speed-${i}`) * 110;
    const span = height + trail * ROW;
    const headY = (random(`rain-start-${i}`) * span + t * speed) % span;
    for (let j = 0; j < trail; j++) {
      const y = headY - j * ROW;
      if (y < -ROW || y > height) continue;
      const pick = random(`rain-char-${i}-${j}-${tick + j}`);
      cells.push({
        x: i * COLUMN,
        y,
        char: characters[Math.floor(pick * characters.length)] ?? "0",
        opacity: (1 - j / trail) * 0.75 * (1 - (y / height) * 0.4),
        head: j === 0,
        key: `${i}-${j}`,
      });
    }
  }

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      {cells.map((cell) => (
        <div
          key={cell.key}
          style={{
            position: "absolute",
            left: cell.x,
            top: cell.y,
            width: COLUMN,
            textAlign: "center",
            color: cell.head ? (dark ? p.lighter : p.dark) : p.primary,
            opacity: dark ? cell.opacity : cell.opacity * 0.7,
            fontSize: 18,
            fontWeight: 700,
            lineHeight: `${ROW}px`,
            fontVariantNumeric: "tabular-nums",
            textShadow: dark ? `0 0 8px ${alpha(p.primary, 0.8)}` : undefined,
          }}
        >
          {cell.char}
        </div>
      ))}
      <Heading heading={str(props.heading, "")} subheading={str(props.subheading, "")} p={p} dark={dark} />
    </Stage>
  );
}
