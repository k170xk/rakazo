import { useLingui } from "@lingui/react/macro";
import type { BoardItem } from "@rakazo/app-kit/ui";
import { readBoard, Whiteboard } from "@rakazo/app-kit/ui";
import type { PageDetail } from "@rakazo/contracts";
import { whiteboardSelectionNote } from "@rakazo/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PageSession } from "../../lib/pages";
import { useSpaceQueries } from "../../lib/query";
import { errorCode } from "../../lib/user-error";

const MAX_UPLOAD_EDGE = 1600;
const MAX_UPLOAD_BYTES = 4.5 * 1024 * 1024;

async function prepareUploadFile(
  file: File,
): Promise<{ name: string; mime: string; base64: string }> {
  let blob: Blob = file;
  let mime = file.type || "image/jpeg";
  if (mime !== "image/svg+xml" && mime !== "image/gif" && typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      const longest = Math.max(bitmap.width, bitmap.height);
      if (longest > MAX_UPLOAD_EDGE || file.size > MAX_UPLOAD_BYTES) {
        const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(1, longest));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const shrunk = await new Promise<Blob | null>((done) =>
            canvas.toBlob(done, "image/jpeg", 0.84),
          );
          if (shrunk) {
            blob = shrunk;
            mime = "image/jpeg";
          }
        }
      }
    } finally {
      bitmap.close();
    }
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const stem = file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "picture";
  const ext =
    mime === "image/png"
      ? "png"
      : mime === "image/svg+xml"
        ? "svg"
        : mime === "image/webp"
          ? "webp"
          : "jpg";
  return { name: `${stem}.${ext}`, mime, base64: btoa(binary) };
}

/**
 * The open whiteboard. Edits auto-save quickly and flush immediately if the user switches boards
 * or closes the studio. A selection is sent with the next message.
 */
export function WhiteboardCanvas({
  pageId,
  title,
  code,
  version,
  session,
}: {
  pageId: string;
  title: string;
  code: string;
  version: number;
  session: PageSession;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const base = useRef(version);
  const pending = useRef(false);
  const gen = useRef(0);
  const timer = useRef<number | null>(null);
  const itemsRef = useRef<BoardItem[]>(readBoard(code).items);
  const assetCache = useRef(new Map<string, Promise<string | null>>());
  const [items, setItems] = useState<BoardItem[]>(() => readBoard(code).items);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (pending.current) return;
    const next = readBoard(code).items;
    itemsRef.current = next;
    setItems(next);
    base.current = version;
  }, [code, version]);

  const save = useCallback(
    async (next: BoardItem[], mine: number) => {
      try {
        const result = await queries.pages.saveBoard.call({
          pageId,
          baseVersion: base.current,
          items: next,
        });
        if (gen.current === mine) {
          pending.current = false;
          setFailed(false);
        }
        base.current = Math.max(base.current, result.version);
        const source = JSON.stringify({ items: next });
        queryClient.setQueriesData<PageDetail>(
          { queryKey: queries.pages.get.queryKey({ input: { pageId } }) },
          (current) =>
            current
              ? {
                  ...current,
                  code: source,
                  version: result.version,
                  currentVersion: result.version,
                  updatedAt: new Date().toISOString(),
                }
              : current,
        );
      } catch (error) {
        if (gen.current !== mine) return;
        pending.current = false;
        if (errorCode(error) === "CONFLICT") {
          void queryClient.invalidateQueries({
            queryKey: queries.pages.get.queryKey({ input: { pageId } }),
          });
          return;
        }
        setFailed(true);
      }
    },
    [pageId, queries, queryClient],
  );

  // Guarantee any unsaved edit flushes immediately on board switch, studio close or tab navigation.
  useEffect(() => {
    const flushNow = () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      if (pending.current) {
        pending.current = false;
        void save(itemsRef.current, gen.current);
      }
    };
    window.addEventListener("pagehide", flushNow);
    window.addEventListener("beforeunload", flushNow);
    return () => {
      window.removeEventListener("pagehide", flushNow);
      window.removeEventListener("beforeunload", flushNow);
      flushNow();
    };
  }, [save]);

  const onChange = useCallback(
    (value: { items: BoardItem[] }) => {
      const mine = ++gen.current;
      pending.current = true;
      itemsRef.current = value.items;
      setItems(value.items);
      setFailed(false);
      // Optimistically reflect edits in query cache immediately so switching boards never flickers.
      const source = JSON.stringify({ items: value.items });
      queryClient.setQueriesData<PageDetail>(
        { queryKey: queries.pages.get.queryKey({ input: { pageId } }) },
        (current) => (current ? { ...current, code: source } : current),
      );
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void save(value.items, mine);
      }, 280);
    },
    [pageId, queryClient, queries.pages.get, save],
  );

  const onSelectionChange = useCallback(
    (ids: string[]) => {
      const chosen = itemsRef.current.filter((item) => ids.includes(item.id));
      const note = whiteboardSelectionNote(chosen);
      session.dock.set({ page: { id: pageId, title, ...(note ? { note } : {}) } });
    },
    [pageId, session, title],
  );

  const onUploadImage = useCallback(
    async (file: File) => {
      const prepared = await prepareUploadFile(file);
      const uploaded = await queries.apps.addAsset.call({ pageId, ...prepared });
      const dataUrl = `data:${prepared.mime};base64,${prepared.base64}`;
      assetCache.current.set(uploaded.id, Promise.resolve(dataUrl));
      return uploaded.id;
    },
    [pageId, queries.apps.addAsset],
  );

  const resolveAsset = useCallback(
    (assetId: string) => {
      const hit = assetCache.current.get(assetId);
      if (hit) return hit;
      const promise = queries.apps.asset
        .call({ pageId, assetId })
        .then((res) => `data:${res.mime};base64,${res.base64}`)
        .catch(() => {
          assetCache.current.delete(assetId);
          return null;
        });
      assetCache.current.set(assetId, promise);
      return promise;
    },
    [pageId, queries.apps.asset],
  );

  return (
    <div className="relative h-full">
      <Whiteboard
        value={{ items }}
        onChange={onChange}
        onSelectionChange={onSelectionChange}
        onUploadImage={onUploadImage}
        resolveAsset={resolveAsset}
        height="100%"
        className="h-full rounded-none border-0"
      />
      {failed ? (
        <p role="alert" className="absolute bottom-16 left-3 text-sm text-destructive">
          {t`Couldn't save the whiteboard.`}
        </p>
      ) : null}
    </div>
  );
}
