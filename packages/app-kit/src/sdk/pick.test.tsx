// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { locClass } from "../loc.js";
import { hostNodes, locOfProps, nodesForLoc, sourceAt } from "./pick.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Draws its title from props and drops className, like a kit shell or chart. */
function Shell({ title, children }: { title: string; className?: string; children?: ReactNode }) {
  return (
    <div>
      <h1>{title}</h1>
      <main>{children}</main>
    </div>
  );
}

function Overlay({ children }: { className?: string; children: ReactNode }) {
  return createPortal(<p>{children}</p>, document.body);
}

let root: ReturnType<typeof createRoot> | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

describe("element picker", () => {
  it("reads the place from data-loc or the place class", () => {
    expect(locOfProps({ "data-loc": "App.tsx:3:5" })).toBe("App.tsx:3:5");
    expect(locOfProps({ className: `p-4 ${locClass("App.tsx:8:7")}` })).toBe("App.tsx:8:7");
    expect(locOfProps({ className: "p-4" })).toBe("");
  });

  it("finds a component that drops its class, and what it draws", () => {
    render(
      <Shell title="Projects" className={locClass("App.tsx:4:5")}>
        <span data-loc="App.tsx:5:7">Inner</span>
      </Shell>,
    );
    const heading = document.querySelector("h1")!;
    const source = sourceAt(heading.firstChild);
    expect(source?.loc).toBe("App.tsx:4:5");
    expect(hostNodes(source!.fiber!).map((node) => node.tagName)).toEqual(["DIV"]);
    expect(sourceAt(document.querySelector("span"))?.loc).toBe("App.tsx:5:7");
    expect(nodesForLoc("App.tsx:4:5")).toEqual([heading.parentElement]);
  });

  it("follows a portal back to the element that opened it", () => {
    render(<Overlay className={locClass("App.tsx:9:3")}>Saved</Overlay>);
    const text = [...document.querySelectorAll("p")].find((node) => node.textContent === "Saved");
    expect(sourceAt(text!)?.loc).toBe("App.tsx:9:3");
  });

  it("finds nothing outside the app's code", () => {
    render(<Shell title="Plain" />);
    expect(sourceAt(document.querySelector("h1"))).toBeNull();
  });
});
