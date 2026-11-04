import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  AnimationConfig,
  BackgroundConfig,
  ProcessStep,
  TextStyleConfig,
} from "../types";
import { SceneBackground } from "./SceneBackground";
import { useSceneAnimation } from "./useSceneAnimation";

interface Props {
  heading?: string;
  steps: ProcessStep[];
  brandColor: string;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export const ProcessStepsScene: React.FC<Props> = ({
  heading,
  steps,
  brandColor,
  background,
  headingStyle,
  animation,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const headAnim = useSceneAnimation(animation, 0);
  const hs = headingStyle || {};

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "80px 100px",
      }}
    >
      <SceneBackground config={background} brandColor={brandColor} />
      <div style={{ position: "relative", zIndex: 1 }}>
        {heading && (
          <h2
            style={{
              fontSize: hs.fontSize || 48,
              fontWeight: hs.fontWeight || 700,
              color: hs.color || "#0f172a",
              marginBottom: 60,
              textAlign: "center",
              opacity: headAnim.opacity,
              transform: headAnim.transform,
            }}
          >
            {heading}
          </h2>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "stretch",
            gap: 0,
          }}
        >
          {steps.map((s, i) => {
            const delay = 12 + i * 12;
            const sp = spring({
              frame: Math.max(0, frame - delay),
              fps,
              config: { damping: 15, stiffness: 110 },
            });
            const op = interpolate(sp, [0, 1], [0, 1]);
            const scale = interpolate(sp, [0, 1], [0.85, 1]);
            const arrowSp = spring({
              frame: Math.max(0, frame - delay - 8),
              fps,
              config: { damping: 18, stiffness: 130 },
            });
            const arrowOp = interpolate(arrowSp, [0, 1], [0, 1]);
            return (
              <div
                key={i}
                style={{ display: "flex", alignItems: "center", flex: 1 }}
              >
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    opacity: op,
                    transform: `scale(${scale})`,
                    padding: "24px 16px",
                    borderRadius: 20,
                    backgroundColor: `${brandColor}10`,
                    border: `1px solid ${brandColor}30`,
                  }}
                >
                  <div
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 36,
                      background: `linear-gradient(135deg, ${brandColor}, ${brandColor}cc)`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 32,
                      fontWeight: 800,
                      color: "#0f172a",
                      marginBottom: 18,
                      boxShadow: `0 8px 24px ${brandColor}40`,
                    }}
                  >
                    {i + 1}
                  </div>
                  <div
                    style={{
                      fontSize: 24,
                      color: "#0f172a",
                      fontWeight: 700,
                      marginBottom: 8,
                    }}
                  >
                    {s.title}
                  </div>
                  {s.description && (
                    <div
                      style={{
                        fontSize: 16,
                        color: "#64748b",
                        lineHeight: 1.4,
                      }}
                    >
                      {s.description}
                    </div>
                  )}
                </div>
                {i < steps.length - 1 && (
                  <div
                    style={{
                      padding: "0 8px",
                      opacity: arrowOp,
                      color: brandColor,
                      fontSize: 36,
                      fontWeight: 800,
                    }}
                  >
                    →
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
