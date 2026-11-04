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

interface QuoteSceneProps {
  quote: string;
  attribution?: string;
  imageUrl?: string;
  brandColor: string;
  background?: BackgroundConfig;
  quoteStyle?: TextStyleConfig;
  attributionStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export const QuoteScene: React.FC<QuoteSceneProps> = ({
  quote,
  attribution,
  imageUrl,
  brandColor,
  background,
  quoteStyle,
  attributionStyle,
  animation,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const brandedImageUrl = useBrandedSvg(imageUrl, brandColor);

  const quoteAnim = useSceneAnimation(animation, 0);
  const attrAnim = useSceneAnimation(animation, 2);

  const lineWidth = interpolate(
    spring({ frame: Math.max(0, frame - 5), fps, config: { damping: 25 } }),
    [0, 1],
    [0, 80],
  );

  const qs = quoteStyle || {};
  const as_ = attributionStyle || {};

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex" }}>
      <SceneBackground config={background} brandColor={brandColor} />

      {brandedImageUrl && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 0,
            opacity: interpolate(frame, [0, 20], [0, 0.15], {
              extrapolateRight: "clamp",
            }),
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
          alignItems: "center",
          justifyContent: "center",
          padding: "80px 120px",
        }}
      >
        {/* Large quote mark */}
        <div
          style={{
            fontSize: 180,
            lineHeight: 0.8,
            color: brandColor,
            opacity: 0.3,
            fontFamily: "'Source Serif 4', Georgia, serif",
            marginBottom: -20,
            transform: `scale(${spring({ frame, fps, config: { damping: 20 } })})`,
          }}
        >
          "
        </div>

        <p
          style={{
            fontSize: qs.fontSize || 44,
            fontWeight: qs.fontWeight || 500,
            color: qs.color || "#0f172a",
            textAlign: "center",
            maxWidth: "85%",
            lineHeight: qs.lineHeight || 1.5,
            fontFamily: qs.fontFamily || "Inter, Arial, sans-serif",
            fontStyle: "italic",
            opacity: quoteAnim.opacity,
            transform: quoteAnim.transform,
            textShadow: qs.textShadow ? "0 4px 20px rgba(0,0,0,0.5)" : "none",
          }}
        >
          {quote}
        </p>

        <div
          style={{
            width: lineWidth,
            height: 3,
            backgroundColor: brandColor,
            marginTop: 32,
            marginBottom: 24,
            borderRadius: 2,
          }}
        />

        {attribution && (
          <p
            style={{
              fontSize: as_.fontSize || 24,
              color: as_.color || brandColor,
              fontWeight: as_.fontWeight || 600,
              fontFamily: as_.fontFamily || "Inter, Arial, sans-serif",
              opacity: attrAnim.opacity,
              transform: attrAnim.transform,
              textTransform: "uppercase",
              letterSpacing: 2,
            }}
          >
            — {attribution}
          </p>
        )}
      </div>
    </div>
  );
};
