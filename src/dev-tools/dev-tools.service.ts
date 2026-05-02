import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AccountType,
  ContactType,
  JournalStatus,
  Prisma,
} from '@prisma/client';
import type { AccessUser } from '../auth/types/auth-user.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type DevModelKey =
  | 'company-info'
  | 'accounts'
  | 'contacts'
  | 'invoices'
  | 'bills'
  | 'expenses'
  | 'check-vouchers'
  | 'payments'
  | 'journal-entries'
  | 'bank-accounts'
  | 'bank-transactions'
  | 'bank-reconciliations';

type DbClient = Prisma.TransactionClient | PrismaService;

const DEV_MODELS: Array<{
  key: DevModelKey;
  label: string;
  description: string;
  clearImpact: string;
}> = [
  {
    key: 'company-info',
    label: 'Company Info',
    description:
      'Singleton company profile used by accounting settings and document headers.',
    clearImpact: 'Clears the saved company profile back to blank values.',
  },
  {
    key: 'accounts',
    label: 'Accounts',
    description:
      'Chart of Accounts records, including revenue, expense, cash, and receivable accounts.',
    clearImpact:
      'Also clears dependent journal entries, bank accounts, expenses, vouchers, and line-item links.',
  },
  {
    key: 'contacts',
    label: 'Contacts',
    description:
      'Customers and vendors used by invoices, bills, expenses, and vouchers.',
    clearImpact:
      'Also clears invoices, bills, expenses, vouchers, and linked payments tied to those contacts.',
  },
  {
    key: 'invoices',
    label: 'Invoices',
    description: 'Sales invoices and their invoice line items.',
    clearImpact: 'Also clears invoice payments linked to those invoices.',
  },
  {
    key: 'bills',
    label: 'Bills',
    description: 'Vendor bills and their bill line items.',
    clearImpact:
      'Also clears bill payments and any vouchers linked to those bills.',
  },
  {
    key: 'expenses',
    label: 'Expenses',
    description: 'Direct expense records, with optional vendor and bank links.',
    clearImpact: 'Removes expense rows only.',
  },
  {
    key: 'check-vouchers',
    label: 'Check Vouchers',
    description: 'Payment voucher records linked to bills or vendors.',
    clearImpact: 'Removes check voucher rows only.',
  },
  {
    key: 'payments',
    label: 'Payments',
    description: 'Shared payment records used across receivables and payables.',
    clearImpact: 'Removes payment rows only.',
  },
  {
    key: 'journal-entries',
    label: 'Journal Entries',
    description: 'General journal entries and journal lines.',
    clearImpact:
      'Also unlinks invoices, bills, payments, expenses, and vouchers from their journal entries.',
  },
  {
    key: 'bank-accounts',
    label: 'Bank Accounts',
    description: 'Operational bank accounts mapped to the chart of accounts.',
    clearImpact:
      'Also clears bank transactions, reconciliations, vouchers, and bank links from payments and expenses.',
  },
  {
    key: 'bank-transactions',
    label: 'Bank Transactions',
    description: 'Imported or manually recorded bank movements.',
    clearImpact:
      'Also detaches those transactions from reconciliations before deletion.',
  },
  {
    key: 'bank-reconciliations',
    label: 'Bank Reconciliations',
    description: 'Statement reconciliation snapshots for bank accounts.',
    clearImpact: 'Also clears reconciliation links from bank transactions.',
  },
];

@Injectable()
export class DevToolsService {
  constructor(private readonly prisma: PrismaService) {}

  async findModels() {
    const counts = await Promise.all([
      this.prisma.companyInfo.count(),
      this.prisma.account.count(),
      this.prisma.contact.count(),
      this.prisma.invoice.count(),
      this.prisma.bill.count(),
      this.prisma.expense.count(),
      this.prisma.checkVoucher.count(),
      this.prisma.payment.count(),
      this.prisma.journalEntry.count(),
      this.prisma.bankAccount.count(),
      this.prisma.bankTransaction.count(),
      this.prisma.bankReconciliation.count(),
    ]);

    const countByKey = new Map<DevModelKey, number>([
      ['company-info', counts[0]],
      ['accounts', counts[1]],
      ['contacts', counts[2]],
      ['invoices', counts[3]],
      ['bills', counts[4]],
      ['expenses', counts[5]],
      ['check-vouchers', counts[6]],
      ['payments', counts[7]],
      ['journal-entries', counts[8]],
      ['bank-accounts', counts[9]],
      ['bank-transactions', counts[10]],
      ['bank-reconciliations', counts[11]],
    ]);

    return {
      models: DEV_MODELS.map((model) => ({
        ...model,
        count: countByKey.get(model.key) ?? 0,
      })),
    };
  }

  async seedModel(modelKey: DevModelKey, user: AccessUser) {
    this.assertValidModel(modelKey);

    switch (modelKey) {
      case 'company-info':
        await this.seedCompanyInfo();
        break;
      case 'accounts':
        await this.seedAccount();
        break;
      case 'contacts':
        await this.seedContact();
        break;
      case 'invoices':
        await this.seedInvoice(user.id);
        break;
      case 'bills':
        await this.seedBill(user.id);
        break;
      case 'expenses':
        await this.seedExpense(user.id);
        break;
      case 'check-vouchers':
        await this.seedCheckVoucher(user.id);
        break;
      case 'payments':
        await this.seedPayment(user.id);
        break;
      case 'journal-entries':
        await this.seedJournalEntry(user.id);
        break;
      case 'bank-accounts':
        await this.seedBankAccount();
        break;
      case 'bank-transactions':
        await this.seedBankTransaction();
        break;
      case 'bank-reconciliations':
        await this.seedBankReconciliation(user.id);
        break;
    }

    return { message: `Sample ${modelKey} data added successfully.` };
  }

  async clearModel(modelKey: DevModelKey) {
    this.assertValidModel(modelKey);

    await this.prisma.$transaction(async (tx) => {
      switch (modelKey) {
        case 'company-info':
          await tx.companyInfo.deleteMany();
          break;
        case 'accounts':
          await this.clearAccounts(tx);
          break;
        case 'contacts':
          await this.clearContacts(tx);
          break;
        case 'invoices':
          await this.clearInvoices(tx);
          break;
        case 'bills':
          await this.clearBills(tx);
          break;
        case 'expenses':
          await tx.expense.deleteMany();
          break;
        case 'check-vouchers':
          await tx.checkVoucher.deleteMany();
          break;
        case 'payments':
          await tx.payment.deleteMany();
          break;
        case 'journal-entries':
          await this.clearJournalEntries(tx);
          break;
        case 'bank-accounts':
          await this.clearBankAccounts(tx);
          break;
        case 'bank-transactions':
          await this.clearBankTransactions(tx);
          break;
        case 'bank-reconciliations':
          await this.clearBankReconciliations(tx);
          break;
      }
    });

    return { message: `${modelKey} data cleared successfully.` };
  }

  private assertValidModel(modelKey: string): asserts modelKey is DevModelKey {
    if (!DEV_MODELS.some((model) => model.key === modelKey)) {
      throw new BadRequestException('Unsupported development model.');
    }
  }

  private async seedCompanyInfo() {
    await this.prisma.companyInfo.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        companyName: 'Solverous Demo Accounting',
        companyAddress: '123 Sample Avenue',
        companyCountry: 'Philippines',
        companyCity: 'Makati',
        companyProvince: 'Metro Manila',
        companyZip: '1200',
        companyPhone: '+63 917 555 0101',
        companyEmail: 'accounting-demo@solverous.test',
        companyTin: '123-456-789-000',
      },
      update: {
        companyName: 'Solverous Demo Accounting',
        companyAddress: '123 Sample Avenue',
        companyCountry: 'Philippines',
        companyCity: 'Makati',
        companyProvince: 'Metro Manila',
        companyZip: '1200',
        companyPhone: '+63 917 555 0101',
        companyEmail: 'accounting-demo@solverous.test',
        companyTin: '123-456-789-000',
      },
    });
  }

  private async seedAccount() {
    const sequence = await this.prisma.account.count();
    const typeCycle: AccountType[] = [
      AccountType.ASSET,
      AccountType.LIABILITY,
      AccountType.EQUITY,
      AccountType.REVENUE,
      AccountType.EXPENSE,
    ];
    const type = typeCycle[sequence % typeCycle.length];
    const code = await this.getNextAccountCode(this.prisma, type);

    await this.prisma.account.create({
      data: {
        code,
        type,
        name: `Sample ${this.formatLabel(type)} ${sequence + 1}`,
        subtype: 'Development Sample',
        description: 'Generated from developer data tools.',
      },
    });
  }

  private async seedContact() {
    const sequence = await this.prisma.contact.count();
    const typeCycle: ContactType[] = [
      ContactType.CUSTOMER,
      ContactType.VENDOR,
      ContactType.BOTH,
    ];
    const type = typeCycle[sequence % typeCycle.length];

    await this.prisma.contact.create({
      data: {
        type,
        name: `Sample ${this.formatLabel(type)} ${sequence + 1}`,
        email: `sample-${sequence + 1}@solverous.test`,
        phone: `0917${String(1000000 + sequence).slice(-7)}`,
        taxId: `TAX-${String(sequence + 1).padStart(4, '0')}`,
      },
    });
  }

  private async seedInvoice(userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const customer = await this.ensureContact(tx, ContactType.CUSTOMER);
      const revenueAccount = await this.ensureRevenueAccount(tx);
      const count = await tx.invoice.count();
      const subtotal = 2500;
      const taxRate = 0;
      const amountPaid = 0;
      const total = subtotal;

      await tx.invoice.create({
        data: {
          invoiceNumber: `DEV-INV-${String(count + 1).padStart(4, '0')}`,
          customerId: customer.id,
          issueDate: new Date(),
          dueDate: this.addDays(15),
          status: 'SENT',
          subtotal,
          taxRate,
          taxAmount: 0,
          discount: 0,
          total,
          amountPaid,
          balanceDue: total - amountPaid,
          notes: 'Development sample invoice.',
          terms: 'Net 15',
          createdBy: userId,
          items: {
            create: [
              {
                description: 'Sample service engagement',
                quantity: 1,
                unitPrice: subtotal,
                amount: subtotal,
                accountId: revenueAccount.id,
              },
            ],
          },
        },
      });
    });
  }

  private async seedBill(userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const vendor = await this.ensureContact(tx, ContactType.VENDOR);
      const expenseAccount = await this.ensureExpenseAccount(tx);
      const count = await tx.bill.count();
      const subtotal = 1800;

      await tx.bill.create({
        data: {
          billNumber: `DEV-BILL-${String(count + 1).padStart(4, '0')}`,
          vendorId: vendor.id,
          issueDate: new Date(),
          dueDate: this.addDays(20),
          status: 'RECEIVED',
          category: 'Software',
          subtotal,
          taxAmount: 0,
          total: subtotal,
          amountPaid: 0,
          balanceDue: subtotal,
          notes: 'Development sample bill.',
          createdBy: userId,
          items: {
            create: [
              {
                description: 'Sample software subscription',
                quantity: 1,
                unitPrice: subtotal,
                amount: subtotal,
                accountId: expenseAccount.id,
              },
            ],
          },
        },
      });
    });
  }

  private async seedExpense(userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const vendor = await this.ensureContact(tx, ContactType.VENDOR);
      const expenseAccount = await this.ensureExpenseAccount(tx);
      const count = await tx.expense.count();

      await tx.expense.create({
        data: {
          expenseNumber: `DEV-EXP-${String(count + 1).padStart(4, '0')}`,
          vendorId: vendor.id,
          date: new Date(),
          category: 'Office Expense',
          description: 'Development sample expense.',
          amount: 950,
          taxAmount: 0,
          accountId: expenseAccount.id,
          status: 'PENDING',
          createdBy: userId,
        },
      });
    });
  }

  private async seedCheckVoucher(userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const vendor = await this.ensureContact(tx, ContactType.VENDOR);
      const bankAccount = await this.ensureBankAccount(tx);
      const count = await tx.checkVoucher.count();

      await tx.checkVoucher.create({
        data: {
          voucherNumber: `DEV-CV-${String(count + 1).padStart(4, '0')}`,
          vendorId: vendor.id,
          date: new Date(),
          bankAccountId: bankAccount.id,
          checkNumber: `CHK-${String(count + 1).padStart(5, '0')}`,
          payee: vendor.name,
          amount: 1200,
          purpose: 'Development sample voucher.',
          status: 'DRAFT',
          createdBy: userId,
        },
      });
    });
  }

  private async seedPayment(userId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { id: true, balanceDue: true },
    });
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    await this.prisma.payment.create({
      data: {
        invoiceId: invoice?.id,
        date: new Date(),
        amount: invoice ? Math.min(invoice.balanceDue, 500) : 500,
        method: bankAccount ? 'bank-transfer' : 'cash',
        reference: `DEV-PMT-${Date.now()}`,
        bankAccountId: bankAccount?.id,
        notes: 'Development sample payment.',
        createdBy: userId,
      },
    });
  }

  private async seedJournalEntry(userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const debitAccount = await this.ensureCashAccount(tx);
      const creditAccount = await this.ensureRevenueAccount(tx);
      const count = await tx.journalEntry.count();

      await tx.journalEntry.create({
        data: {
          entryNumber: `DEV-JE-${String(count + 1).padStart(4, '0')}`,
          date: new Date(),
          description: 'Development sample manual journal entry.',
          status: JournalStatus.POSTED,
          reference: `DEV-${count + 1}`,
          type: 'MANUAL',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          lines: {
            create: [
              {
                accountId: debitAccount.id,
                description: 'Sample debit line',
                debit: 1000,
                credit: 0,
              },
              {
                accountId: creditAccount.id,
                description: 'Sample credit line',
                debit: 0,
                credit: 1000,
              },
            ],
          },
        },
      });
    });
  }

  private async seedBankAccount() {
    await this.prisma.$transaction(async (tx) => {
      const cashAccount = await this.ensureCashAccount(tx);
      const count = await tx.bankAccount.count();

      await tx.bankAccount.create({
        data: {
          name: `Sample Bank Account ${count + 1}`,
          bankName: 'Solverous Bank',
          accountNumber: `0010${String(count + 1).padStart(6, '0')}`,
          accountId: cashAccount.id,
          currency: 'PHP',
          openingBalance: 10000,
        },
      });
    });
  }

  private async seedBankTransaction() {
    await this.prisma.$transaction(async (tx) => {
      const bankAccount = await this.ensureBankAccount(tx);
      const count = await tx.bankTransaction.count();

      await tx.bankTransaction.create({
        data: {
          bankAccountId: bankAccount.id,
          date: new Date(),
          description: `Development sample bank transaction ${count + 1}`,
          amount: count % 2 === 0 ? 2500 : -850,
          type: count % 2 === 0 ? 'DEPOSIT' : 'WITHDRAWAL',
          reference: `DEV-BTX-${count + 1}`,
        },
      });
    });
  }

  private async seedBankReconciliation(userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const bankAccount = await this.ensureBankAccount(tx);
      const count = await tx.bankReconciliation.count();

      await tx.bankReconciliation.create({
        data: {
          bankAccountId: bankAccount.id,
          statementDate: new Date(),
          statementBalance: 12000 + count * 100,
          bookBalance: 11850 + count * 100,
          adjustedBalance: 11850 + count * 100,
          status: 'IN_PROGRESS',
          createdBy: userId,
        },
      });
    });
  }

  private async clearContacts(tx: Prisma.TransactionClient) {
    await this.clearInvoices(tx);
    await this.clearBills(tx);
    await tx.checkVoucher.deleteMany();
    await tx.expense.deleteMany();
    await tx.contact.deleteMany();
  }

  private async clearInvoices(tx: Prisma.TransactionClient) {
    await tx.payment.deleteMany({ where: { invoiceId: { not: null } } });
    await tx.invoice.deleteMany();
  }

  private async clearBills(tx: Prisma.TransactionClient) {
    await tx.checkVoucher.deleteMany({ where: { billId: { not: null } } });
    await tx.payment.deleteMany({ where: { billId: { not: null } } });
    await tx.bill.deleteMany();
  }

  private async clearJournalEntries(tx: Prisma.TransactionClient) {
    await tx.invoice.updateMany({ data: { journalEntryId: null } });
    await tx.bill.updateMany({ data: { journalEntryId: null } });
    await tx.payment.updateMany({ data: { journalEntryId: null } });
    await tx.expense.updateMany({ data: { journalEntryId: null } });
    await tx.checkVoucher.updateMany({ data: { journalEntryId: null } });
    await tx.journalLine.deleteMany();
    await tx.journalEntry.deleteMany();
  }

  private async clearBankTransactions(tx: Prisma.TransactionClient) {
    await tx.bankTransaction.updateMany({ data: { reconciliationId: null } });
    await tx.bankTransaction.deleteMany();
  }

  private async clearBankReconciliations(tx: Prisma.TransactionClient) {
    await tx.bankTransaction.updateMany({ data: { reconciliationId: null } });
    await tx.bankReconciliation.deleteMany();
  }

  private async clearBankAccounts(tx: Prisma.TransactionClient) {
    await this.clearBankTransactions(tx);
    await this.clearBankReconciliations(tx);
    await tx.checkVoucher.deleteMany();
    await tx.payment.updateMany({ data: { bankAccountId: null } });
    await tx.expense.updateMany({ data: { bankAccountId: null } });
    await tx.bankAccount.deleteMany();
  }

  private async clearAccounts(tx: Prisma.TransactionClient) {
    await this.clearJournalEntries(tx);
    await this.clearBankAccounts(tx);
    await tx.expense.deleteMany();
    await tx.invoiceItem.updateMany({ data: { accountId: null } });
    await tx.billItem.updateMany({ data: { accountId: null } });
    await tx.account.deleteMany();
  }

  private async ensureContact(tx: DbClient, type: 'CUSTOMER' | 'VENDOR') {
    const existing = await tx.contact.findFirst({
      where: {
        isActive: true,
        OR: [{ type }, { type: ContactType.BOTH }],
      },
      orderBy: { createdAt: 'asc' },
    });

    if (existing) {
      return existing;
    }

    return tx.contact.create({
      data: {
        type,
        name:
          type === ContactType.CUSTOMER ? 'Sample Customer' : 'Sample Vendor',
        email:
          type === ContactType.CUSTOMER
            ? 'customer@solverous.test'
            : 'vendor@solverous.test',
        phone: '09171234567',
      },
    });
  }

  private async ensureRevenueAccount(tx: DbClient) {
    const existing = await tx.account.findFirst({
      where: { isActive: true, type: AccountType.REVENUE },
      orderBy: { code: 'asc' },
    });

    if (existing) {
      return existing;
    }

    return tx.account.create({
      data: {
        code: await this.getNextAccountCode(tx, AccountType.REVENUE),
        name: 'Sample Service Revenue',
        type: AccountType.REVENUE,
        subtype: 'Operating Revenue',
        description: 'Created automatically for development tools.',
      },
    });
  }

  private async ensureExpenseAccount(tx: DbClient) {
    const existing = await tx.account.findFirst({
      where: { isActive: true, type: AccountType.EXPENSE },
      orderBy: { code: 'asc' },
    });

    if (existing) {
      return existing;
    }

    return tx.account.create({
      data: {
        code: await this.getNextAccountCode(tx, AccountType.EXPENSE),
        name: 'Sample Office Expense',
        type: AccountType.EXPENSE,
        subtype: 'Operating Expenses',
        description: 'Created automatically for development tools.',
      },
    });
  }

  private async ensureCashAccount(tx: DbClient) {
    const existing = await tx.account.findFirst({
      where: { isActive: true, systemTag: 'CASH' },
    });

    if (existing) {
      return existing;
    }

    return tx.account.create({
      data: {
        code: await this.getNextAccountCode(tx, AccountType.ASSET),
        name: 'Cash in Bank',
        type: AccountType.ASSET,
        subtype: 'Cash & Bank',
        systemTag: 'CASH',
        description: 'Created automatically for development tools.',
      },
    });
  }

  private async ensureBankAccount(tx: DbClient) {
    const existing = await tx.bankAccount.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    if (existing) {
      return existing;
    }

    const cashAccount = await this.ensureCashAccount(tx);

    return tx.bankAccount.create({
      data: {
        name: 'Main Development Bank',
        bankName: 'Solverous Bank',
        accountNumber: '0010000001',
        accountId: cashAccount.id,
        currency: 'PHP',
        openingBalance: 10000,
      },
    });
  }

  private async getNextAccountCode(tx: DbClient, type: AccountType) {
    const starts: Record<AccountType, number> = {
      ASSET: 1000,
      LIABILITY: 2000,
      EQUITY: 3000,
      REVENUE: 4000,
      EXPENSE: 5000,
    };
    const start = starts[type];
    const existing = await tx.account.findMany({
      where: { type },
      select: { code: true },
    });
    const used = new Set(
      existing
        .map((account) => Number(account.code))
        .filter((code) => Number.isFinite(code)),
    );

    let next = start;
    while (used.has(next)) {
      next += 1;
    }

    return String(next);
  }

  private addDays(days: number) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date;
  }

  private formatLabel(value: string) {
    return value
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
}
