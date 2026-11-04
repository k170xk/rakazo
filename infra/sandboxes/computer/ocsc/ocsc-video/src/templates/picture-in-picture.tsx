// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  type BrandProps,
  palette,
  Stage,
  str,
  type TemplateMeta,
} from "./kit";

export const meta: TemplateMeta = {
  name: "picture-in-picture",
  category: "media",
  description:
    "A full-frame photo with a smaller inset photo that springs into the bottom-right corner. Use to show a detail, a drawing or a speaker alongside the main project view.",
  props: {
    mainUrl: "string: the full-frame photo (default railway bridge)",
    insetUrl: "string: the inset photo (default engineers with drawings)",
    insetLabel: 'string: optional label on the inset (default "")',
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 5,
  media: "two photos",
  fits: "A main photo, an inset photo and an optional label.",
  instead: "split-screen for two photos of equal weight.",
  fullBleed: true,
};

type Props = BrandProps & {
  mainUrl?: string;
  insetUrl?: string;
  insetLabel?: string;
  dark?: boolean;
};

const MAIN =
  "https://images.pexels.com/photos/17886383/pexels-photo-17886383.jpeg?auto=compress&cs=tinysrgb&w=1920";
const INSET =
  "https://images.pexels.com/photos/3862384/pexels-photo-3862384.jpeg?auto=compress&cs=tinysrgb&w=1920";

export default function PictureInPicture(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const pipScale = spring({
    frame: frame - 15,
    fps,
    config: { damping: 12, stiffness: 100 },
  });
  const drift = interpolate(frame, [0, durationInFrames], [1.02, 1.1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const label = str(props.insetLabel, "");

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      <Img
        src={str(props.mainUrl, MAIN)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${drift})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 20,
          right: 20,
          width: 180,
          height: 130,
          borderRadius: 10,
          overflow: "hidden",
          background: dark ? p.inkSoft : p.paperAlt,
          border: dark ? "2px solid rgba(255, 255, 255, 0.6)" : `3px solid ${p.paper}`,
          boxShadow: dark ? "0 8px 30px rgba(0, 0, 0, 0.4)" : "0 10px 30px rgba(15, 23, 42, 0.25)",
          transform: `scale(${pipScale})`,
          transformOrigin: "100% 100%",
        }}
      >
        <Img src={str(props.insetUrl, INSET)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        {label ? (
          <div
            style={{
              position: "absolute",
              left: 0,
              bottom: 0,
              right: 0,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: dark ? "16px 10px 8px" : "6px 10px",
              background: dark ? "linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent)" : p.paper,
              color: dark ? p.onDark : p.text,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: p.primary }} />
            {label}
          </div>
        ) : null}
      </div>
    </Stage>
  );
}
