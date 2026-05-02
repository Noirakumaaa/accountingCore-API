-- AlterTable: add taxRate to Invoice (IF NOT EXISTS guards against re-run on existing DBs)
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "taxRate" INTEGER NOT NULL DEFAULT 0;
