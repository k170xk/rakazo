-- Extra to-do lists. Items with no list stay on the day-to-day Personal list.
CREATE TABLE "todo_lists" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "todo_lists_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "todo_lists_spaceId_userId_idx" ON "todo_lists"("spaceId", "userId");

ALTER TABLE "todo_lists" ADD CONSTRAINT "todo_lists_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "todo_lists" ADD CONSTRAINT "todo_lists_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "todo_items" ADD COLUMN "listId" TEXT;
CREATE INDEX "todo_items_spaceId_userId_listId_idx" ON "todo_items"("spaceId", "userId", "listId");
ALTER TABLE "todo_items" ADD CONSTRAINT "todo_items_listId_fkey"
    FOREIGN KEY ("listId") REFERENCES "todo_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "todo_lists" ENABLE ROW LEVEL SECURITY;
CREATE POLICY todo_lists_tenant ON "todo_lists"
  USING (
    "spaceId" = NULLIF(current_setting('app.space_id', true), '')
    AND "userId" = NULLIF(current_setting('app.user_id', true), '')
  );
CREATE POLICY todo_lists_system ON "todo_lists"
  USING ((SELECT app_rls_bypass()));
