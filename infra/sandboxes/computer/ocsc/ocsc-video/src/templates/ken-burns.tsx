// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Easing, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
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
  "https://images.pexels.com/photos/17886383/pexels-photo-17886383.jpeg?auto=compress&cs=tinysrgb&w=1920";

export const meta: TemplateMeta = {
  name: "ken-burns",
  category: "cinematic",
  description:
    "A photo that slowly zooms and pans across the whole scene (the Ken Burns effect), with an optional caption. Use it to bring a still project photo to life.",
  props: {
    imageUrl: `string (default "${DEFAULT_IMAGE}", railway bridge)`,
    zoom: "number: the most zoomed-in scale, 1 = no zoom (default 1.25)",
    direction: '"in" | "out": zoom in or out over the scene (default "in")',
    pan: '"left" | "right" | "up" | "down" | "none": the way the camera drifts (default "right")',
    caption: "string: optional caption at the bottom left (default none)",
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 6,
  media: "photo",
  fits: "An optional caption of up to 8 words.",
  instead: "image with kenBurns for the built-in version; zoom-pulse for a breathing move.",
  fullBleed: true,
};

type Props = BrandProps & {
  imageUrl?: string;
  zoom?: number;
  direction?: "in" | "out";
  pan?: "left" | "right" | "up" | "down" | "none";
  caption?: string;
  dark?: boolean;
};

export default function KenBurns(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const zoom = Math.max(1, num(props.zoom, 1.25));
  const zoomIn = props.direction !== "out";
  const pan = props.pan ?? "right";

  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  const scale = zoomIn ? 1 + (zoom - 1) * progress : zoom - (zoom - 1) * progress;

  // Pans only as far as the current zoom leaves spare picture, so no edge ever shows. Zooming in
  // drifts from the centre outwards; zooming out drifts back to the centre.
  const spareX = ((scale - 1) / 2) * stage.width * 0.9;
  const spareY = ((scale - 1) / 2) * stage.height * 0.9;
  const travel = zoomIn ? -progress : 1 - progress;
  const tx = pan === "right" ? travel * spareX : pan === "left" ? -travel * spareX : 0;
  const ty = pan === "down" ? travel * spareY : pan === "up" ? -travel * spareY : 0;

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
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
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
