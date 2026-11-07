import { readEvolveOwnProfile } from "@rakazo/adapters";
import { getLogger } from "@rakazo/logging";
import type { RouterDeps } from "./router.js";

const RECHECK_MS = 6 * 60 * 60 * 1000;
const lastChecked = new Map<string, number>();

/** Whether a picture came from Evolve's storage, so a newer Evolve photo may replace it. */
function fromEvolve(image: string, evolveUrl: string): boolean {
  try {
    return new URL(image).origin === new URL(evolveUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Keeps an account's picture in step with its linked Evolve profile (matched by email): sets it
 * when the account has none, or updates one that came from Evolve. A picture from anywhere else
 * is the person's own choice and is left alone.
 */
export async function syncEvolvePhoto(
  deps: Pick<RouterDeps, "prisma" | "evolvePlugins">,
  user: { id: string; email: string; image: string | null },
  now = Date.now(),
): Promise<void> {
  const connection = deps.evolvePlugins;
  if (!connection) return;
  if (user.image && !fromEvolve(user.image, connection.url)) return;
  const previous = lastChecked.get(user.id);
  if (previous !== undefined && now - previous < RECHECK_MS) return;
  lastChecked.set(user.id, now);
  try {
    const { photo } = await readEvolveOwnProfile(connection, user.email);
    if (!photo || photo === user.image) return;
    await deps.prisma.user.updateMany({
      // Guards against overwriting a picture the person set in the meantime.
      where: { id: user.id, image: user.image },
      data: { image: photo },
    });
  } catch (error) {
    getLogger().warn("evolve photo sync", { error: String(error) });
  }
}

export function resetEvolvePhotoChecks(): void {
  lastChecked.clear();
}
