import { useEffect, useState } from "react";

export function useSignupsEnabled() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/health")
      .then((response) => response.json())
      .then((body: { signupsEnabled?: boolean }) => {
        if (!cancelled && typeof body.signupsEnabled === "boolean") {
          setEnabled(body.signupsEnabled);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return enabled;
}
