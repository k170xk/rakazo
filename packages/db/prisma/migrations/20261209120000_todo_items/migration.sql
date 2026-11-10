-- Additive: the previous release never reads this table.
CREATE TABLE "todo_items" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "dueAt" TIMESTAMP(3),
    "origin" TEXT NOT NULL DEFAULT 'user',
    "sourceKind" TEXT,
    "completedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "todo_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "todo_items_spaceId_userId_archivedAt_status_position_idx" ON "todo_items"("spaceId", "userId", "archivedAt", "status", "position");
CREATE INDEX "todo_items_botId_idx" ON "todo_items"("botId");

ALTER TABLE "todo_items" ADD CONSTRAINT "todo_items_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "todo_items" ADD CONSTRAINT "todo_items_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "todo_items" ADD CONSTRAINT "todo_items_botId_fkey"
    FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Private to its person within their space.
ALTER TABLE "todo_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY todo_items_tenant ON "todo_items"
  USING (
    "spaceId" = NULLIF(current_setting('app.space_id', true), '')
    AND "userId" = NULLIF(current_setting('app.user_id', true), '')
  );
CREATE POLICY todo_items_system ON "todo_items"
  USING ((SELECT app_rls_bypass()));
