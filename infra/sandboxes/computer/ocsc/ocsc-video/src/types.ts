export type SceneType =
  | "title"
  | "content"
  | "image"
  | "infographic"
  | "closing"
  | "quote"
  | "stats"
  | "section_header"
  | "fullscreen_text"
  | "image_grid"
  | "video"
  // Storytelling pack
  | "timeline"
  | "process_steps"
  | "pull_quote"
  // Data pack
  | "big_number"
  | "bar_chart"
  | "comparison"
  | "icon_list"
  // Brand pack
  | "logo_wall"
  | "team_cards"
  | "map_callout"
  | "code_block";

export type GridLayout = "uniform" | "featured" | "masonry" | "filmstrip";

export type TransitionType =
  | "fade"
  | "slide"
  | "wipe"
  | "flip"
  | "iris"
  | "clock-wipe"
  | "blinds"
  | "pixel"
  | "brand-wipe"
  | "dip"
  | "zoom"
  | "whip"
  | "morph"
  | "none";

export type AnimationPreset =
  | "fade-in"
  | "slide-up"
  | "slide-left"
  | "slide-right"
  | "scale-up"
  | "bounce"
  | "typewriter"
  | "blur-in"
  | "none";

export type BackgroundType = "solid" | "gradient" | "image" | "video";

export type GradientDirection =
  | "135deg"
  | "0deg"
  | "45deg"
  | "90deg"
  | "180deg"
  | "225deg"
  | "270deg"
  | "315deg";

export interface BackgroundConfig {
  type: BackgroundType;
  color?: string;
  gradientFrom?: string;
  gradientTo?: string;
  gradientVia?: string;
  gradientDirection?: GradientDirection;
  imageUrl?: string;
  videoUrl?: string;
  videoMuted?: boolean;
  overlayOpacity?: number; // 0-1
  overlayColor?: string;
}

export interface TextStyleConfig {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  textAlign?: "left" | "center" | "right";
  letterSpacing?: number;
  lineHeight?: number;
  textShadow?: boolean;
}

export interface AnimationConfig {
  entrance?: AnimationPreset;
  entranceDuration?: number; // frames
  exit?: AnimationPreset;
  exitDuration?: number; // frames
  staggerDelay?: number; // frames between staggered children
}

export interface TransitionConfig {
  type: TransitionType;
  duration?: number; // frames
}

export interface VoiceoverConfig {
  /** Set by the engine: the gain that brings the voice to the reference loudness. */
  levelDb?: number;
  script?: string;
  /** Seconds after the scene starts before the voice begins. Defaults to 0.3. */
  delay?: number;
  audioUrl?: string;
  voiceId?: string;
  durationMs?: number;
  needsRegeneration?: boolean;
  autoFitDuration?: boolean;
}

export interface TitleSceneConfig {
  type: "title";
  heading: string;
  subheading?: string;
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  subheadingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export type ContentLayout =
  | "default"
  | "image-left"
  | "image-top"
  | "full-width-image";

export interface ContentSceneConfig {
  type: "content";
  title: string;
  bullets: string[];
  imageUrl?: string;
  imageUrls?: string[];
  layout?: ContentLayout;
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  titleStyle?: TextStyleConfig;
  bulletStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export interface ImageSceneConfig {
  type: "image";
  imageUrl: string;
  caption?: string;
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  captionStyle?: TextStyleConfig;
  animation?: AnimationConfig;
  kenBurns?: boolean;
}

export type InfographicStyle =
  | "full"
  | "side"
  | "cards"
  | "steps"
  | "checklist"
  | "stats"
  | "statement";

export interface InfographicPoint {
  title?: string;
  text?: string;
}

export interface InfographicStat {
  value: string;
  label?: string;
}

/**
 * An OCSC Vision Intelligence infographic (drawn without text) with the scene's words laid out
 * around it in a slide style; "full" shows the picture alone, edge to edge.
 */
export interface InfographicSceneConfig {
  type: "infographic";
  imageUrl: string;
  style?: InfographicStyle;
  heading?: string;
  subheading?: string;
  bullets?: string[];
  points?: InfographicPoint[];
  stats?: InfographicStat[];
  statement?: string;
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  animation?: AnimationConfig;
}

export interface ClosingSceneConfig {
  type: "closing";
  heading: string;
  subheading?: string;
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  subheadingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export interface QuoteSceneConfig {
  type: "quote";
  quote: string;
  attribution?: string;
  imageUrl?: string;
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  quoteStyle?: TextStyleConfig;
  attributionStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export interface StatItem {
  value: string;
  label: string;
}

export type StatsLayout =
  | "grid"
  | "horizontal"
  | "vertical"
  | "highlight"
  | "progress";

export interface StatsSceneConfig {
  type: "stats";
  heading?: string;
  stats: StatItem[];
  statsLayout?: StatsLayout;
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  valueStyle?: TextStyleConfig;
  labelStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export interface SectionHeaderSceneConfig {
  type: "section_header";
  heading: string;
  sectionNumber?: string;
  subheading?: string;
  imageUrl?: string;
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  subheadingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export interface FullscreenTextSceneConfig {
  type: "fullscreen_text";
  text: string;
  subtext?: string;
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  textStyle?: TextStyleConfig;
  subtextStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export interface ImageGridItem {
  url: string;
  caption?: string;
}

export interface ImageGridSceneConfig {
  type: "image_grid";
  heading?: string;
  images: ImageGridItem[];
  columns?: 2 | 3 | 4;
  gridLayout?: GridLayout;
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  captionStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export interface VideoSceneConfig {
  type: "video";
  videoUrl: string;
  caption?: string;
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  captionStyle?: TextStyleConfig;
  animation?: AnimationConfig;
  posterUrl?: string;
}

// ===== Storytelling pack =====
export interface TimelineItem {
  date: string;
  label: string;
  description?: string;
}
export interface TimelineSceneConfig {
  type: "timeline";
  heading?: string;
  items: TimelineItem[];
  orientation?: "horizontal" | "vertical";
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export interface ProcessStep {
  title: string;
  description?: string;
  icon?: string;
}
export interface ProcessStepsSceneConfig {
  type: "process_steps";
  heading?: string;
  steps: ProcessStep[];
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export interface PullQuoteSceneConfig {
  type: "pull_quote";
  quote: string;
  attribution?: string;
  role?: string;
  portraitUrl?: string;
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  quoteStyle?: TextStyleConfig;
  attributionStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

// ===== Data pack =====
export interface BigNumberSceneConfig {
  type: "big_number";
  value: string;
  label: string;
  context?: string;
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  valueStyle?: TextStyleConfig;
  labelStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export interface BarChartItem {
  label: string;
  value: number;
  color?: string;
}
export type ChartVariant =
  | "bar"
  | "column"
  | "line"
  | "area"
  | "donut"
  | "pie"
  | "radial";
export interface BarChartSceneConfig {
  type: "bar_chart";
  heading?: string;
  items: BarChartItem[];
  unit?: string;
  chartType?: ChartVariant;
  showValues?: boolean;
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export interface ComparisonSceneConfig {
  type: "comparison";
  heading?: string;
  leftLabel: string;
  leftPoints: string[];
  rightLabel: string;
  rightPoints: string[];
  leftAccent?: "positive" | "negative" | "neutral";
  rightAccent?: "positive" | "negative" | "neutral";
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export interface IconListItem {
  icon?: string;
  title: string;
  description?: string;
}
export interface IconListSceneConfig {
  type: "icon_list";
  heading?: string;
  items: IconListItem[];
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

// ===== Brand pack =====
export interface LogoItem {
  url: string;
  name?: string;
}
export interface LogoWallSceneConfig {
  type: "logo_wall";
  heading?: string;
  logos: LogoItem[];
  columns?: 3 | 4 | 5 | 6;
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export interface TeamMember {
  photoUrl?: string;
  name: string;
  role: string;
}
export interface TeamCardsSceneConfig {
  type: "team_cards";
  heading?: string;
  members: TeamMember[];
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export interface MapCalloutSceneConfig {
  type: "map_callout";
  heading?: string;
  locationName: string;
  coordinates?: string;
  imageUrl?: string;
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export interface CodeBlockSceneConfig {
  type: "code_block";
  heading?: string;
  code: string;
  language?: string;
  caption?: string;
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

export type SceneConfig =
  | TitleSceneConfig
  | ContentSceneConfig
  | ImageSceneConfig
  | InfographicSceneConfig
  | ClosingSceneConfig
  | QuoteSceneConfig
  | StatsSceneConfig
  | SectionHeaderSceneConfig
  | FullscreenTextSceneConfig
  | ImageGridSceneConfig
  | VideoSceneConfig
  | TimelineSceneConfig
  | ProcessStepsSceneConfig
  | PullQuoteSceneConfig
  | BigNumberSceneConfig
  | BarChartSceneConfig
  | ComparisonSceneConfig
  | IconListSceneConfig
  | LogoWallSceneConfig
  | TeamCardsSceneConfig
  | MapCalloutSceneConfig
  | CodeBlockSceneConfig;

/**
 * A motion graphics scene the Bot writes itself: a .tsx file beside the video's spec whose default
 * export is a Remotion component. `props` are passed to it unchanged.
 */
export interface CustomSceneConfig {
  type: "custom";
  file: string;
  props?: Record<string, unknown>;
  /** Draw the skyline footer and logo watermark over the scene, as on the built-in scenes. */
  branded?: boolean;
  duration: number;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
}

/** One of the motion templates (ocsc-video templates lists them). */
export interface TemplateSceneConfig {
  type: "template";
  template: string;
  props?: Record<string, unknown>;
  duration: number;
  /** Draw the skyline footer and logo over it. */
  branded?: boolean;
  transition?: TransitionType;
  voiceover?: VoiceoverConfig;
}

/** An overlay template (a lower third, film grain, a call to action) drawn over a scene. */
export interface SceneOverlay {
  template: string;
  props?: Record<string, unknown>;
  /** Seconds into the scene. Defaults to 0. */
  at?: number;
  /** Seconds on screen. Defaults to the rest of the scene. */
  duration?: number;
}

export type AnySceneConfig = (
  | SceneConfig
  | CustomSceneConfig
  | TemplateSceneConfig
) & {
  sfx?: SoundEffect[];
  overlays?: SceneOverlay[];
};

export interface VideoSettings {
  width: number;
  height: number;
  fps: number;
  show_skyline_footer?: boolean;
  /** The transition every scene enters with unless it names its own. Defaults to fade. */
  transition?: TransitionType;
  transitionSeconds?: number;
  /** Fade to black over the last 0.7 s. Defaults to true. */
  endFade?: boolean;
  /** Allow the video to end on something other than a closing scene (a looping social clip). */
  openEnding?: boolean;
}

export interface SoundEffect {
  src: string;
  /** Seconds into the scene. */
  at?: number;
  volumeDb?: number;
  /** Set by the engine: the gain that brings the file to the reference loudness. */
  levelDb?: number;
}

export interface MusicBed {
  src: string;
  /** Level with nobody speaking, relative to the voice. Defaults to -8 dB. */
  volumeDb?: number;
  /** Further drop under a voiceover. Defaults to -10 dB. */
  duckDb?: number;
  /** Set by the engine: the gain that brings the track to the reference loudness. */
  levelDb?: number;
  /** Seconds into the track to start from. */
  startAt?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface VideoAudio {
  music?: MusicBed;
  voiceVolumeDb?: number;
}

export interface VideoProjectConfig {
  title?: string;
  brandColor?: string;
  logoUrl?: string;
  /** The logo for dark backgrounds: white lettering. */
  logoOnDarkUrl?: string;
  audio?: VideoAudio;
  scenes: AnySceneConfig[];
  settings: VideoSettings;
}
