import { Img, interpolate, OffthreadVideo, useCurrentFrame } from "remotion";
import type {
  AnimationConfig,
  BackgroundConfig,
  TextStyleConfig,
} from "../types";
import { SceneBackground } from "./SceneBackground";
import { useSceneAnimation } from "./useSceneAnimation";

interface VideoSceneProps {
  videoUrl: string;
  caption?: string;
  brandColor: string;
  background?: BackgroundConfig;
  captionStyle?: TextStyleConfig;
  animation?: AnimationConfig;
  posterUrl?: string;
}

export const VideoScene: React.FC<VideoSceneProps> = ({
  videoUrl,
  caption,
  brandColor,
  background,
  captionStyle,
  animation,
  posterUrl,
}) => {
  const frame = useCurrentFrame();
  const captionAnim = useSceneAnimation(animation, 1);
  const cs = captionStyle || {};

  const hasVideoUrl = !!videoUrl && videoUrl.length > 0;
  const isVideo = hasVideoUrl && /\.(mp4|webm|mov)(\?|$)/i.test(videoUrl);
  const fallbackSrc = posterUrl || (hasVideoUrl ? videoUrl : "");

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <SceneBackground config={background} brandColor={brandColor} />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1,
          opacity: interpolate(frame, [0, 15], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        {isVideo ? (
          <OffthreadVideo
            src={videoUrl}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            muted
          />
        ) : fallbackSrc ? (
          <Img
            src={fallbackSrc}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#64748b",
              fontSize: 24,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            No video selected
          </div>
        )}
      </div>

      {caption && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
            padding: "80px 80px 60px",
            zIndex: 2,
            opacity: captionAnim.opacity,
            transform: captionAnim.transform,
          }}
        >
          <p
            style={{
              fontSize: cs.fontSize || 32,
              fontWeight: cs.fontWeight || 500,
              color: cs.color || "#ffffff",
              fontFamily: cs.fontFamily || "Inter, Arial, sans-serif",
              textAlign: (cs.textAlign || "center") as any,
              textShadow: "0 2px 12px rgba(0,0,0,0.7)",
            }}
          >
            {caption}
          </p>
        </div>
      )}
    </div>
  );
};
