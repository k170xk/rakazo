import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const read = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    const timers = new Set<number>();
    // iOS fires the media and orientation events while innerWidth still holds the old size, so
    // read it again once the rotation has settled.
    const settle = () => {
      read();
      for (const delay of [100, 400]) {
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          read();
        }, delay);
        timers.add(timer);
      }
    };
    mql.addEventListener("change", settle);
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", settle);
    read();
    return () => {
      mql.removeEventListener("change", settle);
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", settle);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);

  return !!isMobile;
}
