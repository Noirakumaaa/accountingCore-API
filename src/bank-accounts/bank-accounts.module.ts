import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BankAccountsController } from './bank-accounts.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [BankAccountsController],
})
export class BankAccountsModule {}
