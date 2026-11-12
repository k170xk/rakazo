-- An app's staff brief and the AI review sent with it to Evolve's peer reviewers.
ALTER TABLE "pages" ADD COLUMN "brief" TEXT;
ALTER TABLE "pages" ADD COLUMN "dossier" TEXT;
ALTER TABLE "pages" ADD COLUMN "dossierVersion" INTEGER;
