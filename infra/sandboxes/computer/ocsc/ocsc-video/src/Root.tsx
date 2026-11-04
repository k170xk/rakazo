import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/inter/900.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/source-serif-4/400.css";
import "@fontsource/source-serif-4/600.css";
import "@fontsource/source-serif-4/700.css";
import { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Composition,
  continueRender,
  delayRender,
} from "remotion";
import { AudioLayer } from "./AudioLayer";
import { EndFade } from "./EndFade";
import ocscLogo from "./assets/ocsc-logo.png";
import ocscLogoOnDark from "./assets/ocsc-logo-on-dark.png";
import { TrainingVideo } from "./scenes/TrainingVideo";
import { timeline } from "./timeline";
import type { VideoProjectConfig } from "./types";

export const OCSC_GREEN = "#76bf43";

type Props = { config: VideoProjectConfig };

const SAMPLE: VideoProjectConfig = {
  title: "OCSC",
  settings: { width: 1920, height: 1080, fps: 30, show_skyline_footer: true },
  scenes: [
    {
      type: "title",
      heading: "OCSC",
      subheading: "Motion graphics on the Bot computer",
      duration: 4,
    },
    { type: "closing", heading: "Thank you", duration: 3 },
  ],
};

const Video: React.FC<Props> = ({ config }) => {
  // Fonts load from the bundle, so no frame is taken before Inter is ready.
  const [handle] = useState(() => delayRender("Loading fonts"));
  useEffect(() => {
    document.fonts.ready.then(() => continueRender(handle));
  }, [handle]);
  return (
    <AbsoluteFill style={{ fontFamily: "Inter, Arial, sans-serif" }}>
      <TrainingVideo
        config={config}
        brandColor={config.brandColor || OCSC_GREEN}
        logoUrl={config.logoUrl || ocscLogo}
        logoOnDarkUrl={config.logoOnDarkUrl || ocscLogoOnDark}
      />
      <AudioLayer config={config} />
      <EndFade config={config} />
    </AbsoluteFill>
  );
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="OcscVideo"
    component={Video}
    defaultProps={{ config: SAMPLE }}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={210}
    calculateMetadata={({ props }) => {
      const { settings } = props.config;
      return {
        fps: settings.fps || 30,
        width: settings.width || 1920,
        height: settings.height || 1080,
        durationInFrames: timeline(props.config).frames,
      };
    }}
  />
);
