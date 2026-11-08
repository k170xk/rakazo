-- What each person's bots may do on a computer; null follows the company default.
ALTER TABLE "user" ADD COLUMN "computerAccess" TEXT;

-- Video renders holding or waiting for one of the shared render slots.
CREATE TABLE "heavy_tool_jobs" (
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "jobRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "touchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),

    CONSTRAINT "heavy_tool_jobs_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "heavy_tool_jobs_state_createdAt_idx" ON "heavy_tool_jobs"("state", "createdAt");
