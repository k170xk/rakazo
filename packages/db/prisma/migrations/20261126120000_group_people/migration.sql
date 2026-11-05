-- Colleagues in a group chat, and work emails added before that colleague signed in.
CREATE TABLE "chat_group_people" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_group_people_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_group_invites" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_group_invites_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "messages" ADD COLUMN "authorUserId" TEXT;

CREATE UNIQUE INDEX "chat_group_people_groupId_userId_key" ON "chat_group_people"("groupId", "userId");
CREATE INDEX "chat_group_people_userId_idx" ON "chat_group_people"("userId");
CREATE UNIQUE INDEX "chat_group_invites_groupId_email_key" ON "chat_group_invites"("groupId", "email");
CREATE INDEX "chat_group_invites_email_idx" ON "chat_group_invites"("email");

ALTER TABLE "chat_group_people" ADD CONSTRAINT "chat_group_people_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "chat_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_group_people" ADD CONSTRAINT "chat_group_people_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_group_invites" ADD CONSTRAINT "chat_group_invites_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "chat_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
