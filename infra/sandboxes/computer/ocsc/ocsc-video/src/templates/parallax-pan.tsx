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
  "https://images.pexels.com/photos/1216589/pexels-photo-1216589.jpeg?auto=compress&cs=tinysrgb&w=1920";

export const meta: TemplateMeta = {
  name: "parallax-pan",
  category: "cinematic",
  description:
    "A slow camera pan across a photo with a heading that moves faster in front of it, for a sense of depth. Use it for a project or team photo with a short title.",
  props: {
    imageUrl: `string (default "${DEFAULT_IMAGE}", site worker with plans)`,
    direction:
      '"left-right" | "right-left" | "top-bottom" | "bottom-top": the way the camera pans (default "left-right")',
    scale: "number: how far the photo is enlarged to leave room to pan (default 1.2)",
    heading: 'string (default "From brief to handover")',
    subheading: 'string (default "Project management across Ireland and the UK")',
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 6,
  media: "photo",
  fits: "A heading of up to 5 words and a subheading.",
  instead: "ken-burns for a photo without a heading.",
  fullBleed: true,
};

type Props = BrandProps & {
  imageUrl?: string;
  direction?: "left-right" | "right-left" | "top-bottom" | "bottom-top";
  scale?: number;
  heading?: string;
  subheading?: string;
  dark?: boolean;
};

export default function ParallaxPan(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const scale = Math.max(1.05, num(props.scale, 1.2));
  const direction = props.direction ?? "left-right";
  const horizontal = direction === "left-right" || direction === "right-left";
  const forwards = direction === "left-right" || direction === "top-bottom";

  // One smooth sweep over the whole scene, using only the spare picture the enlargement leaves.
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.sin),
  });
  const spare = ((scale - 1) / 2) * (horizontal ? stage.width : stage.height) * 0.95;
  const offset = (forwards ? 1 - 2 * progress : 2 * progress - 1) * spare;
  const bgX = horizontal ? offset : 0;
  const bgY = horizontal ? 0 : offset;
  // The heading is "closer" to the camera, so it travels further than the photo.
  const fgX = bgX * 1.4;
  const fgY = bgY * 1.4;

  const textIn = spring({ frame: frame - 8, fps, config: { damping: 15, mass: 0.7 } });

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
          transform: `translate(${bgX}px, ${bgY}px) scale(${scale})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: dark
            ? `linear-gradient(180deg, ${alpha(p.ink, 0.15)}, ${alpha(p.ink, 0.6)})`
            : `linear-gradient(180deg, ${alpha(p.ink, 0.04)}, ${alpha(p.ink, 0.22)})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: "0 50px",
          textAlign: "center",
          transform: `translate(${fgX}px, ${fgY + (1 - textIn) * 30}px)`,
          opacity: textIn,
        }}
      >
        <div
          style={
            dark
              ? { display: "contents" }
              : {
                  maxWidth: stage.width - 100,
                  background: p.paper,
                  border: `1px solid ${alpha(p.primary, 0.18)}`,
                  borderRadius: 16,
                  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.18)",
                  padding: stage.vertical ? "28px 28px" : "32px 44px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }
          }
        >
          <div
            style={{
              width: 60,
              height: 3,
              background: `linear-gradient(90deg, ${p.primary}, ${p.light})`,
              borderRadius: 2,
              marginBottom: 18,
            }}
          />
          <div
            style={{
              color: dark ? p.onDark : p.text,
              fontSize: stage.vertical ? 34 : 46,
              fontWeight: 800,
              lineHeight: 1.15,
              textShadow: dark ? "0 4px 20px rgba(0, 0, 0, 0.45)" : undefined,
            }}
          >
            {str(props.heading, "From brief to handover")}
          </div>
          <div
            style={{
              color: dark ? p.lighter : p.textMuted,
              fontSize: 18,
              marginTop: 10,
              lineHeight: 1.4,
              textShadow: dark ? "0 2px 10px rgba(0, 0, 0, 0.45)" : undefined,
            }}
          >
            {str(props.subheading, "Project management across Ireland and the UK")}
          </div>
        </div>
      </div>
    </Stage>
  );
}
