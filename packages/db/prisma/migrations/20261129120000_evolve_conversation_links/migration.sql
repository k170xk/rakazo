-- Earlier Evolve conversations each person continued in one of their bots' chats.
CREATE TABLE "evolve_conversation_links" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evolve_conversation_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "evolve_conversation_links_userId_conversationId_botId_key" ON "evolve_conversation_links"("userId", "conversationId", "botId");
CREATE INDEX "evolve_conversation_links_userId_spaceId_idx" ON "evolve_conversation_links"("userId", "spaceId");
CREATE INDEX "evolve_conversation_links_botId_idx" ON "evolve_conversation_links"("botId");

ALTER TABLE "evolve_conversation_links" ADD CONSTRAINT "evolve_conversation_links_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
