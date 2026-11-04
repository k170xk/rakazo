// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
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
  "https://images.pexels.com/photos/3862384/pexels-photo-3862384.jpeg?auto=compress&cs=tinysrgb&w=1920",
  "https://images.pexels.com/photos/1216589/pexels-photo-1216589.jpeg?auto=compress&cs=tinysrgb&w=1920",
  "https://images.pexels.com/photos/17770160/pexels-photo-17770160.jpeg?auto=compress&cs=tinysrgb&w=1920",
];

export const meta: TemplateMeta = {
  name: "gallery-grid",
  category: "media",
  description:
    "Six photos pop into a tidy grid one after another, with optional captions. Use to show a range of OCSC projects or site photos at a glance.",
  props: {
    imageUrls:
      "string[]: up to 6 photos (default tower cranes, railway bridge, modern buildings, engineers with drawings, site worker with plans, cranes at sunset)",
    captions: "string[]: optional caption per photo, in the same order (default [])",
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 6,
  media: "photos",
  fits: "Up to 6 photos with captions of up to 3 words.",
  instead: "image_grid for a grid with a heading; masonry-gallery for a looser collage.",
};

type Props = BrandProps & {
  imageUrls?: string[];
  captions?: string[];
  dark?: boolean;
};

export default function GalleryGrid(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const images = list<string>(props.imageUrls, IMAGES).slice(0, 6);
  const captions = list<string>(props.captions, []);
  const columns = stage.vertical ? 2 : Math.min(3, images.length);
  const rows = Math.ceil(images.length / columns);
  const drift = interpolate(frame, [0, durationInFrames], [1, 1.08], {
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
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
            gap: 16,
            width: stage.width * 0.9,
            height: stage.height * 0.8,
          }}
        >
          {images.map((src, i) => {
            const s = spring({
              frame: frame - i * 4,
              fps,
              config: { damping: 12, stiffness: 100 },
            });
            const caption = captions[i];
            return (
              <div
                key={i}
                style={{
                  position: "relative",
                  borderRadius: 10,
                  overflow: "hidden",
                  background: dark ? p.inkSoft : p.paperAlt,
                  transform: `scale(${0.8 + s * 0.2})`,
                  opacity: s,
                  boxShadow: dark
                    ? "0 6px 20px rgba(0, 0, 0, 0.35)"
                    : "0 10px 30px rgba(15, 23, 42, 0.08)",
                }}
              >
                <Img
                  src={src}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transform: `scale(${drift})`,
                  }}
                />
                {typeof caption === "string" && caption.trim() ? (
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      padding: "18px 12px 10px",
                      background: "linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent)",
                      color: p.onDark,
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    {caption}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </Stage>
  );
}
