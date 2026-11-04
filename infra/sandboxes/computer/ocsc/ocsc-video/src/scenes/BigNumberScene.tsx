import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  AnimationConfig,
  BackgroundConfig,
  TextStyleConfig,
} from "../types";
import { SceneBackground } from "./SceneBackground";
import { useSceneAnimation } from "./useSceneAnimation";

interface Props {
  value: string;
  label: string;
  context?: string;
  brandColor: string;
  background?: BackgroundConfig;
  valueStyle?: TextStyleConfig;
  labelStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

// Try to parse a numeric value and animate counting up
function parseTarget(
  value: string,
): { num: number; prefix: string; suffix: string } | null {
  const m = value.match(/^([^\d.-]*)(-?[\d,]+(?:\.\d+)?)([^\d]*)$/);
  if (!m) return null;
  const num = parseFloat(m[2].replace(/,/g, ""));
  if (isNaN(num)) return null;
  return { num, prefix: m[1], suffix: m[3] };
}

function formatWithCommas(n: number, decimals: number) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export const BigNumberScene: React.FC<Props> = ({
  value,
  label,
  context,
  brandColor,
  background,
  valueStyle,
  labelStyle,
  animation,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lAnim = useSceneAnimation(animation, 1);
  const cAnim = useSceneAnimation(animation, 2);

  const target = parseTarget(value);
  const countSp = spring({
    frame: Math.max(0, frame - 6),
    fps,
    config: { damping: 30, stiffness: 60, mass: 1.2 },
  });
  const decimals =
    target && target.num % 1 !== 0
      ? value.split(".")[1]?.replace(/[^\d]/g, "").length || 1
      : 0;
  const displayed = target
    ? `${target.prefix}${formatWithCommas(target.num * countSp, decimals)}${target.suffix}`
    : value;

  const valueScale = interpolate(
    spring({ frame, fps, config: { damping: 16, stiffness: 100 } }),
    [0, 1],
    [0.7, 1],
  );
  const valueOp = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: "clamp",
  });

  const vs = valueStyle || {};
  const ls = labelStyle || {};

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
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: vs.fontSize || 280,
            fontWeight: vs.fontWeight || 900,
            color: vs.color || brandColor,
            lineHeight: 0.95,
            fontFamily: vs.fontFamily || "Inter, Arial, sans-serif",
            letterSpacing: -4,
            opacity: valueOp,
            transform: `scale(${valueScale})`,
            textShadow: `0 0 100px ${brandColor}30`,
          }}
        >
          {displayed}
        </div>
        <div
          style={{
            fontSize: ls.fontSize || 36,
            fontWeight: ls.fontWeight || 600,
            color: ls.color || "#0f172a",
            marginTop: 24,
            textTransform: "uppercase",
            letterSpacing: 4,
            opacity: lAnim.opacity,
            transform: lAnim.transform,
          }}
        >
          {label}
        </div>
        {context && (
          <div
            style={{
              fontSize: 22,
              color: "#64748b",
              marginTop: 16,
              maxWidth: 800,
              lineHeight: 1.5,
              opacity: cAnim.opacity,
              transform: cAnim.transform,
            }}
          >
            {context}
          </div>
        )}
      </div>
    </div>
  );
};
