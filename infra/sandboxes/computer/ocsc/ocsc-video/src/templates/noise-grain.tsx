// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  num,
  type Palette,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "noise-grain",
  category: "background",
  description:
    "A flickering film-grain texture. Best as an overlay to give footage or photos a filmic feel; as a scene it draws the grain over a white (or dark OCSC) background.",
  props: {
    heading: 'string: centred under the grain when used as a scene, empty for none (default "")',
    subheading: 'string: under the heading, empty for none (default "")',
    intensity: "number: grain strength, 0.02 to 0.4 (default 0.1)",
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 6,
  media: "an overlay on photos or footage",
  fits: "Nothing to write; strength only.",
  instead: "film-burn for a warmer, stronger look.",
  overlay: true,
};

type Props = BrandProps & {
  heading?: string;
  subheading?: string;
  intensity?: number;
  dark?: boolean;
  /** Set by the overlay layer, so only the grain draws over the scene underneath. */
  asOverlay?: boolean;
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

export default function NoiseGrain(props: Props) {
  const frame = useCurrentFrame();
  const { width, height } = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const intensity = Math.max(0.02, Math.min(0.4, num(props.intensity, 0.1)));
  const filterId = "ocsc-noise-grain";

  return (
    <Stage background={props.asOverlay ? undefined : dark ? p.darkGradient : p.lightGradient}>
      {props.asOverlay ? null : (
        <Heading heading={str(props.heading, "")} subheading={str(props.subheading, "")} p={p} dark={dark} />
      )}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: "absolute", inset: 0, opacity: intensity, pointerEvents: "none" }}
      >
        <filter id={filterId} x="0" y="0" width="100%" height="100%">
          {/* A new seed every frame makes the grain flicker like film; the same frame always renders the same grain. */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.85"
            numOctaves={2}
            seed={frame % 997}
            stitchTiles="stitch"
          />
          <feColorMatrix
            type="matrix"
            values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 0 1"
          />
          <feComponentTransfer>
            <feFuncR type="linear" slope="2" intercept="-0.5" />
            <feFuncG type="linear" slope="2" intercept="-0.5" />
            <feFuncB type="linear" slope="2" intercept="-0.5" />
          </feComponentTransfer>
        </filter>
        <rect width={width} height={height} filter={`url(#${filterId})`} />
      </svg>
    </Stage>
  );
}
