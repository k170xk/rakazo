-- Each conversation's OpenAI vector store and the files indexed into it. No foreign
-- keys: the sweeper still needs the OpenAI ids after a thread, file or space is deleted.
CREATE TABLE "chat_file_indexes" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "vectorStoreId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_file_indexes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_file_indexes_threadId_key" ON "chat_file_indexes"("threadId");
CREATE INDEX "chat_file_indexes_spaceId_idx" ON "chat_file_indexes"("spaceId");
CREATE INDEX "chat_file_indexes_usedAt_idx" ON "chat_file_indexes"("usedAt");

CREATE TABLE "chat_file_index_entries" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "openaiFileId" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_file_index_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_file_index_entries_threadId_artifactId_key" ON "chat_file_index_entries"("threadId", "artifactId");
CREATE INDEX "chat_file_index_entries_artifactId_idx" ON "chat_file_index_entries"("artifactId");
CREATE INDEX "chat_file_index_entries_status_claimedAt_idx" ON "chat_file_index_entries"("status", "claimedAt");
