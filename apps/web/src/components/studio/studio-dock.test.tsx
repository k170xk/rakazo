// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { StudioFloatingDock, studioDockStyle } from "./studio-dock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | undefined;
afterEach(() => {
  host?.remove();
  host = undefined;
});

it("reserves room under the floating composer only while the chat is closed", () => {
  expect(studioDockStyle(true, true)).toEqual({ "--studio-dock-space": "0px" });
  expect(studioDockStyle(false, false)).toEqual({ "--studio-dock-space": "5.5rem" });
  expect(studioDockStyle(false, true)).toEqual({ "--studio-dock-space": "10.5rem" });
});

it("floats the dock without a band that blocks the canvas", () => {
  host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <StudioFloatingDock lift="2.25rem">
        <span>composer</span>
      </StudioFloatingDock>,
    );
  });
  const dock = host.querySelector<HTMLElement>("[data-testid=studio-floating-dock]");
  expect(dock?.className).toContain("pointer-events-none");
  expect(dock?.className).not.toMatch(/\bbg-/);
  expect(dock?.style.bottom).toContain("2.25rem");
  expect(dock?.firstElementChild?.className).toContain("pointer-events-auto");
  act(() => root.unmount());
});
