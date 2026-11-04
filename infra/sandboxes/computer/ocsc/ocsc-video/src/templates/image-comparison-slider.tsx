// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Easing, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  type BrandProps,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "image-comparison-slider",
  category: "media",
  description:
    "A before-and-after photo pair with a divider that sweeps across, then settles in the middle. Use to compare a site before and after OCSC's work, or existing and proposed.",
  props: {
    beforeUrl: "string: the before photo (default tower cranes on a construction site)",
    afterUrl: "string: the after photo (default modern buildings)",
    beforeLabel: 'string (default "Before")',
    afterLabel: 'string (default "After")',
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 6,
  media: "two photos",
  fits: "A before and an after photo of the same view.",
  instead: "comparison for differences in words; split-screen for two different subjects.",
};

type Props = BrandProps & {
  beforeUrl?: string;
  afterUrl?: string;
  beforeLabel?: string;
  afterLabel?: string;
  dark?: boolean;
};

const BEFORE =
  "https://images.pexels.com/photos/5504388/pexels-photo-5504388.jpeg?auto=compress&cs=tinysrgb&w=1920";
const AFTER =
  "https://images.pexels.com/photos/358549/pexels-photo-358549.jpeg?auto=compress&cs=tinysrgb&w=1920";

export default function ImageComparisonSlider(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const enter = spring({ frame, fps, config: { damping: 14, mass: 0.7 } });
  // Sweeps fully across to show the before photo, back to reveal the after, then rests in the middle.
  const sweepEnd = Math.max(fps * 1.5, durationInFrames * 0.75);
  const dividerPercent = interpolate(
    frame,
    [10, 10 + (sweepEnd - 10) * 0.45, sweepEnd],
    [95, 5, 50],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.quad),
    },
  );

  const boxW = stage.width * 0.85;
  const boxH = stage.height * 0.75;
  const label = {
    position: "absolute" as const,
    top: 16,
    padding: "6px 14px",
    borderRadius: 999,
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: "0.04em",
  };

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      <div
        style={{
          position: "absolute",
          left: (stage.width - boxW) / 2,
          top: (stage.height - boxH) / 2,
          width: boxW,
          height: boxH,
          borderRadius: 12,
          overflow: "hidden",
          background: dark ? p.inkSoft : p.paperAlt,
          opacity: enter,
          transform: `scale(${0.92 + enter * 0.08})`,
          boxShadow: dark ? "0 16px 50px rgba(0, 0, 0, 0.45)" : "0 16px 44px rgba(15, 23, 42, 0.14)",
        }}
      >
        <Img
          src={str(props.afterUrl, AFTER)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
        <div style={{ ...label, right: 16, background: p.primary, color: p.onDark }}>
          {str(props.afterLabel, "After")}
        </div>
        <div
          style={{
            position: "absolute",
            inset: 0,
            clipPath: `inset(0 ${100 - dividerPercent}% 0 0)`,
          }}
        >
          <Img
            src={str(props.beforeUrl, BEFORE)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
          <div
            style={{
              ...label,
              left: 16,
              background: dark ? "rgba(0, 0, 0, 0.65)" : p.paper,
              color: dark ? p.onDark : p.text,
            }}
          >
            {str(props.beforeLabel, "Before")}
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${dividerPercent}%`,
            width: 3,
            marginLeft: -1.5,
            backgroundColor: "white",
            boxShadow: "0 0 8px rgba(0, 0, 0, 0.4)",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: 28,
              height: 28,
              borderRadius: "50%",
              backgroundColor: "white",
              border: `3px solid ${p.primary}`,
            }}
          />
        </div>
      </div>
    </Stage>
  );
}
