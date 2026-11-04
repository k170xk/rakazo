import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  AnimationConfig,
  BackgroundConfig,
  TeamMember,
  TextStyleConfig,
} from "../types";
import { Picture } from "./Picture";
import { SceneBackground } from "./SceneBackground";
import { useSceneAnimation } from "./useSceneAnimation";

interface Props {
  heading?: string;
  members: TeamMember[];
  brandColor: string;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
  footerInset?: number;
}

const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export const TeamCardsScene: React.FC<Props> = ({
  heading,
  members,
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

  const cols =
    members.length <= 2
      ? members.length
      : members.length <= 4
        ? 4
        : Math.min(members.length, 5);

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
              fontSize: hs.fontSize || 48,
              fontWeight: hs.fontWeight || 700,
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
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 32,
            justifyItems: "center",
          }}
        >
          {members.map((m, i) => {
            const delay = 12 + i * 6;
            const sp = spring({
              frame: Math.max(0, frame - delay),
              fps,
              config: { damping: 14, stiffness: 110 },
            });
            const y = interpolate(sp, [0, 1], [40, 0]);
            const op = interpolate(sp, [0, 1], [0, 1]);
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  textAlign: "center",
                  opacity: op,
                  transform: `translateY(${y}px)`,
                  padding: "24px 16px",
                  borderRadius: 20,
                  backgroundColor: `${brandColor}08`,
                  border: `1px solid ${brandColor}25`,
                }}
              >
                <div
                  style={{
                    width: 140,
                    height: 140,
                    borderRadius: 70,
                    overflow: "hidden",
                    marginBottom: 18,
                    border: `4px solid ${brandColor}`,
                    boxShadow: `0 8px 24px ${brandColor}40`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: `${brandColor}30`,
                    position: "relative",
                  }}
                >
                  {m.photoUrl ? (
                    <>
                      <Picture
                        src={m.photoUrl}
                        alt={m.name}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          filter: "grayscale(100%)",
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          backgroundColor: `${brandColor}20`,
                          pointerEvents: "none",
                        }}
                      />
                    </>
                  ) : (
                    <span
                      style={{
                        fontSize: 48,
                        fontWeight: 800,
                        color: "#0f172a",
                      }}
                    >
                      {initials(m.name)}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: "#0f172a",
                    lineHeight: 1.2,
                  }}
                >
                  {m.name}
                </div>
                <div
                  style={{
                    fontSize: 16,
                    color: brandColor,
                    marginTop: 6,
                    textTransform: "uppercase",
                    letterSpacing: 1.5,
                    fontWeight: 600,
                  }}
                >
                  {m.role}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
