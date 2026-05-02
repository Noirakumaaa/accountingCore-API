import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountType, JournalStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePayrollJournalDto } from './dto/create-payroll-journal.dto.js';

@Injectable()
export class JournalEntriesService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly accountSelect = {
    id: true,
    code: true,
    name: true,
    type: true,
    isActive: true,
  } as const;

  private async buildEntryNumber(tx: Prisma.TransactionClient) {
    const count = await tx.journalEntry.count();
    return `JE-${String(count + 1).padStart(5, '0')}`;
  }

  private async findAccountsReceivableAccount() {
    return this.prisma.account.findFirst({
      where: { isActive: true, systemTag: 'ACCOUNTS_RECEIVABLE' },
    });
  }

  private async findTaxLiabilityAccount() {
    return this.prisma.account.findFirst({
      where: { isActive: true, systemTag: 'TAX_LIABILITY' },
    });
  }

  private async findAccountsPayableAccount() {
    return this.prisma.account.findFirst({
      where: { isActive: true, systemTag: 'ACCOUNTS_PAYABLE' },
    });
  }

  private roundMoney(value: number) {
    return Number(value.toFixed(2));
  }

  private buildPayrollDescription(dto: CreatePayrollJournalDto) {
    if (dto.description?.trim()) {
      return dto.description.trim();
    }

    return `Payroll for ${dto.periodStart} to ${dto.periodEnd}`;
  }

  private async getActiveAccountsOrThrow(accountIds: string[]) {
    const uniqueIds = Array.from(new Set(accountIds));
    const accounts = await this.prisma.account.findMany({
      where: {
        id: { in: uniqueIds },
        isActive: true,
      },
      select: this.accountSelect,
    });

    if (accounts.length !== uniqueIds.length) {
      throw new BadRequestException(
        'One or more selected payroll journal accounts are missing or inactive. Please review the account mapping and try again.',
      );
    }

    return new Map(accounts.map((account) => [account.id, account]));
  }

  private ensureAccountType(
    account: {
      code: string;
      name: string;
      type: AccountType;
    },
    expected: AccountType,
    label: string,
  ) {
    if (account.type !== expected) {
      throw new BadRequestException(
        `${label} must use a ${expected.toLowerCase()} account. "${account.code} - ${account.name}" is currently set as ${account.type.toLowerCase()}.`,
      );
    }
  }

  async findAll() {
    const entries = await this.prisma.journalEntry.findMany({
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: {
        lines: {
          include: {
            account: {
              select: { id: true, code: true, name: true, type: true },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
    });

    return {
      entries: entries.map((entry) => {
        const debitTotal = entry.lines.reduce(
          (sum, line) => sum + Number(line.debit),
          0,
        );
        const creditTotal = entry.lines.reduce(
          (sum, line) => sum + Number(line.credit),
          0,
        );

        return {
          ...entry,
          debitTotal,
          creditTotal,
          lineCount: entry.lines.length,
        };
      }),
    };
  }

  async findOne(id: string) {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            account: {
              select: { id: true, code: true, name: true, type: true },
            },
          },
          orderBy: { id: 'asc' },
        },
        invoices: {
          select: {
            id: true,
            invoiceNumber: true,
            customer: { select: { name: true } },
          },
        },
      },
    });

    if (!entry) {
      throw new NotFoundException('Journal entry not found.');
    }

    const debitTotal = entry.lines.reduce(
      (sum, line) => sum + Number(line.debit),
      0,
    );
    const creditTotal = entry.lines.reduce(
      (sum, line) => sum + Number(line.credit),
      0,
    );

    return {
      ...entry,
      debitTotal,
      creditTotal,
      lineCount: entry.lines.length,
    };
  }

  async createPayrollJournal(dto: CreatePayrollJournalDto, userId: string) {
    const totals = {
      grossPay: this.roundMoney(Number(dto.totals.grossPay)),
      sssEmployeeShare: this.roundMoney(Number(dto.totals.sssEmployeeShare)),
      sssEmployerShare: this.roundMoney(Number(dto.totals.sssEmployerShare)),
      philhealthEmployeeShare: this.roundMoney(
        Number(dto.totals.philhealthEmployeeShare),
      ),
      philhealthEmployerShare: this.roundMoney(
        Number(dto.totals.philhealthEmployerShare),
      ),
      pagibigEmployeeShare: this.roundMoney(
        Number(dto.totals.pagibigEmployeeShare),
      ),
      pagibigEmployerShare: this.roundMoney(
        Number(dto.totals.pagibigEmployerShare),
      ),
      withholdingTax: this.roundMoney(Number(dto.totals.withholdingTax)),
      netPay: this.roundMoney(Number(dto.totals.netPay)),
    };

    const debitTotal = this.roundMoney(
      totals.grossPay +
        totals.sssEmployerShare +
        totals.philhealthEmployerShare +
        totals.pagibigEmployerShare,
    );

    const creditTotal = this.roundMoney(
      totals.sssEmployeeShare +
        totals.sssEmployerShare +
        totals.philhealthEmployeeShare +
        totals.philhealthEmployerShare +
        totals.pagibigEmployeeShare +
        totals.pagibigEmployerShare +
        totals.withholdingTax +
        totals.netPay,
    );

    if (debitTotal <= 0) {
      throw new BadRequestException(
        'Enter at least one payroll amount before posting the journal entry.',
      );
    }

    if (debitTotal !== creditTotal) {
      throw new BadRequestException(
        'Payroll totals are out of balance. Please check gross pay, employer shares, deductions, and net pay before posting.',
      );
    }

    const accounts = await this.getActiveAccountsOrThrow([
      dto.accounts.salaryExpenseAccountId,
      dto.accounts.sssExpenseAccountId,
      dto.accounts.philhealthExpenseAccountId,
      dto.accounts.pagibigExpenseAccountId,
      dto.accounts.sssPayableAccountId,
      dto.accounts.philhealthPayableAccountId,
      dto.accounts.pagibigPayableAccountId,
      dto.accounts.withholdingTaxPayableAccountId,
      dto.accounts.cashAccountId,
    ]);

    const salaryExpenseAccount = accounts.get(
      dto.accounts.salaryExpenseAccountId,
    );
    const sssExpenseAccount = accounts.get(dto.accounts.sssExpenseAccountId);
    const philhealthExpenseAccount = accounts.get(
      dto.accounts.philhealthExpenseAccountId,
    );
    const pagibigExpenseAccount = accounts.get(
      dto.accounts.pagibigExpenseAccountId,
    );
    const sssPayableAccount = accounts.get(dto.accounts.sssPayableAccountId);
    const philhealthPayableAccount = accounts.get(
      dto.accounts.philhealthPayableAccountId,
    );
    const pagibigPayableAccount = accounts.get(
      dto.accounts.pagibigPayableAccountId,
    );
    const withholdingTaxPayableAccount = accounts.get(
      dto.accounts.withholdingTaxPayableAccountId,
    );
    const cashAccount = accounts.get(dto.accounts.cashAccountId);

    if (
      !salaryExpenseAccount ||
      !sssExpenseAccount ||
      !philhealthExpenseAccount ||
      !pagibigExpenseAccount ||
      !sssPayableAccount ||
      !philhealthPayableAccount ||
      !pagibigPayableAccount ||
      !withholdingTaxPayableAccount ||
      !cashAccount
    ) {
      throw new BadRequestException(
        'Payroll account mapping is incomplete. Please select every required account and try again.',
      );
    }

    this.ensureAccountType(
      salaryExpenseAccount,
      AccountType.EXPENSE,
      'Gross pay',
    );
    this.ensureAccountType(
      sssExpenseAccount,
      AccountType.EXPENSE,
      'SSS employer share',
    );
    this.ensureAccountType(
      philhealthExpenseAccount,
      AccountType.EXPENSE,
      'PhilHealth employer share',
    );
    this.ensureAccountType(
      pagibigExpenseAccount,
      AccountType.EXPENSE,
      'Pag-IBIG employer share',
    );
    this.ensureAccountType(
      sssPayableAccount,
      AccountType.LIABILITY,
      'SSS payable',
    );
    this.ensureAccountType(
      philhealthPayableAccount,
      AccountType.LIABILITY,
      'PhilHealth payable',
    );
    this.ensureAccountType(
      pagibigPayableAccount,
      AccountType.LIABILITY,
      'Pag-IBIG payable',
    );
    this.ensureAccountType(
      withholdingTaxPayableAccount,
      AccountType.LIABILITY,
      'Withholding tax payable',
    );
    this.ensureAccountType(cashAccount, AccountType.ASSET, 'Cash / bank');

    const description = this.buildPayrollDescription(dto);
    const reference = dto.reference?.trim() || null;

    const lines = [
      {
        accountId: salaryExpenseAccount.id,
        description: `Gross pay for ${dto.periodStart} to ${dto.periodEnd}`,
        debit: totals.grossPay,
        credit: 0,
      },
      {
        accountId: sssExpenseAccount.id,
        description: `Employer SSS share for ${dto.periodStart} to ${dto.periodEnd}`,
        debit: totals.sssEmployerShare,
        credit: 0,
      },
      {
        accountId: philhealthExpenseAccount.id,
        description: `Employer PhilHealth share for ${dto.periodStart} to ${dto.periodEnd}`,
        debit: totals.philhealthEmployerShare,
        credit: 0,
      },
      {
        accountId: pagibigExpenseAccount.id,
        description: `Employer Pag-IBIG share for ${dto.periodStart} to ${dto.periodEnd}`,
        debit: totals.pagibigEmployerShare,
        credit: 0,
      },
      {
        accountId: sssPayableAccount.id,
        description: `SSS payable for ${dto.periodStart} to ${dto.periodEnd}`,
        debit: 0,
        credit: this.roundMoney(
          totals.sssEmployeeShare + totals.sssEmployerShare,
        ),
      },
      {
        accountId: philhealthPayableAccount.id,
        description: `PhilHealth payable for ${dto.periodStart} to ${dto.periodEnd}`,
        debit: 0,
        credit: this.roundMoney(
          totals.philhealthEmployeeShare + totals.philhealthEmployerShare,
        ),
      },
      {
        accountId: pagibigPayableAccount.id,
        description: `Pag-IBIG payable for ${dto.periodStart} to ${dto.periodEnd}`,
        debit: 0,
        credit: this.roundMoney(
          totals.pagibigEmployeeShare + totals.pagibigEmployerShare,
        ),
      },
      {
        accountId: withholdingTaxPayableAccount.id,
        description: `Withholding tax payable for ${dto.periodStart} to ${dto.periodEnd}`,
        debit: 0,
        credit: totals.withholdingTax,
      },
      {
        accountId: cashAccount.id,
        description: `Net payroll paid for ${dto.periodStart} to ${dto.periodEnd}`,
        debit: 0,
        credit: totals.netPay,
      },
    ].filter((line) => line.debit > 0 || line.credit > 0);

    const journalEntry = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.create({
        data: {
          entryNumber: await this.buildEntryNumber(tx),
          date: new Date(dto.date),
          description,
          status: JournalStatus.POSTED,
          reference,
          type: 'PAYROLL',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          lines: {
            create: lines,
          },
        },
      });

      return entry;
    });

    return this.findOne(journalEntry.id);
  }

  async postInvoice(invoiceId: string, userId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        customer: { select: { id: true, name: true } },
        items: true,
        journalEntry: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found.');
    }

    if (invoice.status === 'DRAFT') {
      throw new BadRequestException(
        'Draft invoices cannot be posted yet. Change the invoice status first.',
      );
    }

    if (invoice.journalEntryId) {
      return this.findOne(invoice.journalEntryId);
    }

    const arAccount = await this.findAccountsReceivableAccount();
    if (!arAccount) {
      throw new BadRequestException(
        'No Accounts Receivable account is set. Go to Chart of Accounts, open an Asset account, and tick "Accounts Receivable".',
      );
    }

    const taxAccount =
      invoice.taxAmount > 0 ? await this.findTaxLiabilityAccount() : null;

    if (invoice.taxAmount > 0 && !taxAccount) {
      throw new BadRequestException(
        'No Tax Liability account is set. Go to Chart of Accounts, open a Liability account, and tick "Tax Liability".',
      );
    }

    const revenueBuckets = new Map<
      string,
      { accountId: string; description: string; credit: number }
    >();

    for (const item of invoice.items) {
      if (!item.accountId) {
        throw new BadRequestException(
          'Every invoice line must have a revenue account before posting to the journal.',
        );
      }

      const accountId = item.accountId;
      const existing = revenueBuckets.get(accountId);

      if (existing) {
        existing.credit += Number(item.amount);
      } else {
        revenueBuckets.set(accountId, {
          accountId,
          description: item.description,
          credit: Number(item.amount),
        });
      }
    }

    const journalEntry = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.create({
        data: {
          entryNumber: await this.buildEntryNumber(tx),
          date: invoice.issueDate,
          description: `Invoice ${invoice.invoiceNumber} - ${invoice.customer.name}`,
          status: JournalStatus.POSTED,
          reference: invoice.invoiceNumber,
          type: 'INVOICE',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          lines: {
            create: [
              {
                accountId: arAccount.id,
                description: `Accounts Receivable - ${invoice.customer.name}`,
                debit: Number(invoice.total),
                credit: 0,
              },
              ...Array.from(revenueBuckets.values()).map((bucket) => ({
                accountId: bucket.accountId,
                description: bucket.description,
                debit: 0,
                credit: Number(bucket.credit.toFixed(2)),
              })),
              ...(invoice.taxAmount > 0 && taxAccount
                ? [
                    {
                      accountId: taxAccount.id,
                      description: `Output tax - ${invoice.invoiceNumber}`,
                      debit: 0,
                      credit: Number(invoice.taxAmount.toFixed(2)),
                    },
                  ]
                : []),
            ],
          },
        },
      });

      await tx.invoice.update({
        where: { id: invoice.id },
        data: { journalEntryId: entry.id },
      });

      return entry;
    });

    return this.findOne(journalEntry.id);
  }

  async remove(id: string) {
    const entry = await this.prisma.journalEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Journal entry not found.');
    return this.prisma.journalEntry.delete({ where: { id } });
  }

  async postBill(billId: string, userId: string) {
    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: {
        vendor: { select: { id: true, name: true } },
        items: true,
        journalEntry: true,
      },
    });

    if (!bill) {
      throw new NotFoundException('Bill not found.');
    }

    if (bill.status === 'DRAFT') {
      throw new BadRequestException(
        'Draft bills cannot be posted yet. Change the bill status to Received first.',
      );
    }

    if (bill.journalEntryId) {
      return this.findOne(bill.journalEntryId);
    }

    const apAccount = await this.findAccountsPayableAccount();
    if (!apAccount) {
      throw new BadRequestException(
        'No Accounts Payable account is set. Go to Chart of Accounts, open a Liability account, and tick "Accounts Payable".',
      );
    }

    const taxAccount =
      bill.taxAmount > 0 ? await this.findTaxLiabilityAccount() : null;

    if (bill.taxAmount > 0 && !taxAccount) {
      throw new BadRequestException(
        'No Tax Liability account is set. Go to Chart of Accounts, open a Liability account, and tick "Tax Liability".',
      );
    }

    // Group items by expense account
    const expenseBuckets = new Map<
      string,
      { accountId: string; description: string; debit: number }
    >();

    for (const item of bill.items) {
      if (!item.accountId) {
        throw new BadRequestException(
          'Every bill line must have an expense account before posting to the journal.',
        );
      }

      const accountId = item.accountId;
      const existing = expenseBuckets.get(accountId);

      if (existing) {
        existing.debit += Number(item.amount);
      } else {
        expenseBuckets.set(accountId, {
          accountId,
          description: item.description,
          debit: Number(item.amount),
        });
      }
    }

    const journalEntry = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.create({
        data: {
          entryNumber: await this.buildEntryNumber(tx),
          date: bill.issueDate,
          description: `Bill ${bill.billNumber} - ${bill.vendor.name}`,
          status: JournalStatus.POSTED,
          reference: bill.billNumber,
          type: 'BILL',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          lines: {
            create: [
              // DR each expense account
              ...Array.from(expenseBuckets.values()).map((bucket) => ({
                accountId: bucket.accountId,
                description: bucket.description,
                debit: Number(bucket.debit.toFixed(2)),
                credit: 0,
              })),
              // DR Tax Liability (input tax reduces the net liability)
              ...(bill.taxAmount > 0 && taxAccount
                ? [
                    {
                      accountId: taxAccount.id,
                      description: `Input tax - ${bill.billNumber}`,
                      debit: Number(bill.taxAmount.toFixed(2)),
                      credit: 0,
                    },
                  ]
                : []),
              // CR Accounts Payable (total obligation to vendor)
              {
                accountId: apAccount.id,
                description: `Accounts Payable - ${bill.vendor.name}`,
                debit: 0,
                credit: Number(bill.total),
              },
            ],
          },
        },
      });

      await tx.bill.update({
        where: { id: bill.id },
        data: { journalEntryId: entry.id },
      });

      return entry;
    });

    return this.findOne(journalEntry.id);
  }
}
