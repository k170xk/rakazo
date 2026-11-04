import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  AnimationConfig,
  BackgroundConfig,
  TextStyleConfig,
} from "../types";
import { SceneBackground } from "./SceneBackground";
import { FOOTER_SAFE_PX } from "./safeArea";
import { useSceneAnimation } from "./useSceneAnimation";

interface FullscreenTextSceneProps {
  text: string;
  subtext?: string;
  brandColor: string;
  background?: BackgroundConfig;
  textStyle?: TextStyleConfig;
  subtextStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export const FullscreenTextScene: React.FC<FullscreenTextSceneProps> = ({
  text,
  subtext,
  brandColor,
  background,
  textStyle,
  subtextStyle,
  animation,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const textAnim = useSceneAnimation(animation, 0);
  const subAnim = useSceneAnimation(animation, 2);

  const ts = textStyle || {};
  const ss = subtextStyle || {};

  // Subtle scale pulse for dramatic effect
  const breathe = interpolate(frame, [0, 60, 120], [1, 1.02, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        paddingBottom: FOOTER_SAFE_PX,
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
          padding: "60px 120px",
          transform: `scale(${breathe})`,
        }}
      >
        <h1
          style={{
            fontSize: ts.fontSize || 84,
            fontWeight: ts.fontWeight || 900,
            color: ts.color || "#0f172a",
            textAlign: (ts.textAlign || "center") as any,
            maxWidth: "90%",
            lineHeight: ts.lineHeight || 1.15,
            fontFamily: ts.fontFamily || "Inter, Arial, sans-serif",
            letterSpacing: ts.letterSpacing || -1,
            opacity: textAnim.opacity,
            transform: textAnim.transform,
            textShadow: ts.textShadow ? "0 4px 30px rgba(0,0,0,0.5)" : "none",
          }}
        >
          {text}
        </h1>

        {subtext && (
          <p
            style={{
              fontSize: ss.fontSize || 28,
              fontWeight: ss.fontWeight || 400,
              color: ss.color || brandColor,
              fontFamily: ss.fontFamily || "Inter, Arial, sans-serif",
              marginTop: 32,
              opacity: subAnim.opacity,
              transform: subAnim.transform,
              textAlign: "center",
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            {subtext}
          </p>
        )}
      </div>
    </div>
  );
};
