// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
  type BrandProps,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "quote-card",
  category: "intro",
  description:
    "A large green quotation mark, an italic quote and an attribution that slides in. Use for client testimonials or a statement from an OCSC director.",
  props: {
    quote:
      'string (default "Good engineering is invisible: it simply makes places work better for the people who use them.")',
    attribution: 'string (default "O\'Connor Sutton Cronin")',
    dark: "boolean: dark OCSC background, or white when false (default false: white)",
  },
  seconds: 6,
  media: "none",
  fits: "A quote of up to 25 words and an attribution.",
  instead: "pull_quote for a named person with a portrait.",
};

type Props = BrandProps & {
  quote?: string;
  attribution?: string;
  dark?: boolean;
};

export default function QuoteCard(props: Props) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const quoteMarkOpacity = interpolate(frame, [0, 15], [0, 1], clamp);
  const textOpacity = interpolate(frame, [10, 30], [0, 1], clamp);
  const attributionOpacity = interpolate(frame, [30, 45], [0, 1], clamp);
  const attributionX = interpolate(frame, [30, 45], [40, 0], clamp);
  const drift = interpolate(frame, [0, durationInFrames], [1, 1.03], clamp);

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
          padding: stage.vertical ? 36 : 64,
          transform: `scale(${drift})`,
        }}
      >
        <span
          style={{
            color: p.primary,
            fontSize: 96,
            fontWeight: 700,
            lineHeight: 1,
            height: 64,
            opacity: quoteMarkOpacity,
            marginBottom: 16,
          }}
        >
          {"\u201C"}
        </span>
        <p
          style={{
            color: dark ? p.onDark : p.text,
            fontSize: stage.vertical ? 26 : 29,
            fontWeight: 400,
            lineHeight: 1.6,
            textAlign: "center",
            maxWidth: 700,
            margin: 0,
            opacity: textOpacity,
            fontStyle: "italic",
          }}
        >
          {str(
            props.quote,
            "Good engineering is invisible: it simply makes places work better for the people who use them.",
          )}
        </p>
        <p
          style={{
            color: dark ? p.lighter : p.textMuted,
            fontSize: 18,
            fontWeight: 500,
            margin: 0,
            marginTop: 32,
            opacity: attributionOpacity,
            transform: `translateX(${attributionX}px)`,
          }}
        >
          {"\u2014 "}
          {str(props.attribution, "O'Connor Sutton Cronin")}
        </p>
      </div>
    </Stage>
  );
}
