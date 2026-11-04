import { interpolate, useCurrentFrame } from "remotion";
import type { BackgroundConfig } from "../types";
import { Picture } from "./Picture";
import { useBrandedSvg } from "./useBrandedSvg";

interface SceneBackgroundProps {
  config?: BackgroundConfig;
  fallbackGradient?: string;
  brandColor?: string;
}

export const SceneBackground: React.FC<SceneBackgroundProps> = ({
  config,
  fallbackGradient,
  brandColor,
}) => {
  const frame = useCurrentFrame();
  const brandedBackgroundImageUrl = useBrandedSvg(
    config?.type === "image" ? config.imageUrl : undefined,
    brandColor || "",
  );

  // Default to a clean white background
  const defaultBg = fallbackGradient || "#ffffff";

  if (!config) {
    return (
      <div style={{ position: "absolute", inset: 0, background: defaultBg }} />
    );
  }

  if (config.type === "solid") {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: config.color || "#ffffff",
        }}
      />
    );
  }

  if (config.type === "gradient") {
    const dir = config.gradientDirection || "135deg";
    const from = config.gradientFrom || "#1a1a2e";
    const via = config.gradientVia;
    const to = config.gradientTo || "#0f3460";
    const bg = via
      ? `linear-gradient(${dir}, ${from} 0%, ${via} 50%, ${to} 100%)`
      : `linear-gradient(${dir}, ${from} 0%, ${to} 100%)`;
    return <div style={{ position: "absolute", inset: 0, background: bg }} />;
  }

  if (config.type === "image") {
    const overlayOpacity = interpolate(
      frame,
      [0, 10],
      [0, config.overlayOpacity ?? 0.5],
      { extrapolateRight: "clamp" },
    );
    return (
      <>
        <Picture
          src={brandedBackgroundImageUrl || config.imageUrl || ""}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: config.overlayColor || "#000000",
            opacity: overlayOpacity,
          }}
        />
      </>
    );
  }

  return (
    <div
      style={{ position: "absolute", inset: 0, backgroundColor: "#ffffff" }}
    />
  );
};
