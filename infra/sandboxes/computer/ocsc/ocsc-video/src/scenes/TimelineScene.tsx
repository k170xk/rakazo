import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  AnimationConfig,
  BackgroundConfig,
  TextStyleConfig,
  TimelineItem,
} from "../types";
import { SceneBackground } from "./SceneBackground";
import { useSceneAnimation } from "./useSceneAnimation";

interface Props {
  heading?: string;
  items: TimelineItem[];
  orientation?: "horizontal" | "vertical";
  brandColor: string;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export const TimelineScene: React.FC<Props> = ({
  heading,
  items,
  orientation = "horizontal",
  brandColor,
  background,
  headingStyle,
  animation,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const headAnim = useSceneAnimation(animation, 0);
  const hs = headingStyle || {};

  const lineProgress = spring({
    frame: Math.max(0, frame - 8),
    fps,
    config: { damping: 25, stiffness: 60 },
  });

  if (orientation === "vertical") {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px 160px",
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
                marginBottom: 50,
                opacity: headAnim.opacity,
                transform: headAnim.transform,
              }}
            >
              {heading}
            </h2>
          )}
          <div style={{ position: "relative", paddingLeft: 50 }}>
            <div
              style={{
                position: "absolute",
                left: 18,
                top: 0,
                bottom: 0,
                width: 4,
                backgroundColor: `${brandColor}30`,
                borderRadius: 2,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 18,
                top: 0,
                width: 4,
                height: `${lineProgress * 100}%`,
                background: `linear-gradient(180deg, ${brandColor}, ${brandColor}99)`,
                borderRadius: 2,
              }}
            />
            {items.map((it, i) => {
              const delay = 14 + i * 10;
              const sp = spring({
                frame: Math.max(0, frame - delay),
                fps,
                config: { damping: 14, stiffness: 110 },
              });
              const x = interpolate(sp, [0, 1], [40, 0]);
              const op = interpolate(sp, [0, 1], [0, 1]);
              return (
                <div
                  key={i}
                  style={{
                    position: "relative",
                    marginBottom: 32,
                    opacity: op,
                    transform: `translateX(${x}px)`,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: -42,
                      top: 8,
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      backgroundColor: brandColor,
                      boxShadow: `0 0 0 6px ${brandColor}30`,
                    }}
                  />
                  <div
                    style={{
                      fontSize: 22,
                      color: brandColor,
                      fontWeight: 700,
                      letterSpacing: 1,
                    }}
                  >
                    {it.date}
                  </div>
                  <div
                    style={{
                      fontSize: 30,
                      color: "#0f172a",
                      fontWeight: 700,
                      marginTop: 4,
                    }}
                  >
                    {it.label}
                  </div>
                  {it.description && (
                    <div
                      style={{
                        fontSize: 20,
                        color: "#64748b",
                        marginTop: 6,
                        maxWidth: 700,
                      }}
                    >
                      {it.description}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

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
            position: "relative",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 24,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 30,
              height: 4,
              backgroundColor: `${brandColor}30`,
              borderRadius: 2,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 30,
              width: `${lineProgress * 100}%`,
              height: 4,
              background: `linear-gradient(90deg, ${brandColor}, ${brandColor}99)`,
              borderRadius: 2,
            }}
          />
          {items.map((it, i) => {
            const delay = 14 + i * 8;
            const sp = spring({
              frame: Math.max(0, frame - delay),
              fps,
              config: { damping: 14, stiffness: 110 },
            });
            const y = interpolate(sp, [0, 1], [30, 0]);
            const op = interpolate(sp, [0, 1], [0, 1]);
            return (
              <div
                key={i}
                style={{
                  position: "relative",
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  textAlign: "center",
                  opacity: op,
                  transform: `translateY(${y}px)`,
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: brandColor,
                    boxShadow: `0 0 0 6px ${brandColor}30`,
                    marginBottom: 24,
                  }}
                />
                <div
                  style={{
                    fontSize: 22,
                    color: brandColor,
                    fontWeight: 700,
                    letterSpacing: 1,
                  }}
                >
                  {it.date}
                </div>
                <div
                  style={{
                    fontSize: 26,
                    color: "#0f172a",
                    fontWeight: 700,
                    marginTop: 6,
                  }}
                >
                  {it.label}
                </div>
                {it.description && (
                  <div
                    style={{
                      fontSize: 16,
                      color: "#64748b",
                      marginTop: 8,
                      maxWidth: 220,
                    }}
                  >
                    {it.description}
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
