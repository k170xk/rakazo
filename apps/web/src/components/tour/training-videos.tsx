import { Trans } from "@lingui/react/macro";
import { Play } from "lucide-react";

/** One training video in the sidebar library. `href` is the Tella share link. */
export type TrainingVideo = {
  id: string;
  title: string;
  summary: string;
  href: string;
};

/**
 * Videos shown from the Training videos side of "Get to know OCSC Intelligence".
 * Add a title, a one-line explanation and its Tella link.
 */
export const TRAINING_VIDEOS: readonly TrainingVideo[] = [
  {
    id: "platform-studios-overview",
    title: "AI Agent Platform & Studios Overview",
    summary:
      "Workspace setup, connectors, custom tools, and the studios for Word, PowerPoint, Excel, and PDFs.",
    href: "https://www.tella.tv/video/keiths-video-36ui2dml",
  },
];

/** The list of training videos, inside the Get to know dialog. */
export function TrainingVideoList() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-6 md:px-8">
      <p className="pb-4 text-[13.5px] leading-5 text-muted-foreground">
        <Trans>Short training videos. Open any of them again whenever you need a reminder.</Trans>
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {TRAINING_VIDEOS.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Training videos will appear here.</Trans>
          </p>
        ) : (
          <ul className="flex flex-col">
            {TRAINING_VIDEOS.map((video) => (
              <li key={video.id}>
                <a
                  href={video.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 rounded-xl px-3 py-3 hover:bg-muted"
                >
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Play size={14} aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{video.title}</span>
                    <span className="mt-0.5 block text-[13px] leading-5 text-muted-foreground">
                      {video.summary}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
