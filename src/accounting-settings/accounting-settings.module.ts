import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AccountingSettingsController } from './accounting-settings.controller.js';
import { AccountingSettingsService } from './accounting-settings.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [AccountingSettingsController],
  providers: [AccountingSettingsService],
  exports: [AccountingSettingsService],
})
export class AccountingSettingsModule {}
