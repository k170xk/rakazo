// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Rows, Table } from "./data.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let posted: Array<{ type?: string; key?: string; value?: unknown }>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  host = document.body.appendChild(document.createElement("div"));
  posted = [];
  vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
    posted.push(message as never);
  });
});
afterEach(() => {
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function render(node: React.ReactNode) {
  const root = createRoot(host);
  act(() => root.render(node));
  return root;
}

function answer(data: object) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data }));
  });
}

describe("usePageState", () => {
  async function counter() {
    const { usePageState } = await import("./state.js");
    function Counter() {
      const [count, setCount, status] = usePageState("count", 0);
      return (
        <button
          type="button"
          data-can-save={String(status.canSave)}
          onClick={() => setCount((n) => n + 1)}
        >
          {count}
        </button>
      );
    }
    render(<Counter />);
    return () => host.querySelector("button")!;
  }

  it("shows what the app saved and keeps each change after a pause", async () => {
    const button = await counter();
    expect(posted).toEqual([{ type: "rakazo-page:state-read" }]);
    answer({ type: "rakazo-page:state", values: { count: 4 }, writable: true });
    expect(button().textContent).toBe("4");
    expect(button().dataset.canSave).toBe("true");
    act(() => button().click());
    act(() => button().click());
    expect(button().textContent).toBe("6");
    act(() => vi.advanceTimersByTime(500));
    expect(posted.filter((m) => m.type === "rakazo-page:state-write")).toEqual([
      { type: "rakazo-page:state-write", key: "count", value: 6 },
    ]);
  });

  it("works for the visit when the app keeps nothing, and sends nothing", async () => {
    const button = await counter();
    act(() => vi.advanceTimersByTime(3000));
    act(() => button().click());
    act(() => vi.advanceTimersByTime(500));
    expect(button().textContent).toBe("1");
    expect(button().dataset.canSave).toBe("false");
    expect(posted.filter((m) => m.type === "rakazo-page:state-write")).toEqual([]);
  });

  it("keeps a change made before the saved values arrived", async () => {
    const button = await counter();
    act(() => button().click());
    answer({ type: "rakazo-page:state", values: { count: 9 }, writable: true });
    expect(button().textContent).toBe("1");
    act(() => vi.advanceTimersByTime(500));
    expect(posted.filter((m) => m.type === "rakazo-page:state-write")).toEqual([
      { type: "rakazo-page:state-write", key: "count", value: 1 },
    ]);
  });
});

describe("row selection", () => {
  it("picks a Table row by its index in rows, even when sorted", () => {
    const picked: number[] = [];
    render(
      <Table
        columns={["Job", "Due"]}
        rows={[
          ["W412", "2026-12-04"],
          ["W388", "2026-11-14"],
        ]}
        sortable
        selected={1}
        onSelect={(index) => picked.push(index)}
      />,
    );
    const rows = [...host.querySelectorAll("tbody tr")] as HTMLElement[];
    expect(rows[1]!.dataset.selected).toBe("true");
    act(() => rows[0]!.click());
    act(() => {
      rows[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(picked).toEqual([0, 1]);
  });

  it("leaves rows plain without onSelect", () => {
    render(<Rows rows={[{ title: "W407" }]} />);
    expect(host.querySelector("li")!.hasAttribute("tabindex")).toBe(false);
  });
});
