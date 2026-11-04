import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  AnimationConfig,
  BackgroundConfig,
  TextStyleConfig,
} from "../types";
import { Picture } from "./Picture";
import { SceneBackground } from "./SceneBackground";
import { useBrandedSvg } from "./useBrandedSvg";
import { useSceneAnimation } from "./useSceneAnimation";

interface SectionHeaderSceneProps {
  heading: string;
  sectionNumber?: string;
  subheading?: string;
  imageUrl?: string;
  brandColor: string;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  subheadingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export const SectionHeaderScene: React.FC<SectionHeaderSceneProps> = ({
  heading,
  sectionNumber,
  subheading,
  imageUrl,
  brandColor,
  background,
  headingStyle,
  subheadingStyle,
  animation,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const brandedImageUrl = useBrandedSvg(imageUrl, brandColor);

  const numberAnim = useSceneAnimation(animation, 0);
  const headAnim = useSceneAnimation(animation, 1);
  const subAnim = useSceneAnimation(animation, 2);

  // Animated accent bar
  const barWidth = interpolate(
    spring({
      frame: Math.max(0, frame - 5),
      fps,
      config: { damping: 20, stiffness: 80 },
    }),
    [0, 1],
    [0, 600],
  );

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex" }}>
      <SceneBackground config={background} brandColor={brandColor} />

      {brandedImageUrl && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: "45%",
            opacity: interpolate(frame, [10, 30], [0, 0.2], {
              extrapolateRight: "clamp",
            }),
            zIndex: 0,
          }}
        >
          <Picture
            src={brandedImageUrl}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      )}

      <div
        style={{
          position: "relative",
          zIndex: 1,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px 100px",
        }}
      >
        {sectionNumber && (
          <span
            style={{
              fontSize: 120,
              fontWeight: 900,
              color: brandColor,
              fontFamily: "Inter, Arial, sans-serif",
              lineHeight: 1,
              marginBottom: -30,
              ...numberAnim,
            }}
          >
            {sectionNumber}
          </span>
        )}

        {/* Accent bar */}
        <div
          style={{
            width: barWidth,
            height: 6,
            backgroundColor: brandColor,
            borderRadius: 3,
            marginBottom: 24,
          }}
        />

        <h1
          style={{
            fontSize: headingStyle?.fontSize || 68,
            fontWeight: headingStyle?.fontWeight || 800,
            color: headingStyle?.color || "#0f172a",
            fontFamily: headingStyle?.fontFamily || "Inter, Arial, sans-serif",
            lineHeight: headingStyle?.lineHeight || 1.1,
            opacity: headAnim.opacity,
            transform: headAnim.transform,
            textShadow: headingStyle?.textShadow
              ? "0 4px 20px rgba(0,0,0,0.5)"
              : "none",
          }}
        >
          {heading}
        </h1>

        {subheading && (
          <p
            style={{
              fontSize: subheadingStyle?.fontSize || 28,
              fontWeight: subheadingStyle?.fontWeight || 400,
              color: subheadingStyle?.color || "#94a3b8",
              fontFamily: subheadingStyle?.fontFamily || "Inter, Arial, sans-serif",
              marginTop: 20,
              maxWidth: "70%",
              opacity: subAnim.opacity,
              transform: subAnim.transform,
            }}
          >
            {subheading}
          </p>
        )}
      </div>
    </div>
  );
};
