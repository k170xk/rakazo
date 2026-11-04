// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  num,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
  OCSC_SECTORS_TWO_LINES,
  BALANCED,
} from "./kit";

const LOGO_RATIO = 2.65;

export const meta: TemplateMeta = {
  name: "logo-fade-reveal",
  category: "logo",
  description:
    "The OCSC logo fades and grows gently into place with a soft green glow, followed by the OCSC sectors underneath. Use it as a clean, professional opening or end card.",
  props: {
    text: 'string: main line under the logo (default the OCSC sectors on two lines: Civil · Structural · Mechanical · Electrical, then Environmental · Sustainability · BIM; \\n starts a new line). Never "Multidisciplinary Consulting Engineers": the logo already says it',
    tagline: 'string: smaller line below, e.g. the project or a location (default none)',
    logoWidth: "number: logo width in stage px (default 360)",
    dark: "boolean: dark OCSC background with the on-dark logo; false for the light version (default false: white)",
  },
  seconds: 4,
  media: "none",
  fits: "The OCSC logo, up to two lines of sectors and an optional smaller line.",
  instead: "title for an opening that also names the project. Use one logo reveal per video.",
  ownLogo: true,
};

type Props = BrandProps & {
  text?: string;
  tagline?: string;
  logoWidth?: number;
  dark?: boolean;
};

function Logo({ src, width, color }: { src?: string; width: number; color: string }) {
  const height = width / LOGO_RATIO;
  if (!src)
    return (
      <div
        style={{
          width,
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color,
          fontSize: height * 0.6,
          fontWeight: 800,
        }}
      >
        OCSC
      </div>
    );
  return <Img src={src} style={{ width, height, objectFit: "contain", display: "block" }} />;
}

export default function LogoFadeReveal(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const width = Math.min(num(props.logoWidth, 360), stage.width - 80);

  const logo = spring({ frame, fps, config: { damping: 12, stiffness: 80, mass: 0.8 } });
  const text = spring({
    frame: frame - 15,
    fps,
    config: { damping: 14, stiffness: 60, mass: 0.6 },
  });
  const drift = interpolate(frame, [0, durationInFrames], [1, 1.03], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: "0 40px",
          textAlign: "center",
          transform: `scale(${drift})`,
        }}
      >
        <div
          style={{
            opacity: logo,
            transform: `scale(${0.8 + 0.2 * logo})`,
            filter: `drop-shadow(0 0 40px ${alpha(p.primary, 0.3)})`,
          }}
        >
          <Logo
            src={dark ? props.logoOnDarkUrl : props.logoUrl}
            width={width}
            color={p.primary}
          />
        </div>
        <div
          style={{
            color: dark ? p.onDark : p.text,
            fontSize: stage.vertical ? 26 : 32,
            fontWeight: 700,
            marginTop: 24,
            letterSpacing: "0.03em",
            lineHeight: 1.25,
            opacity: text,
            transform: `translateY(${20 * (1 - text)}px)`,
            maxWidth: stage.width - 120,
            ...BALANCED
          }}
        >
          {str(props.text, OCSC_SECTORS_TWO_LINES)}
        </div>
        {typeof props.tagline === "string" && props.tagline.trim() ? (
        <div
          style={{
            color: dark ? p.lighter : p.textMuted,
            fontSize: 16,
            marginTop: 8,
            letterSpacing: "0.06em",
            lineHeight: 1.4,
            opacity: text,
            transform: `translateY(${20 * (1 - text)}px)`,
          }}
        >
          {props.tagline}
        </div>
        ) : null}
      </div>
    </Stage>
  );
}
