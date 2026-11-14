-- The assistant's latest unsent write to an Office file during a run, shown live in its studio.
CREATE TABLE "document_drafts" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rootArtifactId" TEXT NOT NULL,
    "botId" TEXT,
    "storageKey" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_drafts_spaceId_userId_rootArtifactId_key"
    ON "document_drafts"("spaceId", "userId", "rootArtifactId");
CREATE INDEX "document_drafts_rootArtifactId_idx" ON "document_drafts"("rootArtifactId");

ALTER TABLE "document_drafts" ADD CONSTRAINT "document_drafts_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_drafts" ADD CONSTRAINT "document_drafts_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_drafts" ADD CONSTRAINT "document_drafts_rootArtifactId_fkey"
    FOREIGN KEY ("rootArtifactId") REFERENCES "artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_drafts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_drafts_tenant ON "document_drafts"
  USING (
    "spaceId" = NULLIF(current_setting('app.space_id', true), '')
    AND "userId" = NULLIF(current_setting('app.user_id', true), '')
  );
CREATE POLICY document_drafts_system ON "document_drafts"
  USING ((SELECT app_rls_bypass()));
