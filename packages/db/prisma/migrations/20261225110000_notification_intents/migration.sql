-- Additive: durable notification outbox. The previous release never reads this table.
CREATE TABLE "notification_intents" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "groupId" TEXT,
    "runId" TEXT,
    "messageId" TEXT,
    "sourceEventKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "claimedAt" TIMESTAMP(3),
    "deliveryId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_intents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_intents_userId_sourceEventKey_key"
  ON "notification_intents"("userId", "sourceEventKey");
CREATE INDEX "notification_intents_status_nextAttemptAt_idx"
  ON "notification_intents"("status", "nextAttemptAt");
CREATE INDEX "notification_intents_spaceId_userId_status_idx"
  ON "notification_intents"("spaceId", "userId", "status");

ALTER TABLE "notification_intents" ADD CONSTRAINT "notification_intents_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Private to its person within their space; system drain claims across spaces.
ALTER TABLE "notification_intents" ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_intents_tenant ON "notification_intents"
  USING (
    "spaceId" = NULLIF(current_setting('app.space_id', true), '')
    AND "userId" = NULLIF(current_setting('app.user_id', true), '')
  );
CREATE POLICY notification_intents_system ON "notification_intents"
  USING ((SELECT app_rls_bypass()));
