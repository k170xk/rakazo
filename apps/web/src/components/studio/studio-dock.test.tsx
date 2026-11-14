// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createPageSession, PagesProvider } from "../../lib/pages";
import type { StudioCard } from "../../lib/studio-activity";
import { StudioFloatingDock, studioDockStyle } from "./studio-dock";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce(
        (text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`,
        "",
      ),
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | undefined;
afterEach(() => {
  document.body.replaceChildren();
  host = undefined;
});

it("reserves room under the floating composer only while the chat is closed", () => {
  expect(studioDockStyle(true, true)).toEqual({ "--studio-dock-space": "0px" });
  expect(studioDockStyle(false, false)).toEqual({ "--studio-dock-space": "5.5rem" });
  expect(studioDockStyle(false, true)).toEqual({ "--studio-dock-space": "7rem" });
});

function render(node: ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return root;
}

const cards: StudioCard[] = [
  { id: "m1:text", who: "you", text: "Add a chart", live: false },
  { id: "m2:step:0", who: "action", text: "Edited the sheet", live: false },
];

it("folds the activity into one button beside the composer instead of cards", () => {
  const session = createPageSession();
  const root = render(
    <PagesProvider value={{ open: () => {}, session }}>
      <StudioFloatingDock activity={cards} running={false} onOpenChat={() => {}}>
        <span>composer</span>
      </StudioFloatingDock>
    </PagesProvider>,
  );
  const button = host?.querySelector<HTMLElement>("[data-testid=studio-activity-button]");
  expect(button?.getAttribute("aria-label")).toBe("Recent messages and actions");
  expect(button?.className).toContain("max-md:hidden");
  expect(button?.dataset.unseen).toBeUndefined();
  expect(host?.querySelector("[data-testid=studio-activity-row]")).toBeNull();
  expect(
    host?.querySelector<HTMLElement>("[data-testid=studio-working-line]")?.dataset.running,
  ).toBeUndefined();
  expect(session.dock.getOpenChat()).not.toBeNull();
  act(() => root.unmount());
  expect(session.dock.getOpenChat()).toBeNull();
});

it("marks new activity and lists it as rows that open the chat", async () => {
  let opened = 0;
  const dock = (activity: StudioCard[], running: boolean) => (
    <PagesProvider value={{ open: () => {}, session: createPageSession() }}>
      <StudioFloatingDock activity={activity} running={running} onOpenChat={() => (opened += 1)}>
        <span>composer</span>
      </StudioFloatingDock>
    </PagesProvider>
  );
  const root = render(dock(cards, false));
  const reply: StudioCard = { id: "m3:text", who: "agent", text: "Done", live: false };
  act(() => root.render(dock([...cards, reply], true)));
  const button = host?.querySelector<HTMLElement>("[data-testid=studio-activity-button]");
  expect(button?.dataset.unseen).toBe("true");
  expect(button?.dataset.running).toBe("true");
  expect(
    host?.querySelector<HTMLElement>("[data-testid=studio-working-line]")?.dataset.running,
  ).toBe("true");
  await act(async () => button?.click());
  const rows = [...document.querySelectorAll<HTMLElement>("[data-testid=studio-activity-row]")];
  expect(rows.map((row) => row.textContent)).toEqual([
    "YouAdd a chart",
    "ActionEdited the sheet",
    "ReplyDone",
    "NowWorking…",
  ]);
  expect(button?.dataset.unseen).toBeUndefined();
  await act(async () => rows[2]?.click());
  expect(opened).toBe(1);
  expect(document.querySelector("[data-testid=studio-activity-row]")).toBeNull();
  act(() => root.unmount());
});

it("leaves the button out when there is nothing to show", () => {
  const root = render(
    <PagesProvider value={{ open: () => {}, session: createPageSession() }}>
      <StudioFloatingDock activity={[]} running={false} onOpenChat={() => {}}>
        <span>composer</span>
      </StudioFloatingDock>
    </PagesProvider>,
  );
  expect(host?.querySelector("[data-testid=studio-activity-button]")).toBeNull();
  act(() => root.unmount());
});

it("floats the dock without a band that blocks the canvas", () => {
  host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <PagesProvider value={{ open: () => {}, session: createPageSession() }}>
        <StudioFloatingDock lift="2.25rem">
          <span>composer</span>
        </StudioFloatingDock>
      </PagesProvider>,
    );
  });
  const dock = host.querySelector<HTMLElement>("[data-testid=studio-floating-dock]");
  expect(dock?.className).toContain("pointer-events-none");
  expect(dock?.className).not.toMatch(/\bbg-/);
  expect(dock?.style.bottom).toContain("2.25rem");
  expect(dock?.firstElementChild?.className).toContain("pointer-events-auto");
  act(() => root.unmount());
});
