import { useLingui } from "@lingui/react/macro";
import { toast } from "@rakazo/ui-web";
import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useSpaceQueries } from "../../lib/query";

type ListedDocument = { rootArtifactId: string };

/**
 * Removes a Word, PowerPoint or Excel file, including every saved version.
 * Deleting the file on screen opens another of the same kind, or the empty studio.
 */
export function useDeleteOfficeDocument({
  currentId,
  documents,
  settle,
  onOpenDocument,
  onEmpty,
}: {
  currentId: string;
  documents: readonly ListedDocument[];
  settle: () => Promise<void>;
  onOpenDocument: (rootArtifactId: string) => void;
  onEmpty?: () => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const deleting = useRef<string | null>(null);

  return async (id: string, name: string) => {
    if (deleting.current) return;
    if (!window.confirm(t`Delete ${String(name)}?`)) return;
    deleting.current = id;
    try {
      if (id === currentId) await settle();
      await queries.artifacts.remove.call({ artifactId: id });
      queryClient.setQueriesData<{ items?: ListedDocument[] }>(
        { queryKey: queries.documents.list.key() },
        (current) =>
          current?.items
            ? { ...current, items: current.items.filter((item) => item.rootArtifactId !== id) }
            : current,
      );
      if (id === currentId) {
        const next = documents.find((item) => item.rootArtifactId !== id);
        if (next) onOpenDocument(next.rootArtifactId);
        else onEmpty?.();
      }
      await queryClient.invalidateQueries({ queryKey: queries.documents.list.key() });
    } catch {
      toast.error(t`Could not delete this file.`);
    } finally {
      deleting.current = null;
    }
  };
}
