import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSpaceQueries } from "../../lib/query";

export const TODO_REFRESH_MS = 60_000;
/** Cards this new get a glow when the board shows them. */
export const TODO_NEW_MS = 30_000;

/**
 * Open items on the person's list for the sidebar badge, and a counter that goes up each time
 * a refresh brings in items an assistant added since the last one (not on the first load).
 */
export function useTodoBadge(): { open: number; arrivals: number } {
  const queries = useSpaceQueries();
  const list = useQuery({
    ...queries.todos.list.queryOptions({ input: {} }),
    staleTime: TODO_REFRESH_MS,
    refetchInterval: TODO_REFRESH_MS,
  });
  const seen = useRef<Set<string> | null>(null);
  const [arrivals, setArrivals] = useState(0);
  useEffect(() => {
    if (!list.data) return;
    const ids = new Set(list.data.map((item) => item.id));
    const previous = seen.current;
    seen.current = ids;
    const added = list.data.some((item) => item.origin === "ai" && !previous?.has(item.id));
    if (previous && added) setArrivals((count) => count + 1);
  }, [list.data]);
  return {
    open: (list.data ?? []).filter((item) => item.status !== "done").length,
    arrivals,
  };
}
