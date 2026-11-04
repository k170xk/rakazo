import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  AnimationConfig,
  BackgroundConfig,
  ImageGridItem,
  TextStyleConfig,
} from "../types";
import { Picture } from "./Picture";
import { SceneBackground } from "./SceneBackground";
import { getBrandedSvgUrl } from "./useBrandedSvg";
import { useSceneAnimation } from "./useSceneAnimation";

type GridLayout = "uniform" | "featured" | "masonry" | "filmstrip";

interface ImageGridSceneProps {
  heading?: string;
  images: ImageGridItem[];
  columns?: 2 | 3 | 4;
  gridLayout?: GridLayout;
  brandColor: string;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  captionStyle?: TextStyleConfig;
  animation?: AnimationConfig;
  footerInset?: number;
}

export const ImageGridScene: React.FC<ImageGridSceneProps> = ({
  heading,
  images,
  columns = 3,
  gridLayout = "uniform",
  brandColor,
  background,
  headingStyle,
  captionStyle,
  animation,
  footerInset = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headAnim = useSceneAnimation(animation, 0);
  const hs = headingStyle || {};
  const cs = captionStyle || {};

  const visibleImages = images.filter((img) => img.url);
  const count = visibleImages.length;

  // Auto-pick best layout if uniform and many images
  const effectiveLayout =
    gridLayout !== "uniform"
      ? gridLayout
      : count === 1
        ? "featured"
        : count <= 4
          ? "uniform"
          : "uniform";

  const renderImageCard = (
    img: ImageGridItem,
    i: number,
    style?: React.CSSProperties,
  ) => {
    const delay = 8 + i * 4;
    const imgSpring = spring({
      frame: Math.max(0, frame - delay),
      fps,
      config: { damping: 18 },
    });
    const scale = interpolate(imgSpring, [0, 1], [0.9, 1]);
    const opacity = interpolate(imgSpring, [0, 1], [0, 1]);

    return (
      <div
        key={i}
        style={{
          position: "relative",
          borderRadius: 12,
          overflow: "hidden",
          transform: `scale(${scale})`,
          opacity,
          ...style,
        }}
      >
        <Picture
          src={getBrandedSvgUrl(img.url, brandColor) || img.url}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
        {img.caption && (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              padding: "32px 16px 14px",
              background: "linear-gradient(transparent, rgba(0,0,0,0.85))",
            }}
          >
            <span
              style={{
                fontSize: cs.fontSize || 16,
                color: "#ffffff",
                fontFamily: cs.fontFamily || "Inter, Arial, sans-serif",
                fontWeight: cs.fontWeight || 600,
                textShadow: "0 1px 4px rgba(0,0,0,0.6)",
              }}
            >
              {img.caption}
            </span>
          </div>
        )}
      </div>
    );
  };

  const renderGrid = () => {
    if (effectiveLayout === "featured" && count >= 2) {
      // First image large on left, rest stacked on right
      return (
        <div style={{ flex: 1, display: "flex", gap: 16, minHeight: 0 }}>
          <div style={{ flex: 2, display: "flex", minHeight: 0 }}>
            {renderImageCard(visibleImages[0], 0, { flex: 1 })}
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              minHeight: 0,
            }}
          >
            {visibleImages
              .slice(1, 4)
              .map((img, i) => renderImageCard(img, i + 1, { flex: 1 }))}
          </div>
        </div>
      );
    }

    if (effectiveLayout === "filmstrip") {
      // Single row, all same height
      return (
        <div
          style={{
            flex: 1,
            display: "flex",
            gap: 16,
            alignItems: "stretch",
            minHeight: 0,
          }}
        >
          {visibleImages
            .slice(0, 6)
            .map((img, i) => renderImageCard(img, i, { flex: 1, minWidth: 0 }))}
        </div>
      );
    }

    if (effectiveLayout === "masonry" && count >= 3) {
      // 2 columns with alternating sizes
      const leftItems = visibleImages.filter((_, i) => i % 2 === 0);
      const rightItems = visibleImages.filter((_, i) => i % 2 === 1);
      return (
        <div style={{ flex: 1, display: "flex", gap: 16, minHeight: 0 }}>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              minHeight: 0,
            }}
          >
            {leftItems
              .slice(0, 3)
              .map((img, i) =>
                renderImageCard(img, i * 2, { flex: i === 0 ? 2 : 1 }),
              )}
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              minHeight: 0,
            }}
          >
            {rightItems
              .slice(0, 3)
              .map((img, i) =>
                renderImageCard(img, i * 2 + 1, { flex: i === 0 ? 1 : 2 }),
              )}
          </div>
        </div>
      );
    }

    // Uniform grid — adaptive rows/cols to prevent clipping
    const effectiveCols = Math.min(columns, count);
    const rows = Math.ceil(Math.min(count, effectiveCols * 2) / effectiveCols);
    const maxItems = effectiveCols * rows;

    return (
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: `repeat(${effectiveCols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          gap: 16,
          minHeight: 0,
        }}
      >
        {visibleImages
          .slice(0, maxItems)
          .map((img, i) => renderImageCard(img, i, { minHeight: 0 }))}
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
      }}
    >
      <SceneBackground config={background} brandColor={brandColor} />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: `50px 70px ${50 + footerInset}px`,
          minHeight: 0,
        }}
      >
        {heading && (
          <h2
            style={{
              fontSize: hs.fontSize || 44,
              fontWeight: hs.fontWeight || 700,
              color: hs.color || "#0f172a",
              fontFamily: hs.fontFamily || "Inter, Arial, sans-serif",
              marginBottom: 30,
              flexShrink: 0,
              opacity: headAnim.opacity,
              transform: headAnim.transform,
            }}
          >
            {heading}
          </h2>
        )}
        {renderGrid()}
      </div>
    </div>
  );
};
