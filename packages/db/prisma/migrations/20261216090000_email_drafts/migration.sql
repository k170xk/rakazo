-- Additive: the previous release never reads this table or column.
ALTER TABLE "user" ADD COLUMN "emailSignature" TEXT;

CREATE TABLE "email_drafts" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "botId" TEXT,
    "runId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'new',
    "replyToMessageId" TEXT,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_drafts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_drafts_spaceId_userId_threadId_idx" ON "email_drafts"("spaceId", "userId", "threadId");
CREATE INDEX "email_drafts_threadId_idx" ON "email_drafts"("threadId");
CREATE INDEX "email_drafts_botId_idx" ON "email_drafts"("botId");

ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_botId_fkey"
    FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Private to its person within their space.
ALTER TABLE "email_drafts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_drafts_tenant ON "email_drafts"
  USING (
    "spaceId" = NULLIF(current_setting('app.space_id', true), '')
    AND "userId" = NULLIF(current_setting('app.user_id', true), '')
  );
CREATE POLICY email_drafts_system ON "email_drafts"
  USING ((SELECT app_rls_bypass()));
