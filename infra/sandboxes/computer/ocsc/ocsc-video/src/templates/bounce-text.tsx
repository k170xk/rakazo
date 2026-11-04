// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  type BrandProps,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "bounce-text",
  category: "text",
  description:
    "A brand-coloured panel that scales up while a headline slides in, followed by a subheading. Use for a section title or a statement card.",
  props: {
    text: 'string (default "Engineering the built environment")',
    subheading: 'string, "" to hide (default "Civil, structural, MEP, transport and water")',
    dark: "boolean: dark OCSC background behind the panel, false for a light one (default false: white)",
  },
  seconds: 4,
  media: "none",
  fits: "A heading of up to 6 words and a one-line subheading.",
  instead: "slide-text for a quieter statement; section_header to open a section.",
};

type Props = BrandProps & {
  text?: string;
  subheading?: string;
  dark?: boolean;
};

/** A font size that keeps the text to `lines` lines and its longest word to one line. */
function fitSize(text: string, max: number, width: number, lines: number): number {
  const charWidth = 0.62;
  const longest = Math.max(...text.split(" ").map((w) => w.length), 1);
  return Math.min(
    max,
    (width * lines * 0.85) / Math.max(1, text.length * charWidth),
    width / (longest * charWidth),
  );
}

export default function BounceText(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);

  const dark = props.dark === true;
  const text = str(props.text, "Engineering the built environment");
  const subheading =
    props.subheading === ""
      ? ""
      : str(props.subheading, "Civil, structural, MEP, transport and water");

  const slideIn = spring({
    frame,
    fps,
    from: -100,
    to: 0,
    config: { damping: 100, mass: 1, stiffness: 200 },
  });
  const fadeIn = spring({
    frame: frame - 15,
    fps,
    from: 0,
    to: 1,
    config: { damping: 100, mass: 1 },
  });
  const scaleIn = spring({
    frame,
    fps,
    from: 0.5,
    to: 0.8,
    config: { damping: 100, mass: 1, stiffness: 200 },
  });
  const containerFadeIn = spring({
    frame,
    fps,
    from: 0,
    to: 1,
    config: { damping: 100, mass: 1 },
  });
  const drift = interpolate(frame, [0, durationInFrames], [1, 1.03], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const panelWidth = stage.width * (stage.vertical ? 0.9 : 0.8);
  const padX = stage.vertical ? 32 : 48;
  const innerWidth = panelWidth - padX * 2;
  const fontSize = fitSize(text, 56, innerWidth, stage.vertical ? 4 : 2);

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: `translate(-50%, -50%) scale(${scaleIn * drift})`,
          width: panelWidth,
          boxSizing: "border-box",
          padding: `32px ${padX}px`,
          background: `linear-gradient(45deg, ${p.dark}, ${p.primary})`,
          borderRadius: 20,
          opacity: containerFadeIn,
          overflow: "hidden",
        }}
      >
        <div style={{ transform: `translateX(${slideIn}%)` }}>
          <div
            style={{
              fontSize,
              fontWeight: 900,
              color: "white",
              lineHeight: 1.05,
              textShadow: "0px 4px 8px rgba(0, 0, 0, 0.3)",
            }}
          >
            {text}
          </div>
          {subheading ? (
            <div
              style={{
                fontSize: Math.min(29, fontSize * 0.55),
                color: "white",
                marginTop: 12,
                fontWeight: 500,
                lineHeight: 1.25,
                opacity: fadeIn,
                textShadow: "0px 2px 4px rgba(0, 0, 0, 0.2)",
              }}
            >
              {subheading}
            </div>
          ) : null}
        </div>
      </div>
    </Stage>
  );
}
