// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  palette,
  Stage,
  str,
  type TemplateMeta,
} from "./kit";

export const meta: TemplateMeta = {
  name: "polaroid-frame",
  category: "media",
  description:
    "A single photo in an instant-print frame drops in and settles at a slight angle, with a handwritten-style caption. Use for a personal moment such as a site visit or team day.",
  props: {
    imageUrl: "string (default site worker with plans)",
    caption: 'string (default "On site with OCSC")',
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 5,
  media: "photo",
  fits: "One photo and a caption of up to 5 words.",
  instead: "image for a full-frame photo.",
};

type Props = BrandProps & {
  imageUrl?: string;
  caption?: string;
  dark?: boolean;
};

const IMAGE =
  "https://images.pexels.com/photos/1216589/pexels-photo-1216589.jpeg?auto=compress&cs=tinysrgb&w=1920";

export default function PolaroidFrame(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const dropIn = spring({
    frame,
    fps,
    config: { damping: 10, stiffness: 80 },
  });
  const translateY = interpolate(dropIn, [0, 1], [-300, 0]);
  const settle = interpolate(frame, [fps, durationInFrames], [0, 1.5], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rotation = interpolate(dropIn, [0, 1], [8, -3]) + settle;
  const opacity = interpolate(dropIn, [0, 0.3], [0, 1], {
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
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div
          style={{
            backgroundColor: "white",
            padding: "12px 12px 48px 12px",
            borderRadius: 4,
            transform: `translateY(${translateY}px) rotate(${rotation}deg)`,
            opacity,
            border: dark ? undefined : `1px solid ${alpha(p.primary, 0.18)}`,
            boxShadow: dark
              ? "0 20px 60px rgba(0, 0, 0, 0.5)"
              : "0 20px 50px rgba(15, 23, 42, 0.14)",
          }}
        >
          <div style={{ width: 260, height: 260, borderRadius: 2, overflow: "hidden", background: p.paperAlt }}>
            <Img
              src={str(props.imageUrl, IMAGE)}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
          <p
            style={{
              width: 260,
              textAlign: "center",
              color: "#374151",
              fontSize: 15,
              fontWeight: 500,
              margin: 0,
              marginTop: 12,
              fontStyle: "italic",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {str(props.caption, "On site with OCSC")}
          </p>
        </div>
      </div>
    </Stage>
  );
}
