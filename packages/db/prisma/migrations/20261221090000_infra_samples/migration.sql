-- One reading a minute of server, runner and Incus load for the admin dashboards. Company-wide,
-- with no tenant columns, so it is read only through admin endpoints and has no row security.
CREATE TABLE "infra_samples" (
    "id" BIGSERIAL NOT NULL,
    "sampledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB NOT NULL,

    CONSTRAINT "infra_samples_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "infra_samples_sampledAt_idx" ON "infra_samples"("sampledAt");
