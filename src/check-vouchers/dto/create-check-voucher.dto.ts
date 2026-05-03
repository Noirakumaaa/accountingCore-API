import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { VoucherStatus } from '@prisma/client';

export class CreateCheckVoucherDto {
  @IsOptional()
  @IsString()
  voucherNumber?: string;

  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @IsString()
  billId?: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  checkNumber?: string;

  @IsString()
  bankAccountId: string;

  @IsString()
  payee: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsString()
  purpose: string;

  @IsOptional()
  @IsEnum(VoucherStatus)
  status?: VoucherStatus;
}
