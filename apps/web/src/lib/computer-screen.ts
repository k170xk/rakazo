export function embeddableScreenUrl(
  url: string | null,
  pageHref = typeof window === "undefined" ? "http://localhost/" : window.location.href,
): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, pageHref);
    const page = new URL(pageHref);
    if (parsed.origin === page.origin) return parsed.toString();
    const local =
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "[::1]";
    if (local) return null;
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Stable identity for a proxied screen so a fresh capability token does not remount the iframe. */
export function computerScreenIdentity(
  url: string,
  pageHref = typeof window === "undefined" ? "http://localhost/" : window.location.href,
): string {
  try {
    const parsed = new URL(url, pageHref);
    const remote = parsed.pathname.match(/^\/novnc\/remote\/(view|control)\//);
    if (remote) {
      const rest = parsed.pathname.replace(/^\/novnc\/remote\/(?:view|control)\/[^/]+/, "");
      return `${parsed.origin}/novnc/remote/${remote[1]}${rest}${parsed.search}`;
    }
    const local = parsed.pathname.match(/^\/novnc\/([^/]+)\/(\d+)\/(view|control)\//);
    if (local) {
      const rest = parsed.pathname.replace(/^\/novnc\/[^/]+\/\d+\/(?:view|control)\/[^/]+/, "");
      return `${parsed.origin}/novnc/${local[1]}/${local[2]}/${local[3]}${rest}${parsed.search}`;
    }
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export function sameComputerScreen(
  prev: string | null,
  next: string | null,
  pageHref = typeof window === "undefined" ? "http://localhost/" : window.location.href,
): boolean {
  if (!prev || !next) return false;
  return computerScreenIdentity(prev, pageHref) === computerScreenIdentity(next, pageHref);
}

export type ScreenFrameRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

/** Full-window chrome above the stream. Keep iframe CSS size stable across open/close. */
export const COMPUTER_OVERLAY_HEADER_PX = 57;

export function desktopScreenSize(
  viewport: { width: number; height: number },
  headerPx = COMPUTER_OVERLAY_HEADER_PX,
): { width: number; height: number } | null {
  const width = Math.round(viewport.width);
  const height = Math.round(viewport.height - headerPx);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

export function usableScreenRect(rect: ScreenFrameRect | null): ScreenFrameRect | null {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return rect;
}

/** Pin the single noVNC iframe over the preview well or the full-window body. */
export function screenFrameStyle(
  rect: ScreenFrameRect | null,
  zIndex: number,
): {
  position: "fixed";
  top: number;
  left: number;
  width: number;
  height: number;
  zIndex: number;
} | null {
  const host = usableScreenRect(rect);
  if (!host) return null;
  return {
    position: "fixed",
    top: host.top,
    left: host.left,
    width: host.width,
    height: host.height,
    zIndex,
  };
}

export type PinnedScreenLayout = {
  clip: {
    position: "fixed";
    top: number;
    left: number;
    width: number;
    height: number;
    overflow: "hidden";
    zIndex: number;
  };
  iframe: {
    display: "block";
    width: number;
    height: number;
    transform: string;
    transformOrigin: "top left";
  };
};

/**
 * Keep the iframe's layout size at the full-window desktop so noVNC never
 * reconnects when the clip moves from the thumbnail to fullscreen.
 */
export function pinnedScreenLayout(
  desktop: { width: number; height: number } | null,
  host: ScreenFrameRect | null,
  zIndex: number,
): PinnedScreenLayout | null {
  if (!desktop || desktop.width <= 0 || desktop.height <= 0) return null;
  const clip = usableScreenRect(host);
  if (!clip) return null;
  const scaleX = clip.width / desktop.width;
  const scaleY = clip.height / desktop.height;
  const flush = Math.abs(scaleX - 1) < 0.002 && Math.abs(scaleY - 1) < 0.002;
  return {
    clip: {
      position: "fixed",
      top: clip.top,
      left: clip.left,
      width: clip.width,
      height: clip.height,
      overflow: "hidden",
      zIndex,
    },
    iframe: {
      display: "block",
      width: desktop.width,
      height: desktop.height,
      transform: flush ? "none" : `scale(${scaleX}, ${scaleY})`,
      transformOrigin: "top left",
    },
  };
}
