import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class UpdateAccountingSettingsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(240)
  accountingAccessTokenMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  accountingRefreshTokenDays?: number;

  @IsOptional()
  @IsUUID()
  payrollSalaryExpenseAccountId?: string | null;

  @IsOptional()
  @IsUUID()
  payrollSssExpenseAccountId?: string | null;

  @IsOptional()
  @IsUUID()
  payrollPhilhealthExpenseAccountId?: string | null;

  @IsOptional()
  @IsUUID()
  payrollPagibigExpenseAccountId?: string | null;

  @IsOptional()
  @IsUUID()
  payrollSssPayableAccountId?: string | null;

  @IsOptional()
  @IsUUID()
  payrollPhilhealthPayableAccountId?: string | null;

  @IsOptional()
  @IsUUID()
  payrollPagibigPayableAccountId?: string | null;

  @IsOptional()
  @IsUUID()
  payrollWithholdingTaxPayableAccountId?: string | null;

  @IsOptional()
  @IsUUID()
  payrollCashAccountId?: string | null;
}
