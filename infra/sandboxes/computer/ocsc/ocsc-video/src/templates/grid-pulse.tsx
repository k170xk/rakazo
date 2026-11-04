// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
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
  name: "grid-pulse",
  category: "background",
  description:
    "A grid of green dots with a gentle pulse rippling out from the centre, like a survey grid, on white (or the dark OCSC background). Use it behind a title or a technical statement.",
  props: {
    heading: 'string: centred over the background, empty for none (default "")',
    subheading: 'string: under the heading, empty for none (default "")',
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 6,
  media: "none",
  fits: "A heading of up to 6 words and a short subheading.",
  instead: "matrix-rain for digital engineering and BIM.",
};

type Props = BrandProps & {
  heading?: string;
  subheading?: string;
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

export default function GridPulse(props: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { width, height, vertical } = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const cols = vertical ? 7 : 12;
  const rows = vertical ? 12 : 8;
  const dotSize = 10;
  const spacingX = width / (cols + 1);
  const spacingY = height / (rows + 1);
  const centerCol = (cols - 1) / 2;
  const centerRow = (rows - 1) / 2;
  const t = frame / fps;

  const dots = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const dx = col - centerCol;
      const dy = row - centerRow;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const wave = Math.sin(t * 3 - distance * 0.8) * 0.5 + 0.5;
      dots.push({
        x: spacingX * (col + 1),
        y: spacingY * (row + 1),
        // Kept quieter than the original so a heading reads clearly on top.
        opacity: 0.12 + wave * 0.6,
        scale: 0.4 + wave * 0.6,
        key: row * cols + col,
      });
    }
  }

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      {dots.map((dot) => (
        <div
          key={dot.key}
          style={{
            position: "absolute",
            left: dot.x,
            top: dot.y,
            width: dotSize,
            height: dotSize,
            borderRadius: "50%",
            backgroundColor: p.primary,
            opacity: dot.opacity,
            transform: `translate(-50%, -50%) scale(${dot.scale})`,
          }}
        />
      ))}
      <Heading heading={str(props.heading, "")} subheading={str(props.subheading, "")} p={p} dark={dark} />
    </Stage>
  );
}
