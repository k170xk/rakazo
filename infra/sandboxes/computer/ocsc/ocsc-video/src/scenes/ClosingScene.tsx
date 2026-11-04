import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  AnimationConfig,
  BackgroundConfig,
  TextStyleConfig,
} from "../types";
import { Picture } from "./Picture";
import { SceneBackground } from "./SceneBackground";
import { useSceneAnimation } from "./useSceneAnimation";

interface ClosingSceneProps {
  heading: string;
  subheading?: string;
  brandColor: string;
  logoUrl?: string;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  subheadingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export const ClosingScene: React.FC<ClosingSceneProps> = ({
  heading,
  subheading,
  brandColor,
  logoUrl,
  background,
  headingStyle,
  subheadingStyle,
  animation,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headingAnim = useSceneAnimation(animation, 0);
  const subAnim = useSceneAnimation(animation, 1);
  const logoAnim = useSceneAnimation(animation, 2);

  const circleScale = spring({
    frame: Math.max(0, frame - 5),
    fps,
    config: { damping: 30 },
  });

  const hs = headingStyle || {};
  const ss = subheadingStyle || {};

  return (
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
      <SceneBackground config={background} brandColor={brandColor} />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* Decorative circle */}
        <div
          style={{
            position: "absolute",
            width: 500,
            height: 500,
            borderRadius: "50%",
            border: `2px solid ${brandColor}`,
            opacity: 0.1,
            transform: `scale(${circleScale})`,
            top: "50%",
            left: "50%",
            marginTop: -250,
            marginLeft: -250,
          }}
        />

        <h1
          style={{
            fontSize: hs.fontSize || 64,
            fontWeight: hs.fontWeight || 800,
            color: hs.color || "#0f172a",
            textAlign: (hs.textAlign || "center") as any,
            maxWidth: "70%",
            lineHeight: hs.lineHeight || 1.2,
            fontFamily: hs.fontFamily || "Inter, Arial, sans-serif",
            opacity: headingAnim.opacity,
            transform: headingAnim.transform,
            textShadow: hs.textShadow ? "0 4px 20px rgba(0,0,0,0.5)" : "none",
          }}
        >
          {heading}
        </h1>
        {subheading && (
          <p
            style={{
              fontSize: ss.fontSize || 28,
              color: ss.color || brandColor,
              marginTop: 20,
              fontFamily: ss.fontFamily || "Inter, Arial, sans-serif",
              fontWeight: ss.fontWeight || 500,
              opacity: subAnim.opacity,
              transform: subAnim.transform,
            }}
          >
            {subheading}
          </p>
        )}
        {logoUrl && (
          <Picture
            src={logoUrl}
            alt=""
            style={{
              height: 50,
              marginTop: 48,
              opacity: logoAnim.opacity,
              transform: logoAnim.transform,
            }}
          />
        )}
      </div>
    </div>
  );
};
