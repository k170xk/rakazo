import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  AnimationConfig,
  BackgroundConfig,
  TextStyleConfig,
} from "../types";
import { Picture } from "./Picture";
import { SceneBackground } from "./SceneBackground";
import { useSceneAnimation } from "./useSceneAnimation";

interface Props {
  quote: string;
  attribution?: string;
  role?: string;
  portraitUrl?: string;
  brandColor: string;
  background?: BackgroundConfig;
  quoteStyle?: TextStyleConfig;
  attributionStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export const PullQuoteScene: React.FC<Props> = ({
  quote,
  attribution,
  role,
  portraitUrl,
  brandColor,
  background,
  quoteStyle,
  attributionStyle,
  animation,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const qAnim = useSceneAnimation(animation, 0);
  const aAnim = useSceneAnimation(animation, 2);
  const portraitSp = spring({
    frame: Math.max(0, frame - 4),
    fps,
    config: { damping: 18, stiffness: 100 },
  });
  const portraitScale = interpolate(portraitSp, [0, 1], [0.85, 1]);
  const portraitOp = interpolate(portraitSp, [0, 1], [0, 1]);

  const qs = quoteStyle || {};
  const ats = attributionStyle || {};

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex" }}>
      <SceneBackground config={background} brandColor={brandColor} />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          flex: 1,
          display: "flex",
          alignItems: "center",
          padding: "80px 120px",
          gap: 80,
        }}
      >
        {portraitUrl && (
          <div
            style={{
              flexShrink: 0,
              width: 320,
              height: 420,
              borderRadius: 8,
              overflow: "hidden",
              boxShadow: `0 20px 60px rgba(0,0,0,0.4), 0 0 0 4px ${brandColor}`,
              opacity: portraitOp,
              transform: `scale(${portraitScale})`,
            }}
          >
            <Picture
              src={portraitUrl}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
        )}
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 220,
              lineHeight: 0.7,
              color: brandColor,
              fontFamily: "'Source Serif 4', Georgia, serif",
              marginBottom: -40,
              opacity: 0.5,
            }}
          >
            "
          </div>
          <p
            style={{
              fontSize: qs.fontSize || 56,
              fontWeight: qs.fontWeight || 600,
              color: qs.color || "#0f172a",
              lineHeight: 1.25,
              fontFamily: qs.fontFamily || "'Source Serif 4', Georgia, serif",
              opacity: qAnim.opacity,
              transform: qAnim.transform,
            }}
          >
            {quote}
          </p>
          {(attribution || role) && (
            <div
              style={{
                marginTop: 36,
                opacity: aAnim.opacity,
                transform: aAnim.transform,
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 3,
                  backgroundColor: brandColor,
                  borderRadius: 2,
                }}
              />
              <div>
                {attribution && (
                  <div
                    style={{
                      fontSize: ats.fontSize || 24,
                      fontWeight: 700,
                      color: ats.color || "#0f172a",
                    }}
                  >
                    {attribution}
                  </div>
                )}
                {role && (
                  <div
                    style={{
                      fontSize: 18,
                      color: brandColor,
                      marginTop: 2,
                      textTransform: "uppercase",
                      letterSpacing: 2,
                    }}
                  >
                    {role}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
