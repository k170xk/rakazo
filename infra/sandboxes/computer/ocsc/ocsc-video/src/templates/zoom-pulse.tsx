// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Img, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  num,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

const DEFAULT_IMAGE =
  "https://images.pexels.com/photos/17770160/pexels-photo-17770160.jpeg?auto=compress&cs=tinysrgb&w=1920";

export const meta: TemplateMeta = {
  name: "zoom-pulse",
  category: "cinematic",
  description:
    "A photo that gently zooms in and out in a slow, breathing rhythm, with an optional caption. Use it to hold on a project photo without it feeling static.",
  props: {
    imageUrl: `string (default "${DEFAULT_IMAGE}", cranes at sunset)`,
    minScale: "number: scale at rest (default 1)",
    maxScale: "number: scale at the peak of each pulse (default 1.1)",
    periodSeconds: "number: seconds per pulse, in and back out (default 4)",
    caption: "string: optional caption at the bottom left (default none)",
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 6,
  media: "photo",
  fits: "An optional caption of up to 8 words.",
  instead: "ken-burns for a one-way camera move.",
  fullBleed: true,
};

type Props = BrandProps & {
  imageUrl?: string;
  minScale?: number;
  maxScale?: number;
  periodSeconds?: number;
  caption?: string;
  dark?: boolean;
};

export default function ZoomPulse(props: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const minScale = Math.max(1, num(props.minScale, 1));
  const maxScale = Math.max(minScale, num(props.maxScale, 1.1));
  const period = Math.max(0.5, num(props.periodSeconds, 4));
  // Eases in and out like the original's ease-in-out keyframes: rest, peak at half a period, rest.
  const wave = (1 - Math.cos((frame / fps / period) * Math.PI * 2)) / 2;
  const scale = minScale + (maxScale - minScale) * wave;

  const caption = str(props.caption, "");
  const captionIn = spring({ frame: frame - 10, fps, config: { damping: 15, mass: 0.6 } });

  return (
    <Stage background={dark ? "#000000" : p.paper}>
      <Img
        src={str(props.imageUrl, DEFAULT_IMAGE)}
        style={{
          position: "absolute",
          inset: 0,
          width: stage.width,
          height: stage.height,
          objectFit: "cover",
          transform: `scale(${scale})`,
        }}
      />
      {caption && !dark && (
        <div
          style={{
            position: "absolute",
            left: 40,
            bottom: stage.height * 0.1,
            maxWidth: stage.width - 80,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "stretch",
            gap: 14,
            background: p.paper,
            border: `1px solid ${alpha(p.primary, 0.18)}`,
            borderRadius: 12,
            boxShadow: "0 10px 30px rgba(15, 23, 42, 0.18)",
            padding: "14px 22px 14px 16px",
            opacity: captionIn,
            transform: `translateY(${(1 - captionIn) * 20}px)`,
          }}
        >
          <div style={{ width: 4, background: p.primary, borderRadius: 2 }} />
          <div
            style={{
              color: p.text,
              fontSize: stage.vertical ? 22 : 24,
              fontWeight: 600,
              lineHeight: 1.3,
            }}
          >
            {caption}
          </div>
        </div>
      )}
      {caption && dark && (
        <>
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: stage.height * 0.35,
              background: "linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.55))",
              opacity: captionIn,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 40,
              right: 40,
              bottom: stage.height * 0.1,
              display: "flex",
              alignItems: "stretch",
              gap: 14,
              opacity: captionIn,
              transform: `translateY(${(1 - captionIn) * 20}px)`,
            }}
          >
            <div style={{ width: 4, background: p.primary, borderRadius: 2 }} />
            <div
              style={{
                color: p.onDark,
                fontSize: stage.vertical ? 22 : 24,
                fontWeight: 600,
                lineHeight: 1.3,
                textShadow: "0 2px 10px rgba(0, 0, 0, 0.5)",
              }}
            >
              {caption}
            </div>
          </div>
        </>
      )}
    </Stage>
  );
}
