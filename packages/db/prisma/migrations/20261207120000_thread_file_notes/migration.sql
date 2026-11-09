-- The bot's one-line note on what each file attached to a conversation contains.
CREATE TABLE "thread_file_notes" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "thread_file_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "thread_file_notes_threadId_artifactId_key" ON "thread_file_notes"("threadId", "artifactId");
CREATE INDEX "thread_file_notes_artifactId_idx" ON "thread_file_notes"("artifactId");
CREATE INDEX "thread_file_notes_spaceId_idx" ON "thread_file_notes"("spaceId");

ALTER TABLE "thread_file_notes" ADD CONSTRAINT "thread_file_notes_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "thread_file_notes" ADD CONSTRAINT "thread_file_notes_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "thread_file_notes" ADD CONSTRAINT "thread_file_notes_artifactId_fkey"
    FOREIGN KEY ("artifactId") REFERENCES "artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "thread_file_notes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY thread_file_notes_tenant ON "thread_file_notes"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY thread_file_notes_system ON "thread_file_notes"
  USING ((SELECT app_rls_bypass()));
