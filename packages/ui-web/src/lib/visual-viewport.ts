"use client";

import { useLayoutEffect, useState } from "react";

/** Where a full-screen layer has to sit so it matches the screen the person can see. */
export type ViewportFrame = { top: number; left: number; width: number; height: number };

/**
 * The phone's web view can leave the page scrolled after a slideshow, the keyboard, or a focused
 * control. A layer fixed to the layout's top corner then sits part-way down the screen. These
 * numbers follow the visible viewport instead, which is how the computer overlay already stays put.
 */
export function viewportFrameOf(viewport: {
  offsetTop: number;
  offsetLeft: number;
  width: number;
  height: number;
}): ViewportFrame | null {
  if (!(viewport.width > 0 && viewport.height > 0)) return null;
  return {
    top: viewport.offsetTop,
    left: viewport.offsetLeft,
    width: viewport.width,
    height: viewport.height,
  };
}

function sameFrame(a: ViewportFrame, b: ViewportFrame): boolean {
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

/** Tracks the visible viewport while `active`, and clears a scroll left over from opening it. */
export function useVisualViewportFrame(active: boolean): ViewportFrame | null {
  const [frame, setFrame] = useState<ViewportFrame | null>(null);

  useLayoutEffect(() => {
    if (!active) return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    document.scrollingElement?.scrollTo(0, 0);
    const sync = () => {
      const next = viewportFrameOf(viewport);
      setFrame((current) => {
        if (!next) return current;
        if (current && sameFrame(current, next)) return current;
        return next;
      });
    };
    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
    };
  }, [active]);

  return active ? frame : null;
}
