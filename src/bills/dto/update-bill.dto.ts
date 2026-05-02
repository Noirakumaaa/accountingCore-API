import { PartialType } from '@nestjs/swagger';
import { CreateBillDto } from './create-bill.dto.js';

export class UpdateBillDto extends PartialType(CreateBillDto) {}
