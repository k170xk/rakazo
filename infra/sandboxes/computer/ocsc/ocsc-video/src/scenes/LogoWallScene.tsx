import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  AnimationConfig,
  BackgroundConfig,
  LogoItem,
  TextStyleConfig,
} from "../types";
import { Picture } from "./Picture";
import { SceneBackground } from "./SceneBackground";
import { useSceneAnimation } from "./useSceneAnimation";

interface Props {
  heading?: string;
  logos: LogoItem[];
  columns?: 3 | 4 | 5 | 6;
  brandColor: string;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
  footerInset?: number;
}

export const LogoWallScene: React.FC<Props> = ({
  heading,
  logos,
  columns = 4,
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

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: `80px 100px ${80 + footerInset}px`,
      }}
    >
      <SceneBackground config={background} brandColor={brandColor} />
      <div style={{ position: "relative", zIndex: 1 }}>
        {heading && (
          <h2
            style={{
              fontSize: hs.fontSize || 42,
              fontWeight: hs.fontWeight || 600,
              color: hs.color || "#0f172a",
              marginBottom: 50,
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
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gap: 24,
          }}
        >
          {logos.map((l, i) => {
            const delay = 8 + i * 4;
            const sp = spring({
              frame: Math.max(0, frame - delay),
              fps,
              config: { damping: 16, stiffness: 110 },
            });
            const op = interpolate(sp, [0, 1], [0, 1]);
            const scale = interpolate(sp, [0, 1], [0.7, 1]);
            return (
              <div
                key={i}
                style={{
                  aspectRatio: "16/9",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 16,
                  borderRadius: 12,
                  backgroundColor: "#ffffff10",
                  border: "1px solid #ffffff15",
                  opacity: op,
                  transform: `scale(${scale})`,
                }}
              >
                {l.url ? (
                  <Picture
                    src={l.url}
                    alt={l.name || ""}
                    style={{
                      maxWidth: "80%",
                      maxHeight: "70%",
                      objectFit: "contain",
                      filter: "brightness(1.1)",
                    }}
                  />
                ) : (
                  <div
                    style={{ fontSize: 24, fontWeight: 700, color: "#475569" }}
                  >
                    {l.name || "Logo"}
                  </div>
                )}
                {l.name && l.url && (
                  <div
                    style={{
                      fontSize: 14,
                      color: "#64748b",
                      marginTop: 8,
                      textAlign: "center",
                    }}
                  >
                    {l.name}
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
