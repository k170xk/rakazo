import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  AnimationConfig,
  BackgroundConfig,
  IconListItem,
  TextStyleConfig,
} from "../types";
import { resolveIcon } from "./iconResolver";
import { SceneBackground } from "./SceneBackground";
import { useSceneAnimation } from "./useSceneAnimation";

interface Props {
  heading?: string;
  items: IconListItem[];
  brandColor: string;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
  footerInset?: number;
}

export const IconListScene: React.FC<Props> = ({
  heading,
  items,
  brandColor,
  background,
  headingStyle,
  animation,
  footerInset = 0,
}) => {
  const safeItems = Array.isArray(items) ? items : [];
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
        padding: `80px 140px ${80 + footerInset}px`,
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
              marginBottom: 40,
              opacity: headAnim.opacity,
              transform: headAnim.transform,
            }}
          >
            {heading}
          </h2>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {safeItems.map((it, i) => {
            const delay = 12 + i * 8;
            const sp = spring({
              frame: Math.max(0, frame - delay),
              fps,
              config: { damping: 16, stiffness: 110 },
            });
            const x = interpolate(sp, [0, 1], [-40, 0]);
            const op = interpolate(sp, [0, 1], [0, 1]);
            const Icon = resolveIcon(it.icon);
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 28,
                  opacity: op,
                  transform: `translateX(${x}px)`,
                  padding: "20px 24px",
                  borderRadius: 16,
                  backgroundColor: `${brandColor}08`,
                  border: `1px solid ${brandColor}25`,
                }}
              >
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 16,
                    background: `linear-gradient(135deg, ${brandColor}, ${brandColor}cc)`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#ffffff",
                    flexShrink: 0,
                    boxShadow: `0 6px 20px ${brandColor}40`,
                  }}
                >
                  <Icon size={38} strokeWidth={2.25} color="#ffffff" />
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{ fontSize: 28, fontWeight: 700, color: "#0f172a" }}
                  >
                    {it.title}
                  </div>
                  {it.description && (
                    <div
                      style={{
                        fontSize: 18,
                        color: "#64748b",
                        marginTop: 4,
                        lineHeight: 1.4,
                      }}
                    >
                      {it.description}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
