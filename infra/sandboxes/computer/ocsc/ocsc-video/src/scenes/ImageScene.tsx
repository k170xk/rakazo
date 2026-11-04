import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  AnimationConfig,
  BackgroundConfig,
  TextStyleConfig,
} from "../types";
import { Picture } from "./Picture";
import { SceneBackground } from "./SceneBackground";
import { useBrandedSvg } from "./useBrandedSvg";
import { useSceneAnimation } from "./useSceneAnimation";

interface ImageSceneProps {
  imageUrl: string;
  caption?: string;
  brandColor: string;
  background?: BackgroundConfig;
  captionStyle?: TextStyleConfig;
  animation?: AnimationConfig;
  kenBurns?: boolean;
}

export const ImageScene: React.FC<ImageSceneProps> = ({
  imageUrl,
  caption,
  brandColor,
  background,
  captionStyle,
  animation,
  kenBurns = true,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const brandedImageUrl = useBrandedSvg(imageUrl, brandColor);

  const captionAnim = useSceneAnimation(animation, 1);
  const cs = captionStyle || {};

  const scale = kenBurns
    ? interpolate(frame, [0, durationInFrames], [1, 1.15], {
        extrapolateRight: "clamp",
      })
    : 1;
  const translateX = kenBurns
    ? interpolate(frame, [0, durationInFrames], [0, -20], {
        extrapolateRight: "clamp",
      })
    : 0;
  const overlayOpacity = interpolate(frame, [0, 20], [0, 0.4], {
    extrapolateRight: "clamp",
  });

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <SceneBackground config={background} brandColor={brandColor} />
      <Picture
        src={brandedImageUrl}
        alt=""
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale}) translateX(${translateX}px)`,
          zIndex: 1,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 2,
          background:
            "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%)",
          opacity: overlayOpacity,
        }}
      />
      {caption && (
        <div
          style={{
            position: "absolute",
            bottom: 80,
            left: 80,
            right: 80,
            zIndex: 3,
            opacity: captionAnim.opacity,
            transform: captionAnim.transform,
          }}
        >
          <div
            style={{
              display: "inline-block",
              padding: "12px 24px",
              backgroundColor: brandColor,
              borderRadius: 6,
              marginBottom: 12,
            }}
          >
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#0f172a",
                textTransform: "uppercase",
                letterSpacing: 2,
                fontFamily: "Inter, Arial, sans-serif",
              }}
            >
              Featured
            </span>
          </div>
          <p
            style={{
              fontSize: cs.fontSize || 36,
              color: cs.color || "#ffffff",
              fontWeight: cs.fontWeight || 600,
              fontFamily: cs.fontFamily || "Inter, Arial, sans-serif",
              textShadow: "0 2px 12px rgba(0,0,0,0.7)",
              textAlign: (cs.textAlign || "left") as any,
            }}
          >
            {caption}
          </p>
        </div>
      )}
    </div>
  );
};
