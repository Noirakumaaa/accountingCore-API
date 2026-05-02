import { PartialType } from '@nestjs/swagger';
import { CreateInvoiceDto } from './create-invoice.dto.js';

export class UpdateInvoiceDto extends PartialType(CreateInvoiceDto) {}
