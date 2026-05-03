import { PartialType } from '@nestjs/mapped-types';
import { CreateCheckVoucherDto } from './create-check-voucher.dto.js';

export class UpdateCheckVoucherDto extends PartialType(CreateCheckVoucherDto) {}
