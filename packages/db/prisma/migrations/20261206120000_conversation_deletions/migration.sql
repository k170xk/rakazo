-- Deleted chats' conversations/<threadId> folders still on a person's Team Computer.
CREATE TABLE "conversation_deletions" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_deletions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_deletions_userId_threadId_key" ON "conversation_deletions"("userId", "threadId");
CREATE INDEX "conversation_deletions_spaceId_userId_idx" ON "conversation_deletions"("spaceId", "userId");

ALTER TABLE "conversation_deletions" ADD CONSTRAINT "conversation_deletions_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
