// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Easing, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
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
  name: "logo-split-reveal",
  category: "logo",
  description:
    "A green seam opens at the centre and the two halves of the OCSC logo slide outwards from it into place, followed by the OCSC sectors. Use it for a crisp, architectural brand opener.",
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

export default function LogoSplitReveal(props: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const width = Math.min(num(props.logoWidth, 360), stage.width - 80);
  const height = width / LOGO_RATIO;
  const half = width / 2;
  const src = dark ? props.logoOnDarkUrl : props.logoUrl;
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

  const reveal = interpolate(frame, [10, fps * 1.5], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  // The seam draws in first, then fades once the halves have opened.
  const seamHeight = interpolate(frame, [0, 12], [0, height * 1.3], clamp);
  const seamOpacity = interpolate(reveal, [0.7, 1], [1, 0], clamp);

  const nameOpacity = interpolate(frame, [fps * 1.6, fps * 2.2], [0, 1], clamp);
  const nameY = interpolate(frame, [fps * 1.6, fps * 2.2], [15, 0], clamp);

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
        }}
      >
        <div style={{ position: "relative", width, height, display: "flex" }}>
          {/* Each half sits in its own window and slides out from the centre seam. */}
          <div style={{ width: half, height, overflow: "hidden", position: "relative" }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                transform: `translateX(${(1 - reveal) * half}px)`,
                opacity: reveal,
              }}
            >
              <Logo src={src} width={width} color={p.primary} />
            </div>
          </div>
          <div style={{ width: half, height, overflow: "hidden", position: "relative" }}>
            <div
              style={{
                position: "absolute",
                left: -half,
                top: 0,
                transform: `translateX(${-(1 - reveal) * half}px)`,
                opacity: reveal,
              }}
            >
              <Logo src={src} width={width} color={p.primary} />
            </div>
          </div>
          <div
            style={{
              position: "absolute",
              left: half - 1.5,
              top: (height - seamHeight) / 2,
              width: 3,
              height: seamHeight,
              borderRadius: 2,
              background: `linear-gradient(180deg, ${p.light}, ${p.primary})`,
              opacity: seamOpacity,
            }}
          />
        </div>
        <div
          style={{
            color: dark ? p.onDark : p.text,
            fontSize: stage.vertical ? 24 : 29,
            fontWeight: 700,
            marginTop: 24,
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
