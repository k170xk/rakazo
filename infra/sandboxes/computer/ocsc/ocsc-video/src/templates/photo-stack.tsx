// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  list,
  palette,
  Stage,
  type TemplateMeta,
  useStage,
} from "./kit";

const IMAGES = [
  "https://images.pexels.com/photos/1216589/pexels-photo-1216589.jpeg?auto=compress&cs=tinysrgb&w=1920",
  "https://images.pexels.com/photos/3862384/pexels-photo-3862384.jpeg?auto=compress&cs=tinysrgb&w=1920",
  "https://images.pexels.com/photos/17770160/pexels-photo-17770160.jpeg?auto=compress&cs=tinysrgb&w=1920",
];

export const meta: TemplateMeta = {
  name: "photo-stack",
  category: "media",
  description:
    "White-bordered photos spring onto a fanned pile one after another, with optional captions. Use for a casual set of site-visit or team photos.",
  props: {
    imageUrls:
      "string[]: 2 to 5 photos, the last lands on top (default site worker with plans, engineers with drawings, cranes at sunset)",
    captions: "string[]: optional caption per photo, in the same order (default [])",
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 5,
  media: "photos",
  fits: "2-5 photos with optional captions.",
  instead: "gallery-grid when every photo matters equally.",
};

type Props = BrandProps & {
  imageUrls?: string[];
  captions?: string[];
  dark?: boolean;
};

export default function PhotoStack(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const images = list<string>(props.imageUrls, IMAGES).slice(0, 5);
  const captions = list<string>(props.captions, []);
  const centre = (images.length - 1) / 2;
  const sway = interpolate(frame, [fps, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const spread = stage.vertical ? 20 : 30;

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      {images.map((src, i) => {
        const appear = spring({
          frame: frame - i * 8,
          fps,
          config: { damping: 12, stiffness: 100 },
        });
        const rotation = (i - centre) * 5 * (1 + sway * 0.25);
        const offsetX = (i - centre) * spread * (1 + sway * 0.3);
        const offsetY = (i - centre) * -10;
        const caption = captions[i];
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: stage.width / 2 - 100,
              top: stage.height / 2 - 130,
              width: 200,
              height: 260,
              transform: `translate(${offsetX}px, ${offsetY}px) rotate(${rotation}deg) scale(${appear})`,
              opacity: appear,
              borderRadius: 8,
              border: "6px solid white",
              boxShadow: dark
                ? "0 8px 30px rgba(0, 0, 0, 0.4)"
                : `0 10px 30px rgba(15, 23, 42, 0.16), 0 0 0 1px ${alpha(p.primary, 0.18)}`,
              overflow: "hidden",
              background: dark ? p.inkSoft : p.paperAlt,
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
                  padding: "20px 10px 10px",
                  background: "linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent)",
                  color: p.onDark,
                  fontSize: 15,
                  fontWeight: 700,
                  textAlign: "center",
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
