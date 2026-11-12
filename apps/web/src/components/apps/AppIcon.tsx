import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSpaceQueries } from "../../lib/query";

/** An app's generated OCSC icon, or the fallback while it is drawn (or if it never was). */
export function AppIcon({
  pageId,
  icon,
  className = "size-8",
  fallback = null,
}: {
  pageId: string;
  icon: string | null | undefined;
  className?: string;
  fallback?: ReactNode;
}) {
  const queries = useSpaceQueries();
  const asset = useQuery({
    ...queries.apps.asset.queryOptions({ input: { pageId, assetId: icon ?? "" } }),
    enabled: Boolean(icon),
    // An icon never changes under its id; a new drawing gets a new one.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
  });
  if (!icon || !asset.data) return <>{fallback}</>;
  return (
    <img
      src={`data:${asset.data.mime};base64,${asset.data.base64}`}
      alt=""
      aria-hidden="true"
      className={`shrink-0 object-contain ${className}`}
    />
  );
}
