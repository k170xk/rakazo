import { randomBytes } from "node:crypto";

/** Long enough for the browser to start the download it was issued for. */
export const STORAGE_DOWNLOAD_TOKEN_MS = 60_000;

/** Stored hashed (see `verification.storeIdentifier`), so the table never holds a usable token. */
export const STORAGE_DOWNLOAD_TOKEN_PREFIX = "storage-download-";

export type StorageDownloadItem =
  | { kind: "computer"; botId: string; path: string }
  | { kind: "chat"; artifactId: string };

/** The person the zip is for and what they chose; each item is checked again as theirs. */
export type StorageDownloadGrant = { userId: string; items: StorageDownloadItem[] };

type Verification = { value: string; expiresAt: Date };

function decodeItem(value: unknown): StorageDownloadItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (item.kind === "computer" && typeof item.botId === "string" && typeof item.path === "string")
    return { kind: "computer", botId: item.botId, path: item.path };
  if (item.kind === "chat" && typeof item.artifactId === "string")
    return { kind: "chat", artifactId: item.artifactId };
  return null;
}

function decodeGrant(value: string): StorageDownloadGrant | null {
  try {
    const parsed = JSON.parse(value) as { userId?: unknown; items?: unknown };
    if (typeof parsed.userId !== "string" || !parsed.userId || !Array.isArray(parsed.items))
      return null;
    const items = parsed.items.map(decodeItem);
    if (items.some((item) => item === null)) return null;
    return { userId: parsed.userId, items: items as StorageDownloadItem[] };
  } catch {
    return null;
  }
}

export async function issueStorageDownloadToken(
  adapter: {
    createVerificationValue(data: Verification & { identifier: string }): Promise<unknown>;
  },
  grant: StorageDownloadGrant,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await adapter.createVerificationValue({
    identifier: `${STORAGE_DOWNLOAD_TOKEN_PREFIX}${token}`,
    value: JSON.stringify(grant),
    expiresAt: new Date(Date.now() + STORAGE_DOWNLOAD_TOKEN_MS),
  });
  return token;
}

/** The grant the token was issued for, or null. Consuming is atomic, so a token works once. */
export async function consumeStorageDownloadToken(
  adapter: { consumeVerificationValue(identifier: string): Promise<Verification | null> },
  token: string,
): Promise<StorageDownloadGrant | null> {
  if (!token) return null;
  const stored = await adapter.consumeVerificationValue(`${STORAGE_DOWNLOAD_TOKEN_PREFIX}${token}`);
  if (!stored || stored.expiresAt.getTime() <= Date.now()) return null;
  return decodeGrant(stored.value);
}
