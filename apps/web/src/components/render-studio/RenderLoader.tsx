import { useLingui } from "@lingui/react/macro";
import { Sparkles } from "lucide-react";

export function RenderLoader({
  modelLabel,
  presetLabel,
}: {
  modelLabel: string;
  presetLabel: string;
}) {
  const { t } = useLingui();
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-primary/10 via-primary/5 to-background">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "repeating-linear-gradient(45deg, color-mix(in oklab, var(--primary) 8%, transparent) 0 2px, transparent 2px 14px)",
          animation: "studio-scan 4s linear infinite",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--primary) 25%, transparent), transparent 60%)",
          animation: "studio-pulse 2.4s ease-in-out infinite",
        }}
      />
      <Sparkles
        className="relative size-10 animate-spin text-primary"
        style={{ animationDuration: "3s" }}
      />
      <div className="relative mt-4 text-sm font-medium tracking-wide text-foreground">
        {t`Rendering…`}
      </div>
      <div className="relative mt-1 text-[11px] text-primary/80">
        {modelLabel} · {presetLabel}
      </div>
      <div className="relative mt-4 h-1 w-48 overflow-hidden rounded bg-primary/15">
        <div className="h-full animate-[studio-bar_1.6s_ease-in-out_infinite] bg-gradient-to-r from-primary/70 to-primary" />
      </div>
      <style>{`
        @keyframes studio-scan { from { background-position: 0 0 } to { background-position: 280px 0 } }
        @keyframes studio-pulse { 0%,100% { opacity: 0.35 } 50% { opacity: 0.65 } }
        @keyframes studio-bar { 0% { transform: translateX(-100%) } 100% { transform: translateX(100%) } }
      `}</style>
    </div>
  );
}
