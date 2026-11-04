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
  name: "logo-bounce-drop",
  category: "logo",
  description:
    "The OCSC logo drops in from above, lands with a squash-and-stretch bounce and the OCSC sectors fade in underneath. Use it for an upbeat, energetic brand opener.",
  props: {
    text: 'string: line under the logo (default the OCSC sectors on two lines: Civil · Structural · Mechanical · Electrical, then Environmental · Sustainability · BIM; \\n starts a new line). Never "Multidisciplinary Consulting Engineers": the logo already says it',
    logoWidth: "number: logo width in stage px (default 360)",
    dark: "boolean: dark OCSC background with the on-dark logo; false for the light version (default false: white)",
  },
  seconds: 4,
  media: "none",
  fits: "The OCSC logo and up to two lines of sectors.",
  instead: "logo-fade-reveal for a calmer opening. Use one logo reveal per video.",
  ownLogo: true,
};

type Props = BrandProps & {
  text?: string;
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

export default function LogoBounceDrop(props: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const width = Math.min(num(props.logoWidth, 360), stage.width - 80);
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

  const drop = spring({ frame, fps, config: { damping: 8, stiffness: 120, mass: 0.8 } });
  const translateY = interpolate(drop, [0, 1], [-stage.height * 0.4, 0]);

  // Squash and stretch on landing.
  const squash = spring({
    frame: frame - 8,
    fps,
    config: { damping: 6, stiffness: 200, mass: 0.5 },
  });
  const scaleX = interpolate(squash, [0, 0.5, 1], [1.3, 1.1, 1]);
  const scaleY = interpolate(squash, [0, 0.5, 1], [0.7, 0.9, 1]);

  // A soft shadow on the "floor" that tightens as the logo lands.
  const shadow = interpolate(drop, [0, 1], [0.2, 1], clamp);

  const nameOpacity = interpolate(frame, [25, 40], [0, 1], clamp);
  const nameY = interpolate(frame, [25, 40], [20, 0], clamp);

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
        }}
      >
        <div
          style={{
            transform: `translateY(${translateY}px) scaleX(${scaleX}) scaleY(${scaleY})`,
            transformOrigin: "50% 100%",
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
            width: width * 0.7 * shadow,
            height: 10,
            marginTop: 8,
            borderRadius: "50%",
            background: `radial-gradient(ellipse at center, ${alpha(dark ? "#000000" : p.dark, 0.35 * shadow)}, transparent 70%)`,
          }}
        />
        <div
          style={{
            color: dark ? p.onDark : p.text,
            fontSize: stage.vertical ? 24 : 29,
            fontWeight: 700,
            marginTop: 16,
            textAlign: "center",
            lineHeight: 1.3,
            opacity: nameOpacity,
            transform: `translateY(${nameY}px)`,
            maxWidth: stage.width - 120,
            ...BALANCED
          }}
        >
          {str(props.text, OCSC_SECTORS_TWO_LINES)}
        </div>
      </div>
    </Stage>
  );
}
