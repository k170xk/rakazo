import { useSyncExternalStore } from "react";

export type RenderStudioHost = { open: (image: { src: string; name: string }) => void };

let current: RenderStudioHost | null = null;
const listeners = new Set<() => void>();

/**
 * The signed-in chat registers Render Studio here; the app-wide image viewer sits outside the
 * session and only offers editing while a host is registered. Returns the unregister function.
 */
export function registerRenderStudioHost(host: RenderStudioHost): () => void {
  current = host;
  for (const listener of listeners) listener();
  return () => {
    if (current !== host) return;
    current = null;
    for (const listener of listeners) listener();
  };
}

export function useRenderStudioHost(): RenderStudioHost | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
}
