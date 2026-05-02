import {
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
} from 'class-validator';
import { AccountType, SystemTag } from '@prisma/client';

export class CreateAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsEnum(AccountType)
  type: AccountType;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  subtype?: string;

  @IsOptional()
  @IsEnum(SystemTag)
  systemTag?: SystemTag;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}
