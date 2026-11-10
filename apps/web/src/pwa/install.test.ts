import { describe, expect, it } from "vitest";
import type { InstallPromptEvent } from "./install";
import { dismissOffer, inFrame, installOffer, offerDismissed } from "./install";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const EDGE = `${CHROME} Edg/131.0.0.0`;
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";

function host(
  agent: string,
  options: { framed?: boolean; standalone?: boolean; desktop?: boolean } = {},
) {
  const self = {};
  return {
    document: {},
    addEventListener: () => undefined,
    matchMedia: () => ({ matches: options.standalone ?? false }) as MediaQueryList,
    navigator: { userAgent: agent, maxTouchPoints: 0 } as unknown as Navigator,
    self,
    top: options.framed ? {} : self,
    ...(options.desktop ? { rakazoDesktop: {} } : {}),
  } as never;
}

const prompt = {} as InstallPromptEvent;

describe("installOffer", () => {
  it("offers the browser's install prompt in Chrome and Edge once it is ready", () => {
    expect(installOffer(host(CHROME), prompt)).toBe("prompt");
    expect(installOffer(host(EDGE), prompt)).toBe("prompt");
    expect(installOffer(host(CHROME), null)).toBeNull();
  });

  it("offers to open the app on its own inside another page's frame", () => {
    expect(installOffer(host(CHROME, { framed: true }), prompt)).toBe("open-standalone");
    expect(installOffer(host(IPHONE, { framed: true }), null)).toBe("open-standalone");
  });

  it("says where Safari keeps its install command", () => {
    expect(installOffer(host(IPHONE), null)).toBe("ios");
    expect(installOffer(host(MAC_SAFARI), null)).toBe("safari-mac");
  });

  it("offers nothing once installed, in the desktop app, or where browsers cannot install", () => {
    expect(installOffer(host(CHROME, { standalone: true }), prompt)).toBeNull();
    expect(installOffer(host(CHROME, { desktop: true }), prompt)).toBeNull();
    expect(installOffer(host(FIREFOX), null)).toBeNull();
  });
});

describe("dismissing the offer", () => {
  it("keeps it away for two weeks", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    const day = 24 * 60 * 60 * 1000;
    const start = Date.UTC(2026, 10, 10);
    dismissOffer("prompt", storage, start);
    expect(offerDismissed("prompt", storage, start + 13 * day)).toBe(true);
    expect(offerDismissed("prompt", storage, start + 15 * day)).toBe(false);
    expect(offerDismissed("open-standalone", storage, start + day)).toBe(false);
  });
});

it("treats an unreadable top window as a frame", () => {
  const framed = {
    self: {},
    get top(): unknown {
      throw new Error("cross-origin");
    },
  };
  expect(inFrame(framed)).toBe(true);
});
