// @vitest-environment jsdom
import type { DocumentRevision } from "@rakazo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const revisionCall = vi.fn<(input: { rootArtifactId: string; draftSeen?: string }) => unknown>();
const fetchDownload = vi.fn(async (_url: string) => new TextEncoder().encode("draft").buffer);

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: unknown }) => children,
}));
vi.mock("../../lib/query", () => ({
  useSpaceQueries: () => ({
    documents: {
      revision: {
        queryOptions: ({ input }: { input: { rootArtifactId: string; draftSeen?: string } }) => ({
          queryKey: ["documents.revision", input],
          queryFn: async () => revisionCall(input),
        }),
      },
    },
  }),
}));
vi.mock("./word/upload", () => ({
  fetchDownload: (url: string) => fetchDownload(url),
  downloadTokenUrl: (token: string) => `/download?token=${token}`,
}));

import type { LiveDraft } from "./use-live-draft";
import { useLiveDraft } from "./use-live-draft";

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let latest: { draft: LiveDraft<string> | null; version: number | undefined };

const parse = async (bytes: ArrayBuffer) => new TextDecoder().decode(bytes);

function Harness(props: { running: boolean; shownVersion: number }) {
  const { revision, draft } = useLiveDraft({
    rootArtifactId: "doc-1",
    enabled: true,
    running: props.running,
    shownVersion: props.shownVersion,
    parse,
  });
  latest = { draft, version: revision.data?.version };
  return null;
}

async function render(props: { running: boolean; shownVersion: number }) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Harness {...props} />
      </QueryClientProvider>,
    );
  });
}

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function answer(revision: DocumentRevision) {
  revisionCall.mockImplementation(async (input) =>
    revision.draft && input.draftSeen === revision.draft.updatedAt
      ? {
          ...revision,
          draft: { updatedAt: revision.draft.updatedAt, baseVersion: revision.draft.baseVersion },
        }
      : revision,
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  root = createRoot(container);
  revisionCall.mockReset();
  fetchDownload.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
});

const draft = { updatedAt: "2026-11-14T12:00:00.000Z", baseVersion: 2, downloadToken: "t1" };

it("loads a draft newer than the shown version while the assistant works", async () => {
  answer({ artifactId: "v2", version: 2, draft });
  await render({ running: true, shownVersion: 2 });
  await settle();
  expect(fetchDownload).toHaveBeenCalledWith("/download?token=t1");
  expect(latest.draft).toEqual({ updatedAt: draft.updatedAt, baseVersion: 2, value: "draft" });
  expect(revisionCall).toHaveBeenLastCalledWith({
    rootArtifactId: "doc-1",
    draftSeen: draft.updatedAt,
  });
});

it("shows no draft when the assistant is not working", async () => {
  answer({ artifactId: "v2", version: 2, draft });
  await render({ running: false, shownVersion: 2 });
  await settle();
  expect(fetchDownload).not.toHaveBeenCalled();
  expect(latest.draft).toBeNull();
});

it("ignores a draft older than the shown version", async () => {
  answer({ artifactId: "v3", version: 3, draft });
  await render({ running: true, shownVersion: 3 });
  await settle();
  expect(fetchDownload).not.toHaveBeenCalled();
  expect(latest.draft).toBeNull();
});

it("switches back once the studio shows the final version", async () => {
  answer({ artifactId: "v2", version: 2, draft });
  await render({ running: true, shownVersion: 2 });
  await settle();
  expect(latest.draft).not.toBeNull();
  answer({ artifactId: "v3", version: 3 });
  await act(async () => {
    await client.refetchQueries();
  });
  await settle();
  expect(latest.version).toBe(3);
  // The studio is still loading version 3, so the draft stays until it shows it.
  expect(latest.draft).not.toBeNull();
  await render({ running: true, shownVersion: 3 });
  expect(latest.draft).toBeNull();
});

it("keeps the draft after the run until the final version is shown", async () => {
  answer({ artifactId: "v2", version: 2, draft });
  await render({ running: true, shownVersion: 2 });
  await settle();
  expect(latest.draft).not.toBeNull();
  answer({ artifactId: "v3", version: 3 });
  await render({ running: false, shownVersion: 2 });
  // Never back to version 2 between the draft and version 3.
  expect(latest.draft).not.toBeNull();
  await settle();
  expect(latest.version).toBe(3);
  expect(latest.draft).not.toBeNull();
  await render({ running: false, shownVersion: 3 });
  expect(latest.draft).toBeNull();
});

it("drops the draft after the run when no newer version came of it", async () => {
  answer({ artifactId: "v2", version: 2, draft });
  await render({ running: true, shownVersion: 2 });
  await settle();
  expect(latest.draft).not.toBeNull();
  answer({ artifactId: "v2", version: 2 });
  await render({ running: false, shownVersion: 2 });
  await settle();
  expect(latest.draft).toBeNull();
  // A later version saved elsewhere loads as itself, never as the old draft.
  answer({ artifactId: "v3", version: 3 });
  await act(async () => {
    await client.refetchQueries();
  });
  await settle();
  expect(latest.draft).toBeNull();
});
