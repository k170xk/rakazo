/** A stable identity for model bytes, so a new array with the same contents does not reload them. */
export function modelKey(bytes: Uint8Array | null | undefined): string {
  if (!bytes?.byteLength) return "";
  const mid = bytes[bytes.byteLength >> 1] ?? 0;
  return `${bytes.byteLength}:${bytes[0] ?? 0}:${mid}:${bytes[bytes.byteLength - 1] ?? 0}`;
}

export function shouldLoadModel(key: string, asset: string | undefined): boolean {
  return key.length > 0 || Boolean(asset);
}

/** One request per key. A failure is forgotten so a later try can run; a success is kept. */
export function remember<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const existing = cache.get(key);
  if (existing) return existing;
  const job = load().catch((error: unknown) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, job);
  return job;
}
