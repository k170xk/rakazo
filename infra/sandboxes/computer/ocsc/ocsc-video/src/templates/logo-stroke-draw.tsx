// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
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
// Drawn in the logo image's own coordinates, so the outlines sit over its lettering.
const VIEW_W = 1024;
const VIEW_H = VIEW_W / LOGO_RATIO;
const LETTERS = [
  { char: "O", x: 197 },
  { char: "C", x: 415 },
  { char: "S", x: 610 },
  { char: "C", x: 806 },
];
// Longer than any glyph outline at this size, so each letter draws completely.
const DASH = 1600;

export const meta: TemplateMeta = {
  name: "logo-stroke-draw",
  category: "logo",
  description:
    "The letters OCSC are drawn as green outlines one after another, then the real OCSC logo fades in over them with the OCSC sectors underneath. Use it for a considered, design-led brand opener.",
  props: {
    text: 'string: line under the logo (default the OCSC sectors on two lines: Civil · Structural · Mechanical · Electrical, then Environmental · Sustainability · BIM; \\n starts a new line). Never "Multidisciplinary Consulting Engineers": the logo already says it',
    logoWidth: "number: logo width in stage px (default 360)",
    dark: "boolean: dark OCSC background with the on-dark logo; false for the light version (default false: white)",
  },
  seconds: 5,
  media: "none",
  fits: "The OCSC logo and up to two lines of sectors.",
  instead: "logo-fade-reveal for a quicker opening. Use one logo reveal per video.",
  ownLogo: true,
};

type Props = BrandProps & {
  text?: string;
  logoWidth?: number;
  dark?: boolean;
};

export default function LogoStrokeDraw(props: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const width = Math.min(num(props.logoWidth, 360), stage.width - 80);
  const height = width / LOGO_RATIO;
  const src = dark ? props.logoOnDarkUrl : props.logoUrl;
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

  const fill = interpolate(frame, [fps * 1.4, fps * 1.9], [0, 0.25], clamp);
  const outlineOpacity = interpolate(frame, [fps * 1.9, fps * 2.5], [1, 0], clamp);
  const logoOpacity = interpolate(frame, [fps * 1.8, fps * 2.4], [0, 1], clamp);
  const nameOpacity = interpolate(frame, [fps * 2.2, fps * 2.7], [0, 1], clamp);

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
        <div style={{ position: "relative", width, height }}>
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            style={{ position: "absolute", left: 0, top: 0, opacity: outlineOpacity }}
          >
            {LETTERS.map((l, i) => {
              const start = fps * (0.15 * i);
              const offset = interpolate(frame, [start, start + fps * 1.1], [DASH, 0], clamp);
              return (
                <text
                  key={i}
                  x={l.x}
                  y={224}
                  textAnchor="middle"
                  fontSize={310}
                  fontWeight={800}
                  fill={p.primary}
                  fillOpacity={fill}
                  stroke={p.primary}
                  strokeWidth={6}
                  strokeLinejoin="round"
                  strokeDasharray={DASH}
                  strokeDashoffset={offset}
                >
                  {l.char}
                </text>
              );
            })}
          </svg>
          {src ? (
            <Img
              src={src}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width,
                height,
                objectFit: "contain",
                opacity: logoOpacity,
              }}
            />
          ) : (
            <svg
              width={width}
              height={height}
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              style={{ position: "absolute", left: 0, top: 0, opacity: logoOpacity }}
            >
              {LETTERS.map((l, i) => (
                <text
                  key={i}
                  x={l.x}
                  y={224}
                  textAnchor="middle"
                  fontSize={310}
                  fontWeight={800}
                  fill={p.primary}
                >
                  {l.char}
                </text>
              ))}
            </svg>
          )}
        </div>
        <div
          style={{
            color: dark ? p.onDark : p.text,
            fontSize: stage.vertical ? 24 : 29,
            fontWeight: 700,
            marginTop: 24,
            lineHeight: 1.3,
            opacity: nameOpacity,
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
