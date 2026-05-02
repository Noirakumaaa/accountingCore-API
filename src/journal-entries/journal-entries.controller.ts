import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AccessUser } from '../auth/types/auth-user.js';
import { JournalEntriesService } from './journal-entries.service.js';
import { CreatePayrollJournalDto } from './dto/create-payroll-journal.dto.js';

@Controller('journal-entries')
@UseGuards(JwtAuthGuard)
export class JournalEntriesController {
  constructor(private readonly journalEntriesService: JournalEntriesService) {}

  @Get()
  findAll() {
    return this.journalEntriesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.journalEntriesService.findOne(id);
  }

  @Post('from-invoice/:invoiceId')
  postInvoice(
    @Param('invoiceId') invoiceId: string,
    @CurrentUser() user: AccessUser,
  ) {
    return this.journalEntriesService.postInvoice(invoiceId, user.id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin')
  remove(@Param('id') id: string) {
    return this.journalEntriesService.remove(id);
  }

  @Post('from-bill/:billId')
  postBill(@Param('billId') billId: string, @CurrentUser() user: AccessUser) {
    return this.journalEntriesService.postBill(billId, user.id);
  }

  @Post('payroll')
  createPayrollJournal(
    @Body() dto: CreatePayrollJournalDto,
    @CurrentUser() user: AccessUser,
  ) {
    return this.journalEntriesService.createPayrollJournal(dto, user.id);
  }
}
