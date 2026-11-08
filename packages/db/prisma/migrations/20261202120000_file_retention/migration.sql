-- An admin-set computer storage limit per person; null follows the company default.
ALTER TABLE "user" ADD COLUMN "storageLimitMb" INTEGER;

-- How big each computer's home was when file cleanup last measured it.
ALTER TABLE "computers" ADD COLUMN "homeBytes" BIGINT;
ALTER TABLE "computers" ADD COLUMN "homeBytesAt" TIMESTAMP(3);

-- Items in a bot's folder its owner pinned, so cleanup never deletes them.
CREATE TABLE "kept_files" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kept_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kept_files_botId_path_key" ON "kept_files"("botId", "path");
CREATE INDEX "kept_files_userId_idx" ON "kept_files"("userId");
