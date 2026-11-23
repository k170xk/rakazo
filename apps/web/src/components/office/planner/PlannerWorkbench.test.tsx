// @vitest-environment jsdom
import type { JanttData } from "@jantt/core";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanDocument } from "./plan";

const janttSeen = vi.hoisted(() => ({
  mounts: 0,
  lastData: null as JanttData | null,
  lastViewport: null as Record<string, unknown> | null,
  reset() {
    this.mounts = 0;
    this.lastData = null;
    this.lastViewport = null;
  },
}));

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw({ raw: parts }, ...values),
    i18n: { locale: "en" },
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@lingui/react", () => {
  type Descriptor = { id?: string; message?: string; values?: Record<string, unknown> };
  const format = (d: Descriptor | string) =>
    typeof d === "string"
      ? d
      : (d.message ?? d.id ?? "").replace(/\{(\w+)\}/g, (_, key: string) =>
          String(d.values?.[key] ?? ""),
        );
  const i18n = { locale: "en", _: format, t: format };
  return {
    useLingui: () => ({ i18n, _: format }),
    Trans: (props: Descriptor) => format(props),
    I18nProvider: ({ children }: { children: ReactNode }) => children,
  };
});

vi.mock("@jantt/react", async () => {
  const { useEffect } = await import("react");
  return {
    Jantt: ({
      data,
      viewport,
    }: {
      data: JanttData;
      viewport?: Record<string, unknown>;
    }) => {
      useEffect(() => {
        janttSeen.mounts += 1;
      }, []);
      janttSeen.lastData = data;
      janttSeen.lastViewport = viewport ?? null;
      return (
        <div className="jantt-root" data-testid="jantt-stub">
          <div className="jantt-body-wrap">
            {(data.tasks ?? []).map((task) => (
              <div key={task.id} className="jantt-label-row" data-row-id={task.id}>
                <span className="jantt-label-text">{task.label}</span>
              </div>
            ))}
          </div>
        </div>
      );
    },
  };
});

import { PlannerWorkbench } from "./PlannerWorkbench";

const SAMPLE_PLAN: PlanDocument = {
  title: "Ballyraggett Bridge",
  categories: {
    enabling: { label: "Enabling", color: "#76BF43" },
    structures: { label: "Structures", color: "#2563EB" },
  },
  tasks: [
    {
      id: "stage-1",
      label: "Stage 1 — Enabling Works",
      category: "enabling",
      start: "2027-03-01",
      end: "2027-03-26",
      progress: 0.4,
      customFields: { summary: true, outlineLevel: 1 },
    },
    {
      id: "t1",
      label: "Site clearance",
      category: "enabling",
      start: "2027-03-01",
      end: "2027-03-10",
      progress: 0.5,
      status: "in-progress",
      assignee: "Keith Knox",
    },
    {
      id: "t2",
      label: "Abutment piling",
      category: "structures",
      start: "2027-03-11",
      end: "2027-03-26",
      dependencies: ["t1"],
      progress: 0,
      status: "not-started",
    },
  ],
};

describe("PlannerWorkbench chrome and views", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    janttSeen.reset();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: () => ({
        matches: false,
        media: "",
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      }),
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("switches across Gantt, Kanban, Tasks, Health & PM and Notes without unmounting Jantt", async () => {
    const onCommit = vi.fn();
    await act(async () => {
      root.render(<PlannerWorkbench plan={SAMPLE_PLAN} onCommit={onCommit} />);
    });

    expect(janttSeen.mounts).toBe(1);
    expect(janttSeen.lastData?.tasks).toHaveLength(3);

    // Search filters Gantt losslessly: Jantt still receives all 3 tasks while non-matches dim.
    const search = host.querySelector<HTMLInputElement>('[data-testid="planner-search-input"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(search, "piling");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(janttSeen.lastData?.tasks).toHaveLength(3);
    const t1Row = host.querySelector<HTMLElement>('.jantt-label-row[data-row-id="t1"]')!;
    const t2Row = host.querySelector<HTMLElement>('.jantt-label-row[data-row-id="t2"]')!;
    expect(t1Row.classList.contains("is-filter-muted")).toBe(true);
    expect(t2Row.classList.contains("is-filter-match")).toBe(true);

    // Clear search
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(search, "");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Switch to Kanban
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="planner-tab-kanban"]')!.click();
    });
    expect(host.querySelector('[data-testid="planner-kanban-view"]')).not.toBeNull();
    expect(janttSeen.mounts).toBe(1);

    // Switch to Tasks
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="planner-tab-tasks"]')!.click();
    });
    expect(host.querySelector('[data-testid="planner-tasks-view"]')).not.toBeNull();

    // Switch to Health & PM and save a baseline
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="planner-tab-health"]')!.click();
    });
    expect(host.querySelector('[data-testid="planner-health-view"]')).not.toBeNull();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="planner-health-save-baseline"]')!.click();
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const baselined = onCommit.mock.calls[0]![0] as PlanDocument;
    expect(baselined.tasks).toHaveLength(3);
    expect(baselined.tasks.find((task) => task.id === "t1")?.baseline?.start).toBe("2027-03-01");

    // Switch to Notes and add a project note
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="planner-tab-notes"]')!.click();
    });
    expect(host.querySelector('[data-testid="planner-notes-view"]')).not.toBeNull();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="planner-add-note"]')!.click();
    });
    expect(onCommit).toHaveBeenCalledTimes(2);
    const withNote = onCommit.mock.calls[1]![0] as PlanDocument;
    expect(withNote.notes?.length).toBe(1);

    // Back to Gantt: Jantt was never unmounted
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="planner-tab-gantt"]')!.click();
    });
    expect(janttSeen.mounts).toBe(1);
  });

  it("exposes horizontal zoom slider, vertical row-height slider, Fit toggle and Critical Path button on the Gantt toolbar", async () => {
    await act(async () => {
      root.render(<PlannerWorkbench plan={SAMPLE_PLAN} onCommit={vi.fn()} />);
    });

    const zoomSlider = host.querySelector<HTMLInputElement>('[data-testid="planner-zoom-slider"]')!;
    const rowSlider = host.querySelector<HTMLInputElement>(
      '[data-testid="planner-rowheight-slider"]',
    )!;
    const fitBtn = host.querySelector<HTMLButtonElement>('[data-testid="planner-rowheight-fit"]')!;
    const criticalBtn = host.querySelector<HTMLButtonElement>(
      '[data-testid="planner-critical-toggle"]',
    )!;
    expect(zoomSlider).not.toBeNull();
    expect(rowSlider).not.toBeNull();
    expect(fitBtn).not.toBeNull();
    expect(criticalBtn).not.toBeNull();
    expect(criticalBtn.getAttribute("aria-pressed")).toBe("true");

    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

    // Dragging the horizontal zoom slider updates dayWidth and syncs the matching time scale.
    await act(async () => {
      setValue.call(zoomSlider, "36");
      zoomSlider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(janttSeen.lastViewport?.dayWidth).toBe(36);
    expect(janttSeen.lastViewport?.scale).toBe("day");

    // Clicking Fit switches rowHeightMode to "fit"; dragging the vertical slider switches back to custom.
    await act(async () => {
      fitBtn.click();
    });
    expect(janttSeen.lastViewport?.rowHeightMode).toBe("fit");
    expect(fitBtn.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      setValue.call(rowSlider, "64");
      rowSlider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(janttSeen.lastViewport?.rowHeightMode).toBe("custom");
    expect(janttSeen.lastViewport?.rowHeight).toBe(64);
    expect(fitBtn.getAttribute("aria-pressed")).toBe("false");

    // Clicking the Critical Path button toggles showCriticalPath directly.
    await act(async () => {
      criticalBtn.click();
    });
    expect(janttSeen.lastViewport?.showCriticalPath).toBe(false);
    expect(criticalBtn.getAttribute("aria-pressed")).toBe("false");

    // Switching to Kanban hides the Gantt-only sliders and Critical Path button.
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="planner-tab-kanban"]')!.click();
    });
    expect(host.querySelector('[data-testid="planner-zoom-slider"]')).toBeNull();
    expect(host.querySelector('[data-testid="planner-rowheight-slider"]')).toBeNull();
    expect(host.querySelector('[data-testid="planner-critical-toggle"]')).toBeNull();
  });

  it("hides mutating actions in readOnly mode", async () => {
    await act(async () => {
      root.render(<PlannerWorkbench plan={SAMPLE_PLAN} readOnly onCommit={vi.fn()} />);
    });
    expect(host.querySelector('[data-testid="planner-add-task"]')).toBeNull();
  });
});
