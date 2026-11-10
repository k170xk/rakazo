import { Trans } from "@lingui/react/macro";
import { useEffect } from "react";

export function IntegrationCallbackPage() {
  // Set only by sign-ins this server finishes itself, such as Microsoft's.
  const failed = new URLSearchParams(window.location.search).has("error");
  useEffect(() => {
    // The original app verifies the connection with the backend. This window
    // only finishes the browser flow, including when OAuth has severed opener.
    if (!failed) window.close();
  }, [failed]);

  return (
    <div className="grid min-h-screen place-items-center bg-background p-6 text-center text-muted-foreground">
      <p>
        {failed ? (
          <Trans>The connection did not finish. Close this window and try again.</Trans>
        ) : (
          <Trans>You can close this window.</Trans>
        )}
      </p>
    </div>
  );
}
