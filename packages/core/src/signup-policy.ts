export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function emailAllowed(email: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const normalized = email.trim().toLowerCase();
  const domain = normalized.split("@")[1];
  return allowlist.some((entry) => {
    if (entry.startsWith("@")) return domain === entry.slice(1);
    return normalized === entry;
  });
}

export const MESSAGING_EMAIL_SUFFIX = "@messaging.invalid";

/** Internal messaging users have no mailbox and cannot authenticate by email. */
export function isMessagingEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(MESSAGING_EMAIL_SUFFIX);
}

/**
 * The address to name someone by to Evolve, which trusts it as their staff identity: only one
 * they proved they receive mail at, never an internal messaging address.
 */
export function provenEmail(
  user: { email: string | null; emailVerified: boolean } | null | undefined,
): string | null {
  if (!user?.email || !user.emailVerified || isMessagingEmail(user.email)) return null;
  return user.email;
}

/** A successful signup with an explicit null token awaits mailbox proof. */
export function signupRequiresEmailVerification(response: unknown): boolean {
  return Boolean(
    response && typeof response === "object" && "token" in response && response.token === null,
  );
}

/** Sign-ups open only when the operator says so; a missing setting keeps them closed. */
export function signupsOpen(enabled: string | undefined): boolean {
  if (enabled === undefined || enabled.trim() === "") return false;
  return enabled !== "false" && enabled !== "0";
}

export function signupPolicyFromEnv(input: {
  signupsEnabled: string | undefined;
  signupAllowlist: string | undefined;
}): { enabled: boolean; allowlist: string[] } {
  return {
    enabled: signupsOpen(input.signupsEnabled),
    allowlist: parseAllowlist(input.signupAllowlist),
  };
}
