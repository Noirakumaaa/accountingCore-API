import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ExpenseStatus } from '@prisma/client';

export class CreateExpenseDto {
  @IsOptional()
  @IsString()
  expenseNumber?: string;

  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsDateString()
  date: string;

  @IsString()
  category: string;

  @IsString()
  description: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  taxAmount?: number;

  @IsString()
  accountId: string;

  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @IsOptional()
  @IsEnum(ExpenseStatus)
  status?: ExpenseStatus;
}
