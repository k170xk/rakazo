import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  AnimationConfig,
  BackgroundConfig,
  StatItem,
  TextStyleConfig,
} from "../types";
import { SceneBackground } from "./SceneBackground";
import { useSceneAnimation } from "./useSceneAnimation";

type StatsLayout =
  | "grid"
  | "horizontal"
  | "vertical"
  | "highlight"
  | "progress";

interface StatsSceneProps {
  heading?: string;
  stats: StatItem[];
  brandColor: string;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  valueStyle?: TextStyleConfig;
  labelStyle?: TextStyleConfig;
  animation?: AnimationConfig;
  layout?: StatsLayout;
}

export const StatsScene: React.FC<StatsSceneProps> = ({
  heading,
  stats,
  brandColor,
  background,
  headingStyle,
  valueStyle,
  labelStyle,
  animation,
  layout,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headAnim = useSceneAnimation(animation, 0);
  const hs = headingStyle || {};
  const vs = valueStyle || {};
  const ls = labelStyle || {};

  // Auto-detect best layout if not set
  const effectiveLayout: StatsLayout =
    layout ||
    (stats.length === 1
      ? "highlight"
      : stats.length <= 3
        ? "horizontal"
        : "grid");

  const renderHeading = () =>
    heading ? (
      <h2
        style={{
          fontSize: hs.fontSize || 48,
          fontWeight: hs.fontWeight || 700,
          color: hs.color || "#0f172a",
          marginBottom: effectiveLayout === "highlight" ? 40 : 50,
          fontFamily: hs.fontFamily || "Inter, Arial, sans-serif",
          opacity: headAnim.opacity,
          transform: headAnim.transform,
          textAlign: "center",
        }}
      >
        {heading}
      </h2>
    ) : null;

  const renderStatCard = (
    stat: StatItem,
    i: number,
    style?: React.CSSProperties,
  ) => {
    const delay = 10 + i * 8;
    const statSpring = spring({
      frame: Math.max(0, frame - delay),
      fps,
      config: { damping: 15, stiffness: 120 },
    });
    const scale = interpolate(statSpring, [0, 1], [0.5, 1]);
    const opacity = interpolate(statSpring, [0, 1], [0, 1]);

    return (
      <div
        key={i}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "40px 20px",
          borderRadius: 16,
          backgroundColor: `${brandColor}10`,
          border: `1px solid ${brandColor}30`,
          transform: `scale(${scale})`,
          opacity,
          ...style,
        }}
      >
        <span
          style={{
            fontSize: vs.fontSize || 72,
            fontWeight: vs.fontWeight || 800,
            color: vs.color || brandColor,
            fontFamily: vs.fontFamily || "Inter, Arial, sans-serif",
            lineHeight: 1.1,
          }}
        >
          {stat.value}
        </span>
        <span
          style={{
            fontSize: ls.fontSize || 22,
            fontWeight: ls.fontWeight || 500,
            color: ls.color || "#94a3b8",
            fontFamily: ls.fontFamily || "Inter, Arial, sans-serif",
            marginTop: 12,
            textAlign: "center",
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          {stat.label}
        </span>
      </div>
    );
  };

  // ===== HIGHLIGHT LAYOUT: one big stat centred =====
  if (effectiveLayout === "highlight") {
    const mainStat = stats[0];
    const rest = stats.slice(1);
    const mainDelay = 8;
    const mainSpring = spring({
      frame: Math.max(0, frame - mainDelay),
      fps,
      config: { damping: 12, stiffness: 100 },
    });
    const mainScale = interpolate(mainSpring, [0, 1], [0.3, 1]);
    const mainOpacity = interpolate(mainSpring, [0, 1], [0, 1]);

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
            width: "85%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          {renderHeading()}
          {mainStat && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                transform: `scale(${mainScale})`,
                opacity: mainOpacity,
                marginBottom: rest.length > 0 ? 50 : 0,
              }}
            >
              <span
                style={{
                  fontSize: vs.fontSize || 120,
                  fontWeight: vs.fontWeight || 900,
                  color: vs.color || brandColor,
                  fontFamily: vs.fontFamily || "Inter, Arial, sans-serif",
                  lineHeight: 1,
                  textShadow: `0 0 60px ${brandColor}40`,
                }}
              >
                {mainStat.value}
              </span>
              <span
                style={{
                  fontSize: ls.fontSize || 28,
                  fontWeight: ls.fontWeight || 500,
                  color: ls.color || "#94a3b8",
                  fontFamily: ls.fontFamily || "Inter, Arial, sans-serif",
                  marginTop: 16,
                  textTransform: "uppercase",
                  letterSpacing: 2,
                }}
              >
                {mainStat.label}
              </span>
            </div>
          )}
          {rest.length > 0 && (
            <div style={{ display: "flex", gap: 40, justifyContent: "center" }}>
              {rest.map((s, i) =>
                renderStatCard(s, i + 1, { padding: "24px 30px" }),
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== HORIZONTAL LAYOUT: stats in a row with accent dividers =====
  if (effectiveLayout === "horizontal") {
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
            width: "90%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          {renderHeading()}
          <div
            style={{
              display: "flex",
              gap: 0,
              justifyContent: "center",
              alignItems: "center",
              width: "100%",
            }}
          >
            {stats.map((stat, i) => {
              const delay = 10 + i * 10;
              const sp = spring({
                frame: Math.max(0, frame - delay),
                fps,
                config: { damping: 14, stiffness: 110 },
              });
              const slideY = interpolate(sp, [0, 1], [40, 0]);
              const opacity = interpolate(sp, [0, 1], [0, 1]);

              return (
                <div key={i} style={{ display: "flex", alignItems: "center" }}>
                  {i > 0 && (
                    <div
                      style={{
                        width: 2,
                        height: 80,
                        backgroundColor: `${brandColor}40`,
                        margin: "0 40px",
                        opacity: interpolate(sp, [0, 1], [0, 0.6]),
                      }}
                    />
                  )}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      transform: `translateY(${slideY}px)`,
                      opacity,
                      minWidth: 160,
                    }}
                  >
                    <span
                      style={{
                        fontSize: vs.fontSize || 64,
                        fontWeight: vs.fontWeight || 800,
                        color: vs.color || brandColor,
                        fontFamily: vs.fontFamily || "Inter, Arial, sans-serif",
                        lineHeight: 1.1,
                      }}
                    >
                      {stat.value}
                    </span>
                    <span
                      style={{
                        fontSize: ls.fontSize || 20,
                        fontWeight: ls.fontWeight || 500,
                        color: ls.color || "#94a3b8",
                        fontFamily: ls.fontFamily || "Inter, Arial, sans-serif",
                        marginTop: 12,
                        textAlign: "center",
                        textTransform: "uppercase",
                        letterSpacing: 1,
                      }}
                    >
                      {stat.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ===== VERTICAL LAYOUT: stacked left-aligned with accent bars =====
  if (effectiveLayout === "vertical") {
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
            width: "70%",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {renderHeading()}
          {stats.map((stat, i) => {
            const delay = 8 + i * 8;
            const sp = spring({
              frame: Math.max(0, frame - delay),
              fps,
              config: { damping: 14, stiffness: 120 },
            });
            const slideX = interpolate(sp, [0, 1], [-60, 0]);
            const opacity = interpolate(sp, [0, 1], [0, 1]);

            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 24,
                  marginBottom: 30,
                  transform: `translateX(${slideX}px)`,
                  opacity,
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 70,
                    borderRadius: 3,
                    backgroundColor: brandColor,
                    flexShrink: 0,
                  }}
                />
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span
                    style={{
                      fontSize: vs.fontSize || 56,
                      fontWeight: vs.fontWeight || 800,
                      color: vs.color || brandColor,
                      fontFamily: vs.fontFamily || "Inter, Arial, sans-serif",
                      lineHeight: 1.1,
                    }}
                  >
                    {stat.value}
                  </span>
                  <span
                    style={{
                      fontSize: ls.fontSize || 20,
                      fontWeight: ls.fontWeight || 500,
                      color: ls.color || "#94a3b8",
                      fontFamily: ls.fontFamily || "Inter, Arial, sans-serif",
                      marginTop: 4,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                    }}
                  >
                    {stat.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ===== PROGRESS LAYOUT: stats with animated bar fills =====
  if (effectiveLayout === "progress") {
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
            width: "75%",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {renderHeading()}
          {stats.map((stat, i) => {
            const delay = 10 + i * 10;
            const sp = spring({
              frame: Math.max(0, frame - delay),
              fps,
              config: { damping: 20, stiffness: 80 },
            });
            const opacity = interpolate(sp, [0, 1], [0, 1]);
            // Parse a numeric value for bar width (e.g. "95%" → 95, "4.8" → 96)
            const numericMatch = stat.value.match(/[\d.]+/);
            const numericVal = numericMatch ? parseFloat(numericMatch[0]) : 50;
            const barWidth =
              numericVal > 100
                ? 85
                : numericVal <= 10
                  ? numericVal * 10
                  : numericVal;
            const barFill = interpolate(sp, [0, 1], [0, barWidth]);

            return (
              <div key={i} style={{ marginBottom: 36, opacity }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    marginBottom: 10,
                  }}
                >
                  <span
                    style={{
                      fontSize: ls.fontSize || 20,
                      fontWeight: ls.fontWeight || 600,
                      color: ls.color || "#1f2937",
                      fontFamily: ls.fontFamily || "Inter, Arial, sans-serif",
                      textTransform: "uppercase",
                      letterSpacing: 1,
                    }}
                  >
                    {stat.label}
                  </span>
                  <span
                    style={{
                      fontSize: vs.fontSize || 36,
                      fontWeight: vs.fontWeight || 800,
                      color: vs.color || brandColor,
                      fontFamily: vs.fontFamily || "Inter, Arial, sans-serif",
                    }}
                  >
                    {stat.value}
                  </span>
                </div>
                <div
                  style={{
                    width: "100%",
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: `${brandColor}15`,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${barFill}%`,
                      height: "100%",
                      borderRadius: 6,
                      background: `linear-gradient(90deg, ${brandColor}, ${brandColor}cc)`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ===== DEFAULT GRID LAYOUT =====
  const columns =
    stats.length <= 2 ? stats.length : stats.length <= 4 ? stats.length : 4;

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
          width: "85%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {renderHeading()}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gap: 40,
            width: "100%",
          }}
        >
          {stats.map((stat, i) => renderStatCard(stat, i))}
        </div>
      </div>
    </div>
  );
};
