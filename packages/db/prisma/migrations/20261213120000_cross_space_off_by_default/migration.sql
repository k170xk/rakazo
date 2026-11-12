-- New bots talk only within their own Space until the owner turns this on; existing bots keep their setting.
ALTER TABLE "bots" ALTER COLUMN "crossSpaceCommunication" SET DEFAULT false;
