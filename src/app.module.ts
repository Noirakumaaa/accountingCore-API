import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { AccountsModule } from './accounts/accounts.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';
import { BillsModule } from './bills/bills.module.js';
import { ContactsModule } from './contacts/contacts.module.js';
import { JournalEntriesModule } from './journal-entries/journal-entries.module.js';
import { DevToolsModule } from './dev-tools/dev-tools.module.js';
import { AccountingSettingsModule } from './accounting-settings/accounting-settings.module.js';
import { ExpensesModule } from './expenses/expenses.module.js';
import { CheckVouchersModule } from './check-vouchers/check-vouchers.module.js';
import { BankAccountsModule } from './bank-accounts/bank-accounts.module.js';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'global', ttl: 60_000, limit: 120 },
        { name: 'auth', ttl: 60_000, limit: 10 },
      ],
    }),
    PrismaModule,
    AuthModule,
    DashboardModule,
    AccountsModule,
    InvoicesModule,
    BillsModule,
    ContactsModule,
    JournalEntriesModule,
    AccountingSettingsModule,
    ExpensesModule,
    CheckVouchersModule,
    BankAccountsModule,
    DevToolsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
