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
  "https://images.pexels.com/photos/3862384/pexels-photo-3862384.jpeg?auto=compress&cs=tinysrgb&w=1920",
  "https://images.pexels.com/photos/17886383/pexels-photo-17886383.jpeg?auto=compress&cs=tinysrgb&w=1920",
  "https://images.pexels.com/photos/1216589/pexels-photo-1216589.jpeg?auto=compress&cs=tinysrgb&w=1920",
  "https://images.pexels.com/photos/358549/pexels-photo-358549.jpeg?auto=compress&cs=tinysrgb&w=1920",
  "https://images.pexels.com/photos/17770160/pexels-photo-17770160.jpeg?auto=compress&cs=tinysrgb&w=1920",
];

export const meta: TemplateMeta = {
  name: "masonry-gallery",
  category: "media",
  description:
    "Six photos of varied heights pop into three staggered columns, with optional captions. Use for a lively collage of OCSC site and project photos.",
  props: {
    imageUrls:
      "string[]: up to 6 photos, filled column by column (default tower cranes, engineers with drawings, railway bridge, site worker with plans, modern buildings, cranes at sunset)",
    captions: "string[]: optional caption per photo, in the same order (default [])",
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 6,
  media: "photos",
  fits: "Up to 6 photos with captions of up to 3 words.",
  instead: "gallery-grid for a tidier grid.",
};

type Props = BrandProps & {
  imageUrls?: string[];
  captions?: string[];
  dark?: boolean;
};

/** Each column's two blocks share the height unevenly, so the columns stagger. */
const LAYOUT = [
  { col: 0, height: 45, delay: 0 },
  { col: 0, height: 50, delay: 6 },
  { col: 1, height: 55, delay: 3 },
  { col: 1, height: 40, delay: 9 },
  { col: 2, height: 40, delay: 5 },
  { col: 2, height: 55, delay: 11 },
];

export default function MasonryGallery(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const images = list<string>(props.imageUrls, IMAGES);
  const captions = list<string>(props.captions, []);
  const drift = interpolate(frame, [0, durationInFrames], [1, 1.08], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const blocks = LAYOUT.map((block, i) => ({
    ...block,
    src: images[i % images.length],
    caption: captions[i],
  }));
  const columns: (typeof blocks)[] = [[], [], []];
  blocks.forEach((block) => columns[block.col].push(block));

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      <div
        style={{
          position: "absolute",
          left: stage.width * 0.05,
          top: stage.height * 0.06,
          width: stage.width * 0.9,
          height: stage.height * 0.88,
          display: "flex",
          gap: 16,
        }}
      >
        {columns.map((col, colIdx) => (
          <div
            key={colIdx}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            {col.map((block, blockIdx) => {
              const s = spring({
                frame: frame - block.delay,
                fps,
                config: { damping: 12, stiffness: 100 },
              });
              return (
                <div
                  key={blockIdx}
                  style={{
                    position: "relative",
                    height: `${block.height}%`,
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
                    src={block.src}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      transform: `scale(${drift})`,
                    }}
                  />
                  {typeof block.caption === "string" && block.caption.trim() ? (
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
                      {block.caption}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Stage>
  );
}
