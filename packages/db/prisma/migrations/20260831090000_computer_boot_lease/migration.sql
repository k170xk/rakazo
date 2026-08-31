-- Own the booting/suspending transition so a dead API/worker cannot leave the row stuck.
ALTER TABLE "computers" ADD COLUMN "bootLeaseId" TEXT;
ALTER TABLE "computers" ADD COLUMN "bootLeaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "computers_bootLeaseExpiresAt_idx" ON "computers"("bootLeaseExpiresAt");

-- Leftover mid-cycle rows from process death become reclaimable immediately.
UPDATE "computers"
SET
    "bootLeaseId" = NULL,
    "bootLeaseExpiresAt" = NULL,
    "state" = CASE
        WHEN "providerRef" IS NOT NULL THEN 'suspended'
        ELSE 'error'
    END
WHERE "state" IN ('booting', 'suspending');
