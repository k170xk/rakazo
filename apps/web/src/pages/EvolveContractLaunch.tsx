import { Button } from "@rakazo/ui-web";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { LoadingState } from "../components/ai/primitives";
import { rpc } from "../lib/rpc";

/**
 * Deep-link landing route for Evolve Legal Contracts (`/app/evolve-contract/:contractId`).
 *
 * Idempotently provisions/reuses this user's dedicated Legal Red-Pen agent for the
 * contract, syncs all contract files + active OCSC Clause Library, and redirects:
 * - Embedded (`?embed=1`): straight to `/app/:botId?embed=1` (clean full-width chat inside Evolve)
 * - Standalone: straight to `/app/:botId?doc=:primaryDocId&kind=:format` (Word Studio side-by-side!)
 */
export function EvolveContractLaunchPage() {
  const { contractId } = useParams<{ contractId: string }>();
  const [searchParams] = useSearchParams();
  const embed = searchParams.get("embed") === "1";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef<string | null>(null);

  const launch = useCallback(async () => {
    if (!contractId) {
      setError("Missing contract ID.");
      return;
    }
    setError(null);
    try {
      const result = await rpc.bots.openEvolveContract({ contractId });
      await queryClient.invalidateQueries();
      const nextParams = new URLSearchParams();
      if (embed) {
        nextParams.set("embed", "1");
      } else if (result.primaryDocArtifactId) {
        nextParams.set("doc", result.primaryDocArtifactId);
        if (result.primaryDocFormat) nextParams.set("kind", result.primaryDocFormat);
      }
      const query = nextParams.toString();
      navigate(`/app/${encodeURIComponent(result.botId)}${query ? `?${query}` : ""}`, {
        replace: true,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not prepare the Legal Red-Pen agent for this contract.",
      );
    }
  }, [contractId, embed, navigate, queryClient]);

  useEffect(() => {
    if (!contractId || startedRef.current === contractId) return;
    startedRef.current = contractId;
    void launch();
  }, [contractId, launch]);

  if (error) {
    return (
      <div className="grid h-full place-items-center bg-background px-6 text-center">
        <div className="max-w-sm space-y-3">
          <p className="text-sm font-medium text-foreground">
            Could not open contract workspace
          </p>
          <p className="text-xs text-muted-foreground">{error}</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              startedRef.current = null;
              void launch();
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full place-items-center bg-background px-6 text-center">
      <div className="space-y-2">
        <LoadingState label="Preparing Legal Red-Pen Agent" />
        <p className="text-xs text-muted-foreground">
          Syncing contract documents and OCSC Clause Library from Evolve…
        </p>
      </div>
    </div>
  );
}
