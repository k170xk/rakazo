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

/**
 * The open whiteboard. Edits save as the next version, and a board the assistant changes is
 * picked up unless the person is mid-edit. A selection is sent with the next message.
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
  const [items, setItems] = useState<BoardItem[]>(() => readBoard(code).items);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (pending.current) return;
    const next = readBoard(code).items;
    itemsRef.current = next;
    setItems(next);
    base.current = version;
  }, [code, version]);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const save = useCallback(
    async (next: BoardItem[], mine: number) => {
      try {
        const result = await queries.pages.saveBoard.call({
          pageId,
          baseVersion: base.current,
          items: next,
        });
        if (gen.current !== mine) return;
        pending.current = false;
        base.current = result.version;
        setFailed(false);
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

  const onChange = useCallback(
    (value: { items: BoardItem[] }) => {
      const mine = ++gen.current;
      pending.current = true;
      itemsRef.current = value.items;
      setItems(value.items);
      setFailed(false);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(value.items, mine), 500);
    },
    [save],
  );

  const onSelectionChange = useCallback(
    (ids: string[]) => {
      const chosen = itemsRef.current.filter((item) => ids.includes(item.id));
      const note = whiteboardSelectionNote(chosen);
      session.dock.set({ page: { id: pageId, title, ...(note ? { note } : {}) } });
    },
    [pageId, session, title],
  );

  return (
    <div className="relative h-full">
      <Whiteboard
        value={{ items }}
        onChange={onChange}
        onSelectionChange={onSelectionChange}
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
