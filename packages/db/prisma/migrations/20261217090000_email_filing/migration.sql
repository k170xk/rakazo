-- Additive: the previous release never reads these tables.
CREATE TABLE "email_filing_batches" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "botId" TEXT,
    "runId" TEXT,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "version" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_filing_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_filing_batches_spaceId_userId_status_idx" ON "email_filing_batches"("spaceId", "userId", "status");
CREATE INDEX "email_filing_batches_threadId_idx" ON "email_filing_batches"("threadId");
CREATE INDEX "email_filing_batches_botId_idx" ON "email_filing_batches"("botId");
CREATE INDEX "email_filing_batches_expiresAt_idx" ON "email_filing_batches"("expiresAt");

ALTER TABLE "email_filing_batches" ADD CONSTRAINT "email_filing_batches_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_filing_batches" ADD CONSTRAINT "email_filing_batches_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_filing_batches" ADD CONSTRAINT "email_filing_batches_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_filing_batches" ADD CONSTRAINT "email_filing_batches_botId_fkey"
    FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "email_filing_profiles" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_filing_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_filing_profiles_spaceId_userId_key" ON "email_filing_profiles"("spaceId", "userId");
CREATE INDEX "email_filing_profiles_userId_idx" ON "email_filing_profiles"("userId");

ALTER TABLE "email_filing_profiles" ADD CONSTRAINT "email_filing_profiles_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_filing_profiles" ADD CONSTRAINT "email_filing_profiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "email_filing_folders" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_filing_folders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_filing_folders_spaceId_userId_jobKey_key" ON "email_filing_folders"("spaceId", "userId", "jobKey");
CREATE INDEX "email_filing_folders_userId_idx" ON "email_filing_folders"("userId");

ALTER TABLE "email_filing_folders" ADD CONSTRAINT "email_filing_folders_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_filing_folders" ADD CONSTRAINT "email_filing_folders_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Each is private to its person within their space.
ALTER TABLE "email_filing_batches" ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_filing_batches_tenant ON "email_filing_batches"
  USING (
    "spaceId" = NULLIF(current_setting('app.space_id', true), '')
    AND "userId" = NULLIF(current_setting('app.user_id', true), '')
  );
CREATE POLICY email_filing_batches_system ON "email_filing_batches"
  USING ((SELECT app_rls_bypass()));

ALTER TABLE "email_filing_profiles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_filing_profiles_tenant ON "email_filing_profiles"
  USING (
    "spaceId" = NULLIF(current_setting('app.space_id', true), '')
    AND "userId" = NULLIF(current_setting('app.user_id', true), '')
  );
CREATE POLICY email_filing_profiles_system ON "email_filing_profiles"
  USING ((SELECT app_rls_bypass()));

ALTER TABLE "email_filing_folders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_filing_folders_tenant ON "email_filing_folders"
  USING (
    "spaceId" = NULLIF(current_setting('app.space_id', true), '')
    AND "userId" = NULLIF(current_setting('app.user_id', true), '')
  );
CREATE POLICY email_filing_folders_system ON "email_filing_folders"
  USING ((SELECT app_rls_bypass()));
