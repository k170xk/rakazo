type SignInBridge = {
  isPluginAvailable?: (name: string) => boolean;
  nativePromise?: (plugin: string, method: string, options?: object) => Promise<unknown>;
};

/**
 * In the iOS app, opens `url` in the system's sign-in sheet (Safari, with paste, Passwords and
 * the person's existing Microsoft session) until it reaches `callbackPath` on this origin.
 * Resolves with that address, `null` if the person closed the sheet, or `undefined` where no
 * sheet exists, which leaves the caller to navigate as a browser would.
 */
export async function systemSignIn(
  url: string,
  callbackPath: string,
  host: { Capacitor?: SignInBridge; location: Pick<Location, "origin"> } = window as never,
): Promise<string | null | undefined> {
  const cap = host.Capacitor;
  if (!cap?.isPluginAvailable?.("SystemSignIn") || !cap.nativePromise) return undefined;
  let result: unknown;
  try {
    result = await cap.nativePromise("SystemSignIn", "start", { url, callbackPath });
  } catch (error) {
    // Older iOS versions cannot match an https callback, so they keep the in-app page.
    if ((error as { code?: string } | null)?.code === "UNAVAILABLE") return undefined;
    throw error;
  }
  const finished = (result as { url?: unknown } | null)?.url;
  if (typeof finished !== "string") return null;
  const target = new URL(finished);
  if (target.origin !== host.location.origin || target.pathname !== callbackPath) return null;
  return target.href;
}
