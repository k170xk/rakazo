import { Trans } from "@lingui/react/macro";
import { useEffect } from "react";

export function IntegrationCallbackPage() {
  // Set only by sign-ins this server finishes itself, such as Microsoft's.
  const error = new URLSearchParams(window.location.search).get("error");
  const failed = error !== null;
  useEffect(() => {
    // The original app verifies the connection with the backend. This window
    // only finishes the browser flow, including when OAuth has severed opener.
    if (!failed) window.close();
  }, [failed]);

  return (
    <div className="grid min-h-screen place-items-center bg-background p-6 text-center text-muted-foreground">
      <p>
        {error === "other_account" ? (
          <Trans>
            That Microsoft account is not yours. Close this window and sign in with your own work
            account.
          </Trans>
        ) : failed ? (
          <Trans>The connection did not finish. Close this window and try again.</Trans>
        ) : (
          <Trans>You can close this window.</Trans>
        )}
      </p>
    </div>
  );
}
