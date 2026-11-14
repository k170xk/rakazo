// @vitest-environment jsdom
import type { DocumentFormat } from "@rakazo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType, ReactNode } from "react";
import { act, useEffect } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/** What the stubbed editors saw: how often they mounted and what they last showed. */
const seen = vi.hoisted(() => ({
  mounts: 0,
  content: "",
  readOnly: false,
  reset() {
    this.mounts = 0;
    this.content = "";
    this.readOnly = false;
  },
}));
const state = vi.hoisted(() => ({
  running: false,
  version: 1,
  draft: null as null | { updatedAt: string; baseVersion: number; value: unknown },
}));
const decode = vi.hoisted(
  () => (bytes: ArrayBuffer | Uint8Array) => new TextDecoder().decode(bytes),
);

function useStub(content: string, readOnly: boolean) {
  useEffect(() => {
    seen.mounts += 1;
  }, []);
  seen.content = content;
  seen.readOnly = readOnly;
}

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw({ raw: parts }, ...values),
    i18n: { locale: "en" },
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../studio/StudioFrame", () => ({
  StudioFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useStudioDock: () => ({ session: null, running: state.running }),
  control: "",
  pill: "",
}));
vi.mock("../studio/studio-send", () => ({
  setStudioBeforeSend: () => () => {},
  setStudioSelectionImage: () => () => {},
}));
vi.mock("../../lib/auth", () => ({ authClient: { useSession: () => ({ data: null }) } }));
vi.mock("../../lib/pages", () => ({ useMedia: () => false }));
vi.mock("../../lib/rpc", () => ({ selectedSpaceId: () => "s1" }));
vi.mock("../../lib/space-rpc", () => ({ useBoundSpaceId: () => "s1" }));
vi.mock("./document-bot", () => ({ useDocumentBotId: () => ({}) }));
vi.mock("../../lib/query", () => {
  const format = { current: "docx" as string };
  const extension: Record<string, string> = { docx: "docx", xlsx: "xlsx", pptx: "pptx" };
  return {
    setFormat: (next: string) => {
      format.current = next;
    },
    useSpaceQueries: () => ({
      documents: {
        get: {
          call: async ({ rootArtifactId }: { rootArtifactId: string }) => ({
            rootArtifactId,
            format: format.current,
            name: `Plan.${extension[format.current]}`,
            latest: {
              artifactId: `a${state.version}`,
              version: state.version,
              downloadToken: `v${state.version}`,
            },
            versions: Array.from({ length: state.version }, (_, i) => ({
              artifactId: `a${i + 1}`,
              version: i + 1,
              size: 1,
              createdAt: "2026-11-14T12:00:00.000Z",
            })),
          }),
        },
        list: {
          queryOptions: () => ({ queryKey: ["list"], queryFn: async () => ({ items: [] }) }),
          key: () => ["list"],
        },
      },
      artifacts: { meta: { call: async () => ({ botId: null, groupId: null }) } },
    }),
  };
});
vi.mock("./use-live-draft", () => ({
  useLiveDraft: () => ({
    revision: { data: { version: state.version }, refetch: async () => ({}) },
    draft: state.draft,
  }),
  LiveDraftPill: () => <span data-testid="office-live-draft" />,
}));
vi.mock("./word/upload", () => ({
  downloadTokenUrl: (token: string) => token,
  fetchDownload: async (token: string) => new TextEncoder().encode(token).buffer,
  uploadDocumentVersion: async () => ({ kind: "saved" }),
}));
vi.mock("./word/validation", () => ({
  checkDocx: async () => [],
  newDocxErrors: () => [],
}));
vi.mock("./word/WordEditor", () => ({
  default: (props: { bytes: ArrayBuffer; readOnly: boolean }) => {
    useStub(decode(props.bytes), props.readOnly);
    return <div data-testid="editor" />;
  },
}));
vi.mock("./word/WordPreview", () => ({ default: () => <div data-testid="preview" /> }));
vi.mock("./sheet/SheetWorkbench", () => ({
  SheetWorkbench: (props: { wb: { name: string }; readOnly: boolean }) => {
    useStub(props.wb.name, props.readOnly);
    return <div data-testid="editor" />;
  },
}));
vi.mock("./sheet/workbook", async (original) => ({
  ...(await original<object>()),
  openWorkbook: async (bytes: Uint8Array) => ({ name: decode(bytes) }),
  changedCells: () => new Set(),
}));
vi.mock("./slides/SlidesWorkbench", () => ({
  SlidesWorkbench: (props: { deck: { name: string }; readOnly: boolean }) => {
    useStub(props.deck.name, props.readOnly);
    return <div data-testid="editor" />;
  },
  SlidesPreview: () => <div data-testid="preview" />,
}));
vi.mock("./slides/deck", async (original) => ({
  ...(await original<object>()),
  openDeck: async (bytes: Uint8Array) => ({ name: decode(bytes) }),
  changedSlides: () => new Set(),
}));

import * as query from "../../lib/query";
import SheetStudio from "./SheetStudio";
import SlidesStudio from "./SlidesStudio";
import WordStudio from "./WordStudio";

type StudioProps = {
  rootArtifactId: string;
  onClose: () => void;
  onOpenDocument: (id: string) => void;
};

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  seen.reset();
  state.running = false;
  state.version = 1;
  state.draft = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  client.clear();
});

async function render(Studio: ComponentType<StudioProps>) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Studio rootArtifactId="doc-1" onClose={() => {}} onOpenDocument={() => {}} />
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const studios: [DocumentFormat, ComponentType<StudioProps>, (text: string) => unknown][] = [
  ["docx", WordStudio, (text) => new TextEncoder().encode(text).buffer],
  ["xlsx", SheetStudio, (text) => ({ name: text })],
  ["pptx", SlidesStudio, (text) => ({ name: text })],
];

it.each(studios)(
  "%s shows the assistant's draft and its new version in the editor already on screen",
  async (format, Studio, draftValue) => {
    (query as unknown as { setFormat: (format: string) => void }).setFormat(format);
    await render(Studio);
    expect(seen).toMatchObject({ mounts: 1, content: "v1", readOnly: false });

    state.running = true;
    await render(Studio);
    expect(seen).toMatchObject({ mounts: 1, content: "v1", readOnly: true });

    state.draft = {
      updatedAt: "2026-11-14T12:00:01.000Z",
      baseVersion: 1,
      value: draftValue("draft"),
    };
    await render(Studio);
    expect(seen).toMatchObject({ mounts: 1, content: "draft", readOnly: true });
    expect(container.querySelectorAll('[data-testid="editor"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="preview"]')).toBeNull();
    expect(container.querySelector('[data-testid="office-live-draft"]')).not.toBeNull();

    // The run ends and the final version arrives; the draft stays until it has loaded.
    state.running = false;
    state.version = 2;
    await render(Studio);
    state.draft = null;
    await render(Studio);
    expect(seen).toMatchObject({ mounts: 1, content: "v2", readOnly: false });
    expect(container.querySelectorAll('[data-testid="editor"]')).toHaveLength(1);
  },
);
