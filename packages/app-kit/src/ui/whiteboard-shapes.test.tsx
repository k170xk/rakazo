// @vitest-environment jsdom

import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardThumbnail, Whiteboard } from "./whiteboard.js";

const board = {
  items: [
    { id: "decide", kind: "diamond" as const, x: 40, y: 40, w: 160, h: 100, text: "Ship it?" },
    { id: "db", kind: "cylinder" as const, x: 240, y: 40, w: 140, h: 90, text: "Postgres" },
    { id: "doc", kind: "document" as const, x: 40, y: 180, w: 140, h: 100, text: "Brief" },
    { id: "net", kind: "cloud" as const, x: 220, y: 180, w: 180, h: 100, text: "Edge" },
    { id: "jobs", kind: "queue" as const, x: 420, y: 40, w: 160, h: 80, text: "Jobs" },
    { id: "area", kind: "section" as const, x: 20, y: 20, w: 400, h: 280, text: "Now" },
  ],
};

describe("whiteboard shapes", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("draws the diagram shapes and reports a selection", () => {
    const onSelectionChange = vi.fn();
    act(() => {
      root.render(
        <Whiteboard value={board} onChange={() => {}} onSelectionChange={onSelectionChange} />,
      );
    });
    const svg = host.querySelector("svg");
    expect(svg?.querySelector("polygon")).not.toBeNull();
    expect(svg?.querySelector("ellipse")).not.toBeNull();
    expect(svg?.querySelectorAll("path").length).toBeGreaterThan(0);
    expect(host.querySelector("[data-board-item='area']")).not.toBeNull();
    expect(host.querySelector("[aria-label='Decision (D)']")).not.toBeNull();

    const surface = host.querySelector("[tabindex]") as HTMLElement;
    act(() => {
      surface.focus();
      surface.dispatchEvent(
        new KeyboardEvent("keydown", { key: "a", metaKey: true, bubbles: true }),
      );
    });
    expect(onSelectionChange).toHaveBeenLastCalledWith([
      "decide",
      "db",
      "doc",
      "net",
      "jobs",
      "area",
    ]);
  });

  it("edits the words under a double-click instead of adding a sticky", () => {
    const onChange = vi.fn();
    const withWords = {
      items: [
        ...board.items,
        {
          id: "title",
          kind: "text" as const,
          x: 40,
          y: 320,
          w: 220,
          h: 48,
          text: "Heading",
          color: "ink" as const,
        },
        {
          id: "link",
          kind: "arrow" as const,
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          from: { item: "decide" },
          to: { item: "db" },
          text: "yes",
          color: "ink" as const,
        },
      ],
    };
    act(() => {
      root.render(<Whiteboard value={withWords} onChange={onChange} />);
    });
    const heading = [...host.querySelectorAll("[data-board-item='title']")].find((node) =>
      node.textContent?.includes("Heading"),
    );
    const label = [...host.querySelectorAll("[data-board-item='link']")].find((node) =>
      node.textContent?.includes("yes"),
    );
    expect(heading).toBeTruthy();
    expect(label).toBeTruthy();
    act(() => {
      heading?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Heading");
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      (host.querySelector("textarea") as HTMLTextAreaElement | null)?.blur();
    });
    act(() => {
      label?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("yes");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("fits a chat card around the blocks", () => {
    act(() => {
      root.render(<BoardThumbnail value={board} />);
    });
    const svg = host.querySelector("svg");
    expect(svg?.getAttribute("aria-label")).toBe("Whiteboard");
    expect(svg?.querySelectorAll("rect").length).toBe(board.items.length);
  });
});
