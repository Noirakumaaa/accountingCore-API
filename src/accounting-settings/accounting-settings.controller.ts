import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { UpdateAccountingSettingsDto } from './dto/update-accounting-settings.dto.js';
import { AccountingSettingsService } from './accounting-settings.service.js';

@Controller('accounting-settings')
@UseGuards(JwtAuthGuard)
export class AccountingSettingsController {
  constructor(
    private readonly accountingSettingsService: AccountingSettingsService,
  ) {}

  @Get()
  findOne() {
    return this.accountingSettingsService.findOne();
  }

  @Patch()
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin')
  update(@Body() dto: UpdateAccountingSettingsDto) {
    return this.accountingSettingsService.update(dto);
  }
}
