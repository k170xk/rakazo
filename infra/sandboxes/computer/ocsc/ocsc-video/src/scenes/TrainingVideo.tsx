import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import skylineFooterImg from "../assets/skyline.png";
import { customScenes } from "../custom/registry";
import { templates } from "../templates";
import { FONT, FooterSpace } from "../templates/kit";
import { timeline } from "../timeline";
import type { VideoProjectConfig } from "../types";
import { BarChartScene } from "./BarChartScene";
import { BigNumberScene } from "./BigNumberScene";
import { BrandWatermark } from "./BrandWatermark";
import { ClosingScene } from "./ClosingScene";
import { CodeBlockScene } from "./CodeBlockScene";
import { ComparisonScene } from "./ComparisonScene";
import { ContentScene } from "./ContentScene";
import { FullscreenTextScene } from "./FullscreenTextScene";
import { IconListScene } from "./IconListScene";
import { ImageGridScene } from "./ImageGridScene";
import { ImageScene } from "./ImageScene";
import { InfographicScene, infographicStyle } from "./InfographicScene";
import { LogoWallScene } from "./LogoWallScene";
import { MapCalloutScene } from "./MapCalloutScene";
import { Picture } from "./Picture";
import { ProcessStepsScene } from "./ProcessStepsScene";
import { PullQuoteScene } from "./PullQuoteScene";
import { QuoteScene } from "./QuoteScene";
import { SectionHeaderScene } from "./SectionHeaderScene";
import { StatsScene } from "./StatsScene";
import { FOOTER_SAFE_PX } from "./safeArea";
import { TeamCardsScene } from "./TeamCardsScene";
import { TimelineScene } from "./TimelineScene";
import { TitleScene } from "./TitleScene";
import { TransitionIn, TransitionOut } from "./TransitionIn";
import { VideoScene } from "./VideoScene";

interface TrainingVideoProps {
  config: VideoProjectConfig;
  brandColor: string;
  logoUrl?: string;
  logoOnDarkUrl?: string;
}

export const TrainingVideo: React.FC<TrainingVideoProps> = ({
  config,
  brandColor,
  logoUrl,
  logoOnDarkUrl,
}) => {
  const { settings } = config;
  const fps = settings.fps || 30;
  const { height } = useVideoConfig();
  const sceneFrames = timeline(config).slots.map((slot) => ({
    scene: slot.scene,
    from: slot.from,
    durationInFrames: slot.frames + slot.tail,
    transition: slot.transition,
    transitionFrames: slot.transitionFrames,
    exit: slot.exit,
    ownFrames: slot.frames,
    tail: slot.tail,
  }));

  return (
    <AbsoluteFill style={{ backgroundColor: "#ffffff", fontFamily: FONT }}>
      {sceneFrames.map(({ scene, from, durationInFrames, transition, transitionFrames, exit, ownFrames, tail }, i) => {
        const showFooter = settings?.show_skyline_footer ?? true;
        // Fullscreen image and video scenes go fully edge-to-edge (over footer + logo).
        const meta =
          scene.type === "template" ? templates[scene.template]?.meta : undefined;
        // Templates carry the footer and logo like every other scene, unless they are a full-frame photo.
        const isFullBleed =
          scene.type === "image" ||
          scene.type === "video" ||
          (scene.type === "infographic" && infographicStyle(scene) === "full") ||
          (scene.type === "custom" && !scene.branded) ||
          (scene.type === "template" &&
            !(scene.branded ?? !(meta?.fullBleed || meta?.kind === "shot")));
        const footerInset =
          showFooter && !isFullBleed ? FOOTER_SAFE_PX + 24 : 0;
        const selfManagesFooter =
          isFullBleed ||
          scene.type === "fullscreen_text" ||
          scene.type === "template";
        const wrapperStyle =
          showFooter && !selfManagesFooter
            ? { paddingBottom: FOOTER_SAFE_PX }
            : undefined;
        return (
          <Sequence
            key={i}
            from={from}
            durationInFrames={durationInFrames}
            // Each scene is its own layer, so nothing in the outgoing scene draws over the next.
            style={{ zIndex: i + 1, isolation: "isolate" }}
          >
            <TransitionOut type={exit} start={ownFrames} frames={tail}>
            <TransitionIn
              type={transition}
              frames={transitionFrames}
              brandColor={brandColor}
            >
            <AbsoluteFill style={wrapperStyle}>
              {scene.type === "title" && (
                <TitleScene
                  heading={scene.heading}
                  subheading={scene.subheading}
                  brandColor={brandColor}
                  logoUrl={logoUrl}
                  background={scene.background}
                  headingStyle={scene.headingStyle}
                  subheadingStyle={scene.subheadingStyle}
                  animation={scene.animation}
                />
              )}
              {scene.type === "content" && (
                <ContentScene
                  title={scene.title}
                  bullets={scene.bullets}
                  brandColor={brandColor}
                  imageUrl={scene.imageUrl}
                  imageUrls={scene.imageUrls}
                  layout={scene.layout}
                  background={scene.background}
                  titleStyle={scene.titleStyle}
                  bulletStyle={scene.bulletStyle}
                  animation={scene.animation}
                />
              )}
              {scene.type === "image" && (
                <ImageScene
                  imageUrl={scene.imageUrl}
                  caption={scene.caption}
                  brandColor={brandColor}
                  background={scene.background}
                  captionStyle={scene.captionStyle}
                  animation={scene.animation}
                  kenBurns={scene.kenBurns}
                />
              )}
              {scene.type === "infographic" && (
                <InfographicScene
                  imageUrl={scene.imageUrl}
                  brandColor={brandColor}
                  background={scene.background}
                  style={scene.style}
                  heading={scene.heading}
                  subheading={scene.subheading}
                  bullets={scene.bullets}
                  points={scene.points}
                  stats={scene.stats}
                  statement={scene.statement}
                />
              )}
              {scene.type === "closing" && (
                <ClosingScene
                  heading={scene.heading}
                  subheading={scene.subheading}
                  brandColor={brandColor}
                  logoUrl={logoUrl}
                  background={scene.background}
                  headingStyle={scene.headingStyle}
                  subheadingStyle={scene.subheadingStyle}
                  animation={scene.animation}
                />
              )}
              {scene.type === "quote" && (
                <QuoteScene
                  quote={scene.quote}
                  attribution={scene.attribution}
                  imageUrl={scene.imageUrl}
                  brandColor={brandColor}
                  background={scene.background}
                  quoteStyle={scene.quoteStyle}
                  attributionStyle={scene.attributionStyle}
                  animation={scene.animation}
                />
              )}
              {scene.type === "stats" && (
                <StatsScene
                  heading={scene.heading}
                  stats={scene.stats}
                  brandColor={brandColor}
                  background={scene.background}
                  headingStyle={scene.headingStyle}
                  valueStyle={scene.valueStyle}
                  labelStyle={scene.labelStyle}
                  animation={scene.animation}
                  layout={scene.statsLayout}
                />
              )}
              {scene.type === "section_header" && (
                <SectionHeaderScene
                  heading={scene.heading}
                  sectionNumber={scene.sectionNumber}
                  subheading={scene.subheading}
                  imageUrl={scene.imageUrl}
                  brandColor={brandColor}
                  background={scene.background}
                  headingStyle={scene.headingStyle}
                  subheadingStyle={scene.subheadingStyle}
                  animation={scene.animation}
                />
              )}
              {scene.type === "fullscreen_text" && (
                <FullscreenTextScene
                  text={scene.text}
                  subtext={scene.subtext}
                  brandColor={brandColor}
                  background={scene.background}
                  textStyle={scene.textStyle}
                  subtextStyle={scene.subtextStyle}
                  animation={scene.animation}
                />
              )}
              {scene.type === "image_grid" && (
                <ImageGridScene
                  heading={scene.heading}
                  images={scene.images}
                  columns={scene.columns}
                  gridLayout={scene.gridLayout}
                  brandColor={brandColor}
                  background={scene.background}
                  headingStyle={scene.headingStyle}
                  captionStyle={scene.captionStyle}
                  animation={scene.animation}
                  footerInset={footerInset}
                />
              )}
              {scene.type === "video" && (
                <VideoScene
                  videoUrl={scene.videoUrl}
                  caption={scene.caption}
                  brandColor={brandColor}
                  background={scene.background}
                  captionStyle={scene.captionStyle}
                  animation={scene.animation}
                  posterUrl={scene.posterUrl}
                />
              )}
              {scene.type === "timeline" && (
                <TimelineScene
                  heading={scene.heading}
                  items={scene.items}
                  orientation={scene.orientation}
                  brandColor={brandColor}
                  background={scene.background}
                  headingStyle={scene.headingStyle}
                  animation={scene.animation}
                />
              )}
              {scene.type === "process_steps" && (
                <ProcessStepsScene
                  heading={scene.heading}
                  steps={scene.steps}
                  brandColor={brandColor}
                  background={scene.background}
                  headingStyle={scene.headingStyle}
                  animation={scene.animation}
                />
              )}
              {scene.type === "pull_quote" && (
                <PullQuoteScene
                  quote={scene.quote}
                  attribution={scene.attribution}
                  role={scene.role}
                  portraitUrl={scene.portraitUrl}
                  brandColor={brandColor}
                  background={scene.background}
                  quoteStyle={scene.quoteStyle}
                  attributionStyle={scene.attributionStyle}
                  animation={scene.animation}
                />
              )}
              {scene.type === "big_number" && (
                <BigNumberScene
                  value={scene.value}
                  label={scene.label}
                  context={scene.context}
                  brandColor={brandColor}
                  background={scene.background}
                  valueStyle={scene.valueStyle}
                  labelStyle={scene.labelStyle}
                  animation={scene.animation}
                />
              )}
              {scene.type === "bar_chart" && (
                <BarChartScene
                  heading={scene.heading}
                  items={scene.items}
                  unit={scene.unit}
                  chartType={scene.chartType}
                  showValues={scene.showValues}
                  brandColor={brandColor}
                  background={scene.background}
                  headingStyle={scene.headingStyle}
                  animation={scene.animation}
                />
              )}
              {scene.type === "comparison" && (
                <ComparisonScene
                  heading={scene.heading}
                  leftLabel={scene.leftLabel}
                  leftPoints={scene.leftPoints}
                  rightLabel={scene.rightLabel}
                  rightPoints={scene.rightPoints}
                  leftAccent={scene.leftAccent}
                  rightAccent={scene.rightAccent}
                  brandColor={brandColor}
                  background={scene.background}
                  headingStyle={scene.headingStyle}
                  animation={scene.animation}
                  footerInset={footerInset}
                />
              )}
              {scene.type === "icon_list" && (
                <IconListScene
                  heading={scene.heading}
                  items={scene.items}
                  brandColor={brandColor}
                  background={scene.background}
                  headingStyle={scene.headingStyle}
                  animation={scene.animation}
                  footerInset={footerInset}
                />
              )}
              {scene.type === "logo_wall" && (
                <LogoWallScene
                  heading={scene.heading}
                  logos={scene.logos}
                  columns={scene.columns}
                  brandColor={brandColor}
                  background={scene.background}
                  headingStyle={scene.headingStyle}
                  animation={scene.animation}
                  footerInset={footerInset}
                />
              )}
              {scene.type === "team_cards" && (
                <TeamCardsScene
                  heading={scene.heading}
                  members={scene.members}
                  brandColor={brandColor}
                  background={scene.background}
                  headingStyle={scene.headingStyle}
                  animation={scene.animation}
                  footerInset={footerInset}
                />
              )}
              {scene.type === "map_callout" && (
                <MapCalloutScene
                  heading={scene.heading}
                  locationName={scene.locationName}
                  coordinates={scene.coordinates}
                  imageUrl={scene.imageUrl}
                  brandColor={brandColor}
                  background={scene.background}
                  headingStyle={scene.headingStyle}
                  animation={scene.animation}
                />
              )}
              {scene.type === "code_block" && (
                <CodeBlockScene
                  heading={scene.heading}
                  code={scene.code}
                  language={scene.language}
                  caption={scene.caption}
                  brandColor={brandColor}
                  background={scene.background}
                  headingStyle={scene.headingStyle}
                  animation={scene.animation}
                />
              )}
              {scene.type === "custom" &&
                (() => {
                  const Custom = customScenes[scene.file];
                  if (!Custom)
                    throw new Error(
                      `The custom scene ${scene.file} was not built into this render.`,
                    );
                  return (
                    <Custom
                      {...(scene.props ?? {})}
                      brandColor={brandColor}
                      logoUrl={logoUrl}
                      logoOnDarkUrl={logoOnDarkUrl}
                    />
                  );
                })()}
              {scene.type === "template" &&
                (() => {
                  const Template = templates[scene.template]?.Component;
                  if (!Template)
                    throw new Error(
                      `There is no template called ${scene.template}. Run ocsc-video templates for the list.`,
                    );
                  return (
                    <FooterSpace.Provider
                      value={
                        showFooter && !isFullBleed
                          ? Math.round((FOOTER_SAFE_PX * height) / 1080)
                          : 0
                      }
                    >
                      <Template
                        {...(scene.props ?? {})}
                        brandColor={brandColor}
                        logoUrl={logoUrl}
                        logoOnDarkUrl={logoOnDarkUrl}
                      />
                    </FooterSpace.Provider>
                  );
                })()}
              {!isFullBleed && (
                <>
                  {showFooter && (
                    <Picture
                      src={skylineFooterImg}
                      alt=""
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        width: "100%",
                        height: "auto",
                        pointerEvents: "none",
                        zIndex: 50,
                        objectFit: "contain",
                        objectPosition: "bottom",
                      }}
                    />
                  )}
                  {scene.type !== "title" && !meta?.ownLogo && (
                    <BrandWatermark
                      logoUrl={
                        scene.type === "template" && scene.props?.dark === true
                          ? logoOnDarkUrl
                          : logoUrl
                      }
                      brandColor={brandColor}
                    />
                  )}
                </>
              )}
              {(scene.overlays ?? []).map((overlay, n) => {
                const Overlay = templates[overlay.template]?.Component;
                if (!Overlay)
                  throw new Error(
                    `There is no overlay template called ${overlay.template}.`,
                  );
                const start = Math.round((overlay.at ?? 0) * fps);
                const length =
                  overlay.duration === undefined
                    ? ownFrames - start
                    : Math.round(overlay.duration * fps);
                return (
                  <Sequence
                    key={`${overlay.template}-${n}`}
                    from={start}
                    durationInFrames={Math.max(1, length)}
                    style={{ zIndex: 60 }}
                  >
                    <Overlay
                      {...(overlay.props ?? {})}
                      asOverlay
                      brandColor={brandColor}
                      logoUrl={logoUrl}
                      logoOnDarkUrl={logoOnDarkUrl}
                    />
                  </Sequence>
                );
              })}
            </AbsoluteFill>
            </TransitionIn>
            </TransitionOut>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
