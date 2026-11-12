import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePageSession } from "../../lib/pages";

const noDockState = { node: null, page: null };
const noDock = { subscribe: () => () => {}, get: () => noDockState };

/**
 * The chat's transcript, moved beside an open app while the App Studio shows its chat panel. It
 * stays one mount, like the composer, so streaming replies, steps and approvals carry on there.
 */
export function DockedTranscript({ children }: { children: ReactNode }) {
  const dock = usePageSession()?.dock ?? noDock;
  const { chat } = useSyncExternalStore(dock.subscribe, dock.get);
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.style.display = "contents";
    return element;
  });
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const target = chat ?? slot.current;
    if (!target || host.parentNode === target) return;
    target.append(host);
    // A moved scroller starts at the top; the newest messages are what matter.
    const scroller = host.querySelector<HTMLElement>('[data-testid="transcript"]');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [chat, host]);
  useEffect(() => () => host.remove(), [host]);
  return (
    <>
      <div ref={slot} className="contents" />
      {createPortal(children, host)}
    </>
  );
}
