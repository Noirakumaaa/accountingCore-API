-- AlterTable
ALTER TABLE "CompanyInfo"
ADD COLUMN "accountingAccessTokenMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN "accountingRefreshTokenDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN "payrollSalaryExpenseAccountId" TEXT,
ADD COLUMN "payrollSssExpenseAccountId" TEXT,
ADD COLUMN "payrollPhilhealthExpenseAccountId" TEXT,
ADD COLUMN "payrollPagibigExpenseAccountId" TEXT,
ADD COLUMN "payrollSssPayableAccountId" TEXT,
ADD COLUMN "payrollPhilhealthPayableAccountId" TEXT,
ADD COLUMN "payrollPagibigPayableAccountId" TEXT,
ADD COLUMN "payrollWithholdingTaxPayableAccountId" TEXT,
ADD COLUMN "payrollCashAccountId" TEXT;
