import { interpolate, useCurrentFrame } from "remotion";
import { Picture } from "./Picture";

interface BrandWatermarkProps {
  logoUrl?: string;
  brandColor: string;
}

export const BrandWatermark: React.FC<BrandWatermarkProps> = ({
  logoUrl,
  brandColor,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 100,
      }}
    >
      {/* Top accent bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 6,
          backgroundColor: brandColor,
          opacity: interpolate(frame, [0, 15], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      />
      {/* Bottom accent bar */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 6,
          backgroundColor: brandColor,
          opacity: interpolate(frame, [0, 15], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      />
      {/* Logo watermark */}
      {logoUrl && (
        <Picture
          src={logoUrl}
          alt=""
          style={{
            position: "absolute",
            bottom: 32,
            right: 32,
            height: 80,
            opacity,
          }}
        />
      )}
    </div>
  );
};
