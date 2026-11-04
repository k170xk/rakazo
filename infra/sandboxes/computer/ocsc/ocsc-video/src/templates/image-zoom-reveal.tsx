// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
  type BrandProps,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "image-zoom-reveal",
  category: "media",
  description:
    "A framed photo zooms out of a blur into focus, then a title fades in over it. Use to reveal a hero image of an OCSC project.",
  props: {
    imageUrl: "string (default railway bridge)",
    title: 'string (default "Featured Project")',
    caption: 'string: optional smaller line under the title (default "")',
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 5,
  media: "photo",
  fits: "A title of up to 4 words and an optional caption.",
  instead: "image for a plain full-frame photo.",
};

type Props = BrandProps & {
  imageUrl?: string;
  title?: string;
  caption?: string;
  dark?: boolean;
};

const IMAGE =
  "https://images.pexels.com/photos/17886383/pexels-photo-17886383.jpeg?auto=compress&cs=tinysrgb&w=1920";

export default function ImageZoomReveal(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const duration = fps * 2;
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  // Reveals over two seconds, then keeps pushing in gently for the rest of the scene.
  const scale =
    interpolate(frame, [0, duration], [2, 1], clamp) *
    interpolate(frame, [duration, durationInFrames], [1, 1.06], clamp);
  const blur = interpolate(frame, [0, duration], [10, 0], clamp);
  const textOpacity = interpolate(frame, [duration * 0.6, duration], [0, 1], clamp);
  const textY = interpolate(frame, [duration * 0.6, duration], [12, 0], clamp);
  const caption = str(props.caption, "");

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      <div
        style={{
          position: "absolute",
          left: stage.width * 0.1,
          top: stage.height * 0.15,
          width: stage.width * 0.8,
          height: stage.height * 0.7,
          borderRadius: 12,
          overflow: "hidden",
          border: `3px solid ${dark ? p.inkSoft : p.paper}`,
          background: dark ? p.inkSoft : p.paperAlt,
          boxShadow: dark ? undefined : "0 10px 30px rgba(15, 23, 42, 0.08)",
        }}
      >
        <Img
          src={str(props.imageUrl, IMAGE)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${scale})`,
            filter: `blur(${blur}px)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(ellipse at center, rgba(0, 0, 0, 0.35), rgba(0, 0, 0, 0.1) 70%)",
            opacity: textOpacity,
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
            padding: 24,
            textAlign: "center",
            opacity: textOpacity,
            transform: `translateY(${textY}px)`,
          }}
        >
          <span
            style={{
              color: p.onDark,
              fontSize: 29,
              fontWeight: 600,
              textShadow: "0 2px 8px rgba(0, 0, 0, 0.5)",
            }}
          >
            {str(props.title, "Featured Project")}
          </span>
          <div style={{ width: 60, height: 3, background: p.primary, borderRadius: 2, marginTop: 12 }} />
          {caption ? (
            <span
              style={{
                color: p.onDark,
                fontSize: 16,
                marginTop: 12,
                textShadow: "0 2px 8px rgba(0, 0, 0, 0.5)",
              }}
            >
              {caption}
            </span>
          ) : null}
        </div>
      </div>
    </Stage>
  );
}
