// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Easing, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
  type BrandProps,
  list,
  palette,
  Stage,
  type TemplateMeta,
  useStage,
} from "./kit";

const IMAGES = [
  "https://images.pexels.com/photos/5504388/pexels-photo-5504388.jpeg?auto=compress&cs=tinysrgb&w=1920",
  "https://images.pexels.com/photos/17886383/pexels-photo-17886383.jpeg?auto=compress&cs=tinysrgb&w=1920",
  "https://images.pexels.com/photos/358549/pexels-photo-358549.jpeg?auto=compress&cs=tinysrgb&w=1920",
];

export const meta: TemplateMeta = {
  name: "image-carousel",
  category: "media",
  description:
    "Portrait photo cards slide past a centre spotlight one at a time, each with a caption. Use to step through a few OCSC projects or services.",
  props: {
    imageUrls: "string[] (default tower cranes, railway bridge, modern buildings)",
    captions: 'string[]: one per photo, empty to hide (default ["Construction", "Rail Infrastructure", "Commercial Buildings"])',
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 7,
  media: "photos",
  fits: "3-5 portrait-friendly photos with captions of up to 3 words.",
  instead: "image_grid to show them all at once.",
};

type Props = BrandProps & {
  imageUrls?: string[];
  captions?: string[];
  dark?: boolean;
};

const CARD_W = 240;
const CARD_H = 320;

export default function ImageCarousel(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const images = list<string>(props.imageUrls, IMAGES);
  const captions = Array.isArray(props.captions)
    ? props.captions
    : ["Construction", "Rail Infrastructure", "Commercial Buildings"];

  // Each photo gets an equal share of the scene, gliding to the next over the last half second.
  const slot = durationInFrames / images.length;
  const glide = Math.min(fps * 0.6, slot * 0.5);
  let progress = 0;
  for (let k = 1; k < images.length; k++) {
    progress += interpolate(frame, [k * slot - glide, k * slot], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.cubic),
    });
  }

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      {images.map((src, i) => {
        const offset = i - progress;
        const distance = Math.abs(offset);
        const scale = interpolate(distance, [0, 1, 2], [1, 0.75, 0.55], {
          extrapolateRight: "clamp",
        });
        const opacity = interpolate(distance, [0, 1, 2, 3], [1, 0.5, 0.2, 0], {
          extrapolateRight: "clamp",
        });
        const caption = captions[i];
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: stage.width / 2 - CARD_W / 2,
              top: stage.height / 2 - CARD_H / 2,
              width: CARD_W,
              height: CARD_H,
              borderRadius: 12,
              overflow: "hidden",
              background: dark ? p.inkSoft : p.paperAlt,
              transform: `translateX(${offset * 280}px) scale(${scale})`,
              opacity,
              zIndex: 100 - Math.round(distance * 10),
              boxShadow:
                distance < 0.5
                  ? dark
                    ? `0 12px 40px rgba(0, 0, 0, 0.5)`
                    : "0 14px 36px rgba(15, 23, 42, 0.16)"
                  : "none",
              border: `2px solid ${distance < 0.5 ? p.primary : "transparent"}`,
            }}
          >
            <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            {typeof caption === "string" && caption.trim() ? (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  padding: "28px 16px 16px",
                  background: "linear-gradient(to top, rgba(0, 0, 0, 0.75), transparent)",
                  color: p.onDark,
                  fontSize: 16,
                  fontWeight: 600,
                  textShadow: "0 1px 4px rgba(0, 0, 0, 0.3)",
                }}
              >
                {caption}
              </div>
            ) : null}
          </div>
        );
      })}
    </Stage>
  );
}
