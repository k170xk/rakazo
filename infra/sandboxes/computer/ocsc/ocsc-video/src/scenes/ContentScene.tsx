import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  AnimationConfig,
  BackgroundConfig,
  ContentLayout,
  TextStyleConfig,
} from "../types";
import { Picture } from "./Picture";
import { SceneBackground } from "./SceneBackground";
import { getBrandedSvgUrl, useBrandedSvg } from "./useBrandedSvg";
import { useSceneAnimation } from "./useSceneAnimation";

interface ContentSceneProps {
  title: string;
  bullets: string[];
  brandColor: string;
  imageUrl?: string;
  imageUrls?: string[];
  layout?: ContentLayout;
  background?: BackgroundConfig;
  titleStyle?: TextStyleConfig;
  bulletStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export const ContentScene: React.FC<ContentSceneProps> = ({
  title,
  bullets,
  brandColor,
  imageUrl,
  imageUrls = [],
  layout = "default",
  background,
  titleStyle,
  bulletStyle,
  animation,
}) => {
  const frame = useCurrentFrame();
  const brandedImageUrl = useBrandedSvg(imageUrl, brandColor);
  const { fps } = useVideoConfig();

  const titleAnim = useSceneAnimation(animation, 0);
  const lineAnim = useSceneAnimation(animation, 1);

  const lineWidth = interpolate(
    spring({
      frame: Math.max(0, frame - (animation?.staggerDelay || 8)),
      fps,
      config: { damping: 25 },
    }),
    [0, 1],
    [0, 120],
  );

  const ts = titleStyle || {};
  const bs = bulletStyle || {};

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex" }}>
      <SceneBackground config={background} brandColor={brandColor} />

      {/* Left accent */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 8,
          backgroundColor: brandColor,
          opacity: interpolate(frame, [0, 10], [0, 1], {
            extrapolateRight: "clamp",
          }),
          zIndex: 2,
        }}
      />

      <div
        style={{
          flex: 1,
          padding: "80px 80px 80px 100px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          position: "relative",
          zIndex: 1,
        }}
      >
        <h2
          style={{
            fontSize: ts.fontSize || 52,
            fontWeight: ts.fontWeight || 700,
            color: ts.color || "#0f172a",
            marginBottom: 12,
            fontFamily: ts.fontFamily || "Inter, Arial, sans-serif",
            opacity: titleAnim.opacity,
            transform: titleAnim.transform,
            textAlign: (ts.textAlign || "left") as any,
            textShadow: ts.textShadow ? "0 4px 20px rgba(0,0,0,0.5)" : "none",
          }}
        >
          {title}
        </h2>
        <div
          style={{
            width: lineWidth,
            height: 3,
            backgroundColor: brandColor,
            marginBottom: 40,
            borderRadius: 2,
            opacity: lineAnim.opacity,
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {bullets.map((bullet, i) => {
            const bulletAnim = useSceneAnimation(animation, i + 2);
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 16,
                  opacity: bulletAnim.opacity,
                  transform: bulletAnim.transform,
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    backgroundColor: brandColor,
                    marginTop: 10,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: bs.fontSize || 30,
                    color: bs.color || "#1f2937",
                    lineHeight: bs.lineHeight || 1.4,
                    fontFamily: bs.fontFamily || "Inter, Arial, sans-serif",
                    fontWeight: bs.fontWeight || 400,
                    textShadow: bs.textShadow
                      ? "0 2px 8px rgba(0,0,0,0.4)"
                      : "none",
                  }}
                >
                  {bullet}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {(brandedImageUrl || imageUrls.length > 0) && (
        <div
          style={{
            width: "40%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 60,
            position: "relative",
            zIndex: 1,
          }}
        >
          {imageUrls.length > 0 ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                width: "100%",
              }}
            >
              {[
                ...(brandedImageUrl ? [brandedImageUrl] : []),
                ...imageUrls.map(
                  (url) => getBrandedSvgUrl(url, brandColor) || url,
                ),
              ]
                .slice(0, 4)
                .map((url, idx) => (
                  <Picture
                    key={`${url}-${idx}`}
                    src={url}
                    alt=""
                    style={{
                      width: "100%",
                      aspectRatio: "1 / 1",
                      objectFit: "cover",
                      borderRadius: 12,
                      opacity: interpolate(
                        frame,
                        [15 + idx * 3, 30 + idx * 3],
                        [0, 1],
                        {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                        },
                      ),
                      transform: `scale(${interpolate(
                        spring({
                          frame: Math.max(0, frame - 15 - idx * 3),
                          fps,
                          config: { damping: 20 },
                        }),
                        [0, 1],
                        [0.9, 1],
                      )})`,
                    }}
                  />
                ))}
            </div>
          ) : (
            <Picture
              src={brandedImageUrl}
              alt=""
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                borderRadius: 12,
                opacity: interpolate(frame, [15, 30], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
                transform: `scale(${interpolate(
                  spring({
                    frame: Math.max(0, frame - 15),
                    fps,
                    config: { damping: 20 },
                  }),
                  [0, 1],
                  [0.9, 1],
                )})`,
              }}
            />
          )}
        </div>
      )}
    </div>
  );
};
