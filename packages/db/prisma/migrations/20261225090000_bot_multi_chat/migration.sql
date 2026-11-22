-- Additive columns for multiple conversations per agent.
-- Existing primary conversations keep their 1:1 threads.botId untouched.
ALTER TABLE "threads" ADD COLUMN "chatBotId" TEXT;
ALTER TABLE "threads" ADD COLUMN "title" TEXT;
ALTER TABLE "threads" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "threads_chatBotId_updatedAt_idx" ON "threads"("chatBotId", "updatedAt");
CREATE INDEX "threads_spaceId_chatBotId_idx" ON "threads"("spaceId", "chatBotId");

ALTER TABLE "threads" ADD CONSTRAINT "threads_chatBotId_fkey"
  FOREIGN KEY ("chatBotId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
