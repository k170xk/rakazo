import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  AnimationConfig,
  BackgroundConfig,
  TextStyleConfig,
} from "../types";
import { SceneBackground } from "./SceneBackground";
import { useSceneAnimation } from "./useSceneAnimation";

interface Props {
  heading?: string;
  leftLabel: string;
  leftPoints: string[];
  rightLabel: string;
  rightPoints: string[];
  leftAccent?: "positive" | "negative" | "neutral";
  rightAccent?: "positive" | "negative" | "neutral";
  brandColor: string;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
  footerInset?: number;
}

const accentColor = (
  a: "positive" | "negative" | "neutral",
  brandColor: string,
) => {
  if (a === "positive") return brandColor;
  if (a === "negative") return "#ef4444";
  return "#64748b";
};

export const ComparisonScene: React.FC<Props> = ({
  heading,
  leftLabel,
  leftPoints,
  rightLabel,
  rightPoints,
  leftAccent = "neutral",
  rightAccent = "positive",
  brandColor,
  background,
  headingStyle,
  animation,
  footerInset = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const headAnim = useSceneAnimation(animation, 0);
  const hs = headingStyle || {};

  const leftColor = accentColor(leftAccent, brandColor);
  const rightColor = accentColor(rightAccent, brandColor);

  const renderColumn = (
    label: string,
    points: string[],
    color: string,
    side: "left" | "right",
  ) => {
    const colSp = spring({
      frame: Math.max(0, frame - (side === "left" ? 4 : 8)),
      fps,
      config: { damping: 18, stiffness: 100 },
    });
    const x = interpolate(colSp, [0, 1], [side === "left" ? -40 : 40, 0]);
    const op = interpolate(colSp, [0, 1], [0, 1]);
    return (
      <div
        style={{
          flex: 1,
          padding: "40px 40px",
          borderRadius: 20,
          backgroundColor: `${color}10`,
          border: `2px solid ${color}40`,
          opacity: op,
          transform: `translateX(${x}px)`,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            fontSize: 32,
            fontWeight: 800,
            color,
            marginBottom: 24,
            textTransform: "uppercase",
            letterSpacing: 2,
            textAlign: "center",
            borderBottom: `2px solid ${color}40`,
            paddingBottom: 16,
          }}
        >
          {label}
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {points.map((p, i) => {
            const delay = 18 + i * 6;
            const sp = spring({
              frame: Math.max(0, frame - delay),
              fps,
              config: { damping: 16, stiffness: 130 },
            });
            const y = interpolate(sp, [0, 1], [16, 0]);
            const o = interpolate(sp, [0, 1], [0, 1]);
            return (
              <li
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  marginBottom: 14,
                  opacity: o,
                  transform: `translateY(${y}px)`,
                }}
              >
                <span
                  style={{
                    color,
                    fontSize: 22,
                    fontWeight: 800,
                    lineHeight: 1.3,
                  }}
                >
                  •
                </span>
                <span
                  style={{ fontSize: 20, color: "#334155", lineHeight: 1.4 }}
                >
                  {p}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: `60px 80px ${60 + footerInset}px`,
      }}
    >
      <SceneBackground config={background} brandColor={brandColor} />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {heading && (
          <h2
            style={{
              fontSize: hs.fontSize || 44,
              fontWeight: hs.fontWeight || 700,
              color: hs.color || "#0f172a",
              marginBottom: 36,
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
            alignItems: "stretch",
            gap: 32,
            position: "relative",
          }}
        >
          {renderColumn(leftLabel, leftPoints, leftColor, "left")}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: brandColor,
              color: "#0f172a",
              fontSize: 24,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 0 0 8px hsl(0 0% 4%), 0 8px 24px ${brandColor}50`,
              zIndex: 2,
            }}
          >
            VS
          </div>
          {renderColumn(rightLabel, rightPoints, rightColor, "right")}
        </div>
      </div>
    </div>
  );
};
