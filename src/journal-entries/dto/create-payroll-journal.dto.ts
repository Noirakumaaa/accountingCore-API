import { Type } from 'class-transformer';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  IsNumber,
  Min,
  ValidateNested,
} from 'class-validator';

export class PayrollTotalsDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  grossPay: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sssEmployeeShare: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sssEmployerShare: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  philhealthEmployeeShare: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  philhealthEmployerShare: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pagibigEmployeeShare: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pagibigEmployerShare: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  withholdingTax: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  netPay: number;
}

export class PayrollAccountsDto {
  @IsUUID()
  salaryExpenseAccountId: string;

  @IsUUID()
  sssExpenseAccountId: string;

  @IsUUID()
  philhealthExpenseAccountId: string;

  @IsUUID()
  pagibigExpenseAccountId: string;

  @IsUUID()
  sssPayableAccountId: string;

  @IsUUID()
  philhealthPayableAccountId: string;

  @IsUUID()
  pagibigPayableAccountId: string;

  @IsUUID()
  withholdingTaxPayableAccountId: string;

  @IsUUID()
  cashAccountId: string;
}

export class CreatePayrollJournalDto {
  @IsDateString()
  date: string;

  @IsDateString()
  periodStart: string;

  @IsDateString()
  periodEnd: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @ValidateNested()
  @Type(() => PayrollTotalsDto)
  totals: PayrollTotalsDto;

  @ValidateNested()
  @Type(() => PayrollAccountsDto)
  accounts: PayrollAccountsDto;
}
