// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  mix,
  type Palette,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
  OCSC_SECTORS,
} from "./kit";

export const meta: TemplateMeta = {
  name: "pixel-transition",
  category: "background",
  description:
    "A grid of green pixel blocks dissolves at random to reveal a heading on the OCSC background, and can pixelate closed again at the end. Use it to open a section or hand over to the next scene.",
  props: {
    heading: `string: revealed under the pixels, empty for none (default "O'Connor Sutton Cronin")`,
    subheading: 'string: under the heading, empty for none (default "Civil · Structural · Mechanical · Electrical · Environmental · Sustainability · BIM")',
    outro: "boolean: pixels cover the frame again over the last second (default true)",
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 5,
  media: "none",
  fits: "A heading of up to 5 words and a subheading.",
  instead: "section_header for a standard section opening.",
};

type Props = BrandProps & {
  heading?: string;
  subheading?: string;
  outro?: boolean;
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
  const shadow = dark ? `0 2px 24px ${alpha(p.ink, 0.8)}` : undefined;
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

const PIXEL = 20;

export default function PixelTransition(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { width, height } = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const cols = Math.ceil(width / PIXEL);
  const rows = Math.ceil(height / PIXEL);
  const reveal = Math.round(fps * 1.4);
  const fade = 6;
  const outroLength = Math.round(fps);
  // The outro only runs when there is time to hold the heading between reveal and cover.
  const hasOutro = props.outro !== false && durationInFrames > reveal + outroLength + fps;
  const outroStart = durationInFrames - outroLength - 1;

  const pixels = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const seed = `pixel-${x}-${y}`;
      const delay = random(seed) * (reveal - fade);
      const out = interpolate(frame, [delay, delay + fade], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      const backDelay = outroStart + random(`${seed}-back`) * (outroLength - fade);
      const back = hasOutro
        ? interpolate(frame, [backDelay, backDelay + fade], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        : 0;
      const cover = Math.max(out, back);
      if (cover <= 0) continue;
      pixels.push({
        x: x * PIXEL,
        y: y * PIXEL,
        cover,
        color: dark
          ? mix(p.primary, p.ink, 0.15 + random(`${seed}-shade`) * 0.7)
          : mix(p.primary, "#ffffff", 0.2 + random(`${seed}-shade`) * 0.7),
        key: y * cols + x,
      });
    }
  }

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      <Heading
        dark={dark}
        heading={props.heading === "" ? "" : str(props.heading, "O'Connor Sutton Cronin")}
        subheading={
          props.subheading === ""
            ? ""
            : str(props.subheading, OCSC_SECTORS)
        }
        p={p}
      />
      {pixels.map((pixel) => (
        <div
          key={pixel.key}
          style={{
            position: "absolute",
            left: pixel.x,
            top: pixel.y,
            width: PIXEL,
            height: PIXEL,
            backgroundColor: pixel.color,
            opacity: pixel.cover,
            transform: `scale(${0.6 + pixel.cover * 0.4})`,
          }}
        />
      ))}
    </Stage>
  );
}
