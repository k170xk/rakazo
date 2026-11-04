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
  heading?: string;
  locationName: string;
  coordinates?: string;
  imageUrl?: string;
  brandColor: string;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export const MapCalloutScene: React.FC<Props> = ({
  heading,
  locationName,
  coordinates,
  imageUrl,
  brandColor,
  background,
  headingStyle,
  animation,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const headAnim = useSceneAnimation(animation, 0);
  const hs = headingStyle || {};

  const pinSp = spring({
    frame: Math.max(0, frame - 14),
    fps,
    config: { damping: 8, stiffness: 200 },
  });
  const pinScale = interpolate(pinSp, [0, 1], [0, 1]);
  const pinY = interpolate(pinSp, [0, 1], [-60, 0]);

  // Pulse rings
  const pulseFrame = (frame - 30) % 60;
  const pulse1 = interpolate(pulseFrame, [0, 60], [0.6, 1.6], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pulse1Op = interpolate(pulseFrame, [0, 60], [0.7, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <SceneBackground config={background} brandColor={brandColor} />
      {imageUrl && (
        <Picture
          src={imageUrl}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: 0.85,
            filter: "saturate(0.7)",
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at center, transparent 40%, rgba(15,23,42,0.25) 90%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {heading && (
          <h2
            style={{
              fontSize: hs.fontSize || 32,
              fontWeight: hs.fontWeight || 600,
              color: hs.color || "#0f172a",
              marginBottom: 24,
              textTransform: "uppercase",
              letterSpacing: 4,
              padding: "10px 28px",
              borderRadius: 999,
              backgroundColor: "rgba(255,255,255,0.95)",
              boxShadow: "0 8px 24px rgba(15,23,42,0.18)",
              opacity: headAnim.opacity,
              transform: headAnim.transform,
            }}
          >
            {heading}
          </h2>
        )}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            transform: `translateY(${pinY}px) scale(${pinScale})`,
          }}
        >
          <div
            style={{
              position: "absolute",
              width: 80,
              height: 80,
              borderRadius: 40,
              border: `3px solid ${brandColor}`,
              transform: `scale(${pulse1})`,
              opacity: pulse1Op,
              top: 0,
            }}
          />
          <svg
            width="80"
            height="100"
            viewBox="0 0 80 100"
            style={{ filter: `drop-shadow(0 8px 16px ${brandColor}80)` }}
          >
            <path
              d="M40 0C18 0 0 18 0 40c0 30 40 60 40 60s40-30 40-60C80 18 62 0 40 0z"
              fill={brandColor}
            />
            <circle cx="40" cy="40" r="14" fill="#ffffff" />
          </svg>
        </div>
        <div
          style={{
            marginTop: 32,
            padding: "20px 36px",
            borderRadius: 12,
            backgroundColor: "rgba(255,255,255,0.96)",
            border: `2px solid ${brandColor}`,
            boxShadow: "0 12px 40px rgba(15,23,42,0.25)",
            opacity: interpolate(frame, [22, 36], [0, 1], {
              extrapolateRight: "clamp",
            }),
          }}
        >
          <div
            style={{
              fontSize: 42,
              fontWeight: 800,
              color: "#0f172a",
              textAlign: "center",
            }}
          >
            {locationName}
          </div>
          {coordinates && (
            <div
              style={{
                fontSize: 18,
                color: brandColor,
                marginTop: 6,
                textAlign: "center",
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: 1,
              }}
            >
              {coordinates}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
