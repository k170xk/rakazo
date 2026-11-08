-- The admin whose voice connection every member without their own uses.
ALTER TABLE "deployment_settings" ADD COLUMN "companyVoiceUserId" TEXT;

-- Credentials an admin saved for every member's assistants; only the server reads them.
CREATE TABLE "company_vault_credentials" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "origin" TEXT NOT NULL,
    "auth" JSONB NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_vault_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_vault_credentials_name_key" ON "company_vault_credentials"("name");

ALTER TABLE "company_vault_credentials" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_vault_credentials_system ON "company_vault_credentials"
  USING ((SELECT app_rls_bypass()));
