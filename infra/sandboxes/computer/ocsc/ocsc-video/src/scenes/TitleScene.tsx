import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  AnimationConfig,
  BackgroundConfig,
  TextStyleConfig,
} from "../types";
import { Picture } from "./Picture";
import { SceneBackground } from "./SceneBackground";
import { useSceneAnimation } from "./useSceneAnimation";

interface TitleSceneProps {
  heading: string;
  subheading?: string;
  brandColor: string;
  logoUrl?: string;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  subheadingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export const TitleScene: React.FC<TitleSceneProps> = ({
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

  const logoAnim = useSceneAnimation(animation, 0);
  const headingAnim = useSceneAnimation(animation, 1);
  const lineAnim = useSceneAnimation(animation, 2);
  const subAnim = useSceneAnimation(animation, 3);

  const lineWidth = interpolate(
    spring({
      frame: Math.max(0, frame - (animation?.staggerDelay || 8) * 2),
      fps,
      config: { damping: 25 },
    }),
    [0, 1],
    [0, 200],
  );

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
        {logoUrl && (
          <Picture
            src={logoUrl}
            alt=""
            style={{
              height: 80,
              marginBottom: 32,
              opacity: logoAnim.opacity,
              transform: logoAnim.transform,
            }}
          />
        )}
        <h1
          style={{
            fontSize: hs.fontSize || 72,
            fontWeight: hs.fontWeight || 800,
            color: hs.color || "#0f172a",
            textAlign: (hs.textAlign || "center") as any,
            maxWidth: "80%",
            lineHeight: hs.lineHeight || 1.1,
            fontFamily: hs.fontFamily || "Inter, Arial, sans-serif",
            opacity: headingAnim.opacity,
            transform: headingAnim.transform,
            textShadow: hs.textShadow ? "0 4px 20px rgba(0,0,0,0.5)" : "none",
            letterSpacing: hs.letterSpacing || 0,
          }}
        >
          {heading}
        </h1>
        <div
          style={{
            width: lineWidth,
            height: 4,
            backgroundColor: brandColor,
            marginTop: 24,
            marginBottom: 24,
            borderRadius: 2,
            opacity: lineAnim.opacity,
          }}
        />
        {subheading && (
          <p
            style={{
              fontSize: ss.fontSize || 32,
              color: ss.color || brandColor,
              fontWeight: ss.fontWeight || 500,
              fontFamily: ss.fontFamily || "Inter, Arial, sans-serif",
              opacity: subAnim.opacity,
              transform: subAnim.transform,
              textShadow: ss.textShadow ? "0 2px 10px rgba(0,0,0,0.4)" : "none",
              textAlign: (ss.textAlign || "center") as any,
            }}
          >
            {subheading}
          </p>
        )}
      </div>
    </div>
  );
};
