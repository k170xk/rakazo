-- Include secondary agent chat threads (`chatBotId`) in the single-owner
-- check constraint on `threads`.
ALTER TABLE "threads" DROP CONSTRAINT IF EXISTS "threads_owner_chk";
ALTER TABLE "threads" ADD CONSTRAINT "threads_owner_chk" CHECK (
  num_nonnulls("botId", "chatBotId", "groupId", "externalConversationId") = 1
) NOT VALID;
ALTER TABLE "threads" VALIDATE CONSTRAINT "threads_owner_chk";
