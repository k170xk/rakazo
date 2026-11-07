import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";

/** Before and after on one stage, split by a draggable divider. */
export function CompareSlider({ beforeUrl, afterUrl }: { beforeUrl: string; afterUrl: string }) {
  const { t } = useLingui();
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(50);
  const dragging = useRef(false);

  const moveTo = useCallback((clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (dragging.current) moveTo(event.clientX);
    };
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [moveTo]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a pointer-only comparison divider.
    <div
      ref={ref}
      className="relative h-full w-full overflow-hidden bg-black select-none"
      onMouseDown={(event) => {
        dragging.current = true;
        moveTo(event.clientX);
      }}
      onTouchMove={(event) => {
        const touch = event.touches[0];
        if (touch) moveTo(touch.clientX);
      }}
    >
      <img
        src={beforeUrl}
        alt={t`Before`}
        className="absolute inset-0 h-full w-full object-contain"
        draggable={false}
      />
      <img
        src={afterUrl}
        alt={t`After`}
        className="absolute inset-0 h-full w-full object-contain"
        style={{ clipPath: `inset(0 0 0 ${position}%)` }}
        draggable={false}
      />
      <div className="absolute top-2 left-2 rounded bg-black/50 px-2 py-1 text-[10px] font-semibold tracking-wider text-cyan-300">
        {t`BEFORE`}
      </div>
      <div className="absolute top-2 right-2 rounded bg-black/50 px-2 py-1 text-[10px] font-semibold tracking-wider text-blue-300">
        {t`AFTER`}
      </div>
      <div
        className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-white/80"
        style={{ left: `${position}%`, transform: "translateX(-50%)" }}
      />
      <div
        className="absolute top-1/2 flex size-8 cursor-ew-resize items-center justify-center rounded-full bg-white text-xs font-bold text-black shadow-lg"
        style={{ left: `${position}%`, transform: "translate(-50%, -50%)" }}
      >
        ⇄
      </div>
    </div>
  );
}
