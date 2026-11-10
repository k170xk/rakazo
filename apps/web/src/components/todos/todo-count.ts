import { useQuery } from "@tanstack/react-query";
import { useSpaceQueries } from "../../lib/query";

export const TODO_REFRESH_MS = 60_000;

/** Open items on the person's list, for the sidebar badge. */
export function useOpenTodoCount(): number {
  const queries = useSpaceQueries();
  const list = useQuery({
    ...queries.todos.list.queryOptions({ input: {} }),
    staleTime: TODO_REFRESH_MS,
    refetchInterval: TODO_REFRESH_MS,
  });
  return (list.data ?? []).filter((item) => item.status !== "done").length;
}
