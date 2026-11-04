import type { BackgroundConfig } from "../types";
import { Picture } from "./Picture";
import { SceneBackground } from "./SceneBackground";
import { useBrandedSvg } from "./useBrandedSvg";

interface InfographicSceneProps {
  imageUrl: string;
  brandColor: string;
  background?: BackgroundConfig;
}

/**
 * Full-screen, single-image scene optimised for AI-generated infographics
 * (e.g. Gemini outputs). No Ken Burns zoom, no caption, no "Featured" badge —
 * the graphic itself carries the message and is shown verbatim.
 */
export const InfographicScene: React.FC<InfographicSceneProps> = ({
  imageUrl,
  brandColor,
  background,
}) => {
  const brandedImageUrl = useBrandedSvg(imageUrl, brandColor);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <SceneBackground config={background} brandColor={brandColor} />
      <Picture
        src={brandedImageUrl}
        alt=""
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
          zIndex: 1,
        }}
      />
    </div>
  );
};
