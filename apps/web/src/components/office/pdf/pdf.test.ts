import { afterEach, describe, expect, it, vi } from "vitest";
import type { PdfSnapshot } from "./diff";
import { diffPdf, markupOf } from "./diff";
import { attachPdfHost, PdfHostError, pdfStudioSrc, readRequest, sendAppTheme } from "./host";

const cloud = (text: string, x = 10) =>
  markupOf({ subtype: "Square", contents: text, rect: [x, 10, 50.4, 60] })!;

describe("markupOf", () => {
  it("keys a markup by kind, text and rounded position, and skips links and form fields", () => {
    expect(
      markupOf({ subtype: "FreeText", contentsObj: { str: "  Check\n door " }, rect: [1.4, 2.6] }),
    ).toEqual({
      kind: "FreeText",
      text: "Check door",
      key: "FreeText|Check door|1,3",
    });
    for (const subtype of ["Link", "Widget", "Popup", undefined]) {
      expect(markupOf({ subtype, rect: [0, 0, 1, 1] })).toBeNull();
    }
  });
});

describe("diffPdf", () => {
  const page = (text: string, ...markups: ReturnType<typeof cloud>[]) => ({ text, markups });

  it("reports added, removed and changed pages with the markups that moved", () => {
    const before: PdfSnapshot = {
      pages: [page("A", cloud("Fix")), page("B"), page("C", cloud("Old"))],
    };
    const after: PdfSnapshot = {
      pages: [page("A", cloud("Fix"), cloud("New", 90)), page("B edited")],
    };
    const diff = diffPdf(before, after);
    expect(diff.pages.map((row) => [row.page, row.status, row.textChanged])).toEqual([
      [1, "changed", false],
      [2, "changed", true],
      [3, "removed", false],
    ]);
    expect(diff.pages[0]?.added.map((row) => row.text)).toEqual(["New"]);
    expect(diff.markupsAdded).toBe(1);
    expect(diff.markupsRemoved).toBe(1);
  });

  it("counts duplicate markups one for one, and treats a first version as all added", () => {
    const one = { pages: [page("A", cloud("Same"))] };
    const two = { pages: [page("A", cloud("Same"), cloud("Same"))] };
    expect(diffPdf(one, two).markupsAdded).toBe(1);
    expect(diffPdf(two, two).pages).toEqual([]);
    expect(diffPdf(null, one).pages[0]).toMatchObject({ status: "added", added: [cloud("Same")] });
  });
});

describe("readRequest", () => {
  it("takes only the app's requests, never replies or other messages", () => {
    expect(readRequest({ werkplek: 1, id: 3, soort: "open", bestand: "f" })).toMatchObject({
      id: 3,
      soort: "open",
    });
    expect(readRequest({ werkplek: 1, antwoord: 3, id: 3, soort: "open" })).toBeNull();
    expect(readRequest({ werkplek: 2, id: 3, soort: "open" })).toBeNull();
    expect(readRequest({ werkplek: 1, id: "3", soort: "open" })).toBeNull();
    expect(readRequest("open")).toBeNull();
  });
});

describe("pdfStudioSrc", () => {
  it("starts the bundle connected to this page and file", () => {
    const src = pdfStudioSrc("https://computer.ocsc.me", "root 1");
    expect(src.startsWith("/pdf-studio/index.html#")).toBe(true);
    const hash = new URLSearchParams(src.split("#")[1]);
    expect(Object.fromEntries(hash)).toEqual({
      ouder: "https://computer.ocsc.me",
      app: "pdf",
      bestand: "root 1",
    });
  });

  it("carries Evolve's light or dark mode for the first paint", () => {
    const hash = new URLSearchParams(pdfStudioSrc("https://x", "f", "light").split("#")[1]);
    expect(hash.get("thema")).toBe("light");
  });
});

describe("sendAppTheme", () => {
  function framed(host: object | null) {
    const target = new EventTarget();
    const events: string[] = [];
    target.addEventListener("openaec-host-preferences", (event) => events.push(event.type));
    const win = Object.assign(target, { Event, openaecHost: host });
    return { frame: { contentWindow: win } as unknown as HTMLIFrameElement, win, events };
  }

  it("changes only the theme on the bridge's own host object and tells the app", () => {
    const save = vi.fn();
    const host = { thema: "light", save };
    const { frame, win, events } = framed(host);
    expect(sendAppTheme(frame, "dark")).toBe(true);
    expect(win.openaecHost).toBe(host);
    expect(host).toEqual({ thema: "dark", save });
    expect(events).toEqual(["openaec-host-preferences"]);
  });

  it("leaves a frame without the bridge alone; the link's thema applies there", () => {
    const { frame, win, events } = framed(null);
    expect(sendAppTheme(frame, "dark")).toBe(false);
    expect(win.openaecHost).toBeNull();
    expect(events).toEqual([]);
    expect(sendAppTheme(null, "dark")).toBe(false);
  });
});

describe("attachPdfHost", () => {
  const origin = "https://computer.ocsc.me";
  let detach = () => {};
  afterEach(() => detach());

  function setup(handlers: Parameters<typeof attachPdfHost>[0]["handlers"]) {
    const listeners: ((event: MessageEvent) => void)[] = [];
    const target = {
      location: { origin },
      addEventListener: (_: string, listener: (event: MessageEvent) => void) =>
        listeners.push(listener),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    const postMessage = vi.fn();
    const source = { postMessage };
    const frame = { contentWindow: source } as unknown as HTMLIFrameElement;
    detach = attachPdfHost({ target, frame: () => frame, handlers });
    const send = async (data: unknown, from: unknown = source, at = origin) => {
      for (const listener of listeners)
        await listener({ data, source: from, origin: at } as MessageEvent);
    };
    return { send, postMessage };
  }

  it("answers the frame's requests, moving bytes instead of copying them", async () => {
    const bytes = new ArrayBuffer(4);
    const { send, postMessage } = setup({
      open: async () => ({ value: { bytes }, transfer: [bytes] }),
      geopend: async () => true,
    });
    await send({ werkplek: 1, id: 1, soort: "open", bestand: "f" });
    expect(postMessage).toHaveBeenLastCalledWith(
      { werkplek: 1, antwoord: 1, ok: true, waarde: { bytes } },
      origin,
      [bytes],
    );
    await send({ werkplek: 1, id: 2, soort: "geopend" });
    expect(postMessage).toHaveBeenLastCalledWith(
      { werkplek: 1, antwoord: 2, ok: true, waarde: true },
      origin,
      [],
    );
  });

  it("passes refusals through with their code and names unknown requests", async () => {
    const { send, postMessage } = setup({
      opslaan: async () => {
        throw new PdfHostError("quotum", "No room");
      },
    });
    await send({ werkplek: 1, id: 5, soort: "opslaan" });
    expect(postMessage).toHaveBeenLastCalledWith(
      { werkplek: 1, antwoord: 5, ok: false, fout: "No room", code: "quotum" },
      origin,
      [],
    );
    await send({ werkplek: 1, id: 6, soort: "toString" });
    expect(postMessage.mock.lastCall?.[0]).toMatchObject({ ok: false, code: "onbekende_soort" });
  });

  it("ignores other frames and other origins", async () => {
    const handler = vi.fn(async () => true);
    const { send, postMessage } = setup({ geopend: handler });
    await send({ werkplek: 1, id: 1, soort: "geopend" }, { postMessage: vi.fn() });
    await send({ werkplek: 1, id: 1, soort: "geopend" }, undefined, "https://evil.example");
    expect(handler).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
