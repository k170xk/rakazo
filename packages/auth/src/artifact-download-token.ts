import { randomBytes } from "node:crypto";

/** Long enough for the browser to start the download it was issued for. */
export const ARTIFACT_DOWNLOAD_TOKEN_MS = 60_000;

/** Stored hashed (see `verification.storeIdentifier`), so the table never holds a usable token. */
export const ARTIFACT_DOWNLOAD_TOKEN_PREFIX = "artifact-download-";

export type ArtifactDownloadGrant = {
  spaceId: string;
  userId: string;
  artifactId: string;
};

type Verification = { value: string; expiresAt: Date };

function encodeGrant(grant: ArtifactDownloadGrant): string {
  return JSON.stringify(grant);
}

function decodeGrant(value: string): ArtifactDownloadGrant | null {
  try {
    const parsed = JSON.parse(value) as Partial<ArtifactDownloadGrant>;
    if (
      typeof parsed.spaceId !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.artifactId !== "string" ||
      !parsed.spaceId ||
      !parsed.userId ||
      !parsed.artifactId
    ) {
      return null;
    }
    return { spaceId: parsed.spaceId, userId: parsed.userId, artifactId: parsed.artifactId };
  } catch {
    return null;
  }
}

export async function issueArtifactDownloadToken(
  adapter: {
    createVerificationValue(data: Verification & { identifier: string }): Promise<unknown>;
  },
  grant: ArtifactDownloadGrant,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await adapter.createVerificationValue({
    identifier: `${ARTIFACT_DOWNLOAD_TOKEN_PREFIX}${token}`,
    value: encodeGrant(grant),
    expiresAt: new Date(Date.now() + ARTIFACT_DOWNLOAD_TOKEN_MS),
  });
  return token;
}

/** The grant the token was issued for, or null. Consuming is atomic, so a token works once. */
export async function consumeArtifactDownloadToken(
  adapter: { consumeVerificationValue(identifier: string): Promise<Verification | null> },
  token: string,
): Promise<ArtifactDownloadGrant | null> {
  if (!token) return null;
  const stored = await adapter.consumeVerificationValue(
    `${ARTIFACT_DOWNLOAD_TOKEN_PREFIX}${token}`,
  );
  if (!stored || stored.expiresAt.getTime() <= Date.now()) return null;
  return decodeGrant(stored.value);
}
