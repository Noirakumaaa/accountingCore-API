-- CreateEnum
CREATE TYPE "SystemTag" AS ENUM (
    'ACCOUNTS_RECEIVABLE',
    'ACCOUNTS_PAYABLE',
    'CASH',
    'DEFAULT_REVENUE',
    'TAX_LIABILITY'
);

-- AlterTable
ALTER TABLE "Account" ADD COLUMN "systemTag" "SystemTag";

-- CreateIndex
CREATE UNIQUE INDEX "Account_systemTag_key" ON "Account"("systemTag");
