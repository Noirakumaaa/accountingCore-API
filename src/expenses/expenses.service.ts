import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExpenseStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateExpenseDto } from './dto/create-expense.dto.js';
import { UpdateExpenseDto } from './dto/update-expense.dto.js';

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  private roundMoney(value: number) {
    return Number(value.toFixed(2));
  }

  private async findExpenseCashAccountId(bankAccountId?: string | null) {
    if (bankAccountId) {
      const bankAccount = await this.prisma.bankAccount.findUnique({
        where: { id: bankAccountId },
        select: {
          id: true,
          name: true,
          accountId: true,
          isActive: true,
          account: {
            select: {
              id: true,
              type: true,
              isActive: true,
            },
          },
        },
      });

      if (
        !bankAccount ||
        !bankAccount.isActive ||
        !bankAccount.account.isActive
      ) {
        throw new NotFoundException('Bank account not found.');
      }

      if (bankAccount.account.type !== 'ASSET') {
        throw new BadRequestException(
          `The selected bank account "${bankAccount.name}" must be linked to an asset account before posting this expense.`,
        );
      }

      return bankAccount.accountId;
    }

    const cashAccount = await this.prisma.account.findFirst({
      where: {
        isActive: true,
        systemTag: 'CASH',
      },
      select: { id: true },
    });

    if (!cashAccount) {
      throw new BadRequestException(
        'No default cash account is configured. Tag one asset account as Cash or choose a bank account before posting this expense.',
      );
    }

    return cashAccount.id;
  }

  private async buildExpenseNumber() {
    const count = await this.prisma.expense.count();
    return `EXP-${String(count + 1).padStart(5, '0')}`;
  }

  async create(dto: CreateExpenseDto, userId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: dto.accountId },
      select: { id: true },
    });
    if (!account) throw new NotFoundException('Expense account not found.');

    if (dto.vendorId) {
      const vendor = await this.prisma.contact.findUnique({
        where: { id: dto.vendorId },
        select: { id: true, isActive: true },
      });
      if (!vendor || !vendor.isActive)
        throw new NotFoundException('Vendor not found.');
    }

    if (dto.bankAccountId) {
      const bank = await this.prisma.bankAccount.findUnique({
        where: { id: dto.bankAccountId },
        select: { id: true },
      });
      if (!bank) throw new NotFoundException('Bank account not found.');
    }

    const taxAmount = dto.taxAmount ?? 0;

    return this.prisma.expense.create({
      data: {
        expenseNumber: dto.expenseNumber ?? (await this.buildExpenseNumber()),
        vendorId: dto.vendorId ?? null,
        date: new Date(dto.date),
        category: dto.category.trim(),
        description: dto.description.trim(),
        amount: dto.amount,
        taxAmount,
        accountId: dto.accountId,
        bankAccountId: dto.bankAccountId ?? null,
        status:
          dto.status && dto.status !== ExpenseStatus.POSTED
            ? dto.status
            : ExpenseStatus.PENDING,
        createdBy: userId,
      },
      include: {
        vendor: { select: { id: true, name: true } },
        account: { select: { id: true, name: true, code: true } },
        bankAccount: { select: { id: true, name: true } },
      },
    });
  }

  async findAll() {
    const expenses = await this.prisma.expense.findMany({
      orderBy: { date: 'desc' },
      include: {
        vendor: { select: { id: true, name: true } },
        account: { select: { id: true, name: true, code: true } },
      },
    });

    const total = expenses.reduce((sum, e) => sum + e.amount + e.taxAmount, 0);
    const pending = expenses
      .filter((e) => e.status === ExpenseStatus.PENDING)
      .reduce((sum, e) => sum + e.amount + e.taxAmount, 0);
    const approved = expenses
      .filter((e) => e.status === ExpenseStatus.APPROVED)
      .reduce((sum, e) => sum + e.amount + e.taxAmount, 0);

    return { expenses, summary: { total, pending, approved } };
  }

  async findOne(id: string) {
    const expense = await this.prisma.expense.findUnique({
      where: { id },
      include: {
        vendor: { select: { id: true, name: true } },
        account: { select: { id: true, name: true, code: true } },
        bankAccount: { select: { id: true, name: true } },
      },
    });
    if (!expense) throw new NotFoundException('Expense not found.');
    return expense;
  }

  async update(id: string, dto: UpdateExpenseDto) {
    const existing = await this.findOne(id);

    if (existing.journalEntryId) {
      throw new BadRequestException(
        'Posted expenses can no longer be edited. Reverse the accounting entry and recreate the expense if something needs to change.',
      );
    }

    if (dto.accountId) {
      const account = await this.prisma.account.findUnique({
        where: { id: dto.accountId },
        select: { id: true },
      });
      if (!account) throw new NotFoundException('Expense account not found.');
    }

    if (dto.vendorId) {
      const vendor = await this.prisma.contact.findUnique({
        where: { id: dto.vendorId },
        select: { id: true, isActive: true },
      });
      if (!vendor || !vendor.isActive)
        throw new NotFoundException('Vendor not found.');
    }

    return this.prisma.expense.update({
      where: { id },
      data: {
        vendorId: dto.vendorId,
        date: dto.date ? new Date(dto.date) : undefined,
        category: dto.category?.trim(),
        description: dto.description?.trim(),
        amount: dto.amount,
        taxAmount: dto.taxAmount,
        accountId: dto.accountId,
        bankAccountId: dto.bankAccountId,
        status: dto.status,
      },
      include: {
        vendor: { select: { id: true, name: true } },
        account: { select: { id: true, name: true, code: true } },
        bankAccount: { select: { id: true, name: true } },
      },
    });
  }

  async approve(id: string, userId: string) {
    const expense = await this.findOne(id);
    if (expense.status !== ExpenseStatus.PENDING) {
      throw new BadRequestException('Only pending expenses can be approved.');
    }
    return this.prisma.expense.update({
      where: { id },
      data: { status: ExpenseStatus.APPROVED, approvedBy: userId },
    });
  }

  async post(id: string, userId: string) {
    const expense = await this.findOne(id);

    if (expense.status !== ExpenseStatus.APPROVED) {
      throw new BadRequestException('Only approved expenses can be posted.');
    }

    if (expense.journalEntryId) {
      throw new BadRequestException('This expense has already been posted.');
    }

    const cashAccountId = await this.findExpenseCashAccountId(
      expense.bankAccountId,
    );

    const total = this.roundMoney(expense.amount + expense.taxAmount);

    return this.prisma.$transaction(async (tx) => {
      const count = await tx.journalEntry.count();
      const lines = [
        {
          accountId: expense.accountId,
          description: expense.description,
          debit: this.roundMoney(expense.amount),
          credit: 0,
        },
      ];

      if (expense.taxAmount > 0) {
        const taxAccount = await tx.account.findFirst({
          where: { isActive: true, systemTag: 'TAX_LIABILITY' },
          select: { id: true },
        });

        if (!taxAccount) {
          throw new BadRequestException(
            'No tax account is configured. Tag one liability account as Tax Liability before posting expenses with tax.',
          );
        }

        lines.push({
          accountId: taxAccount.id,
          description: `Tax component - ${expense.expenseNumber}`,
          debit: this.roundMoney(expense.taxAmount),
          credit: 0,
        });
      }

      lines.push({
        accountId: cashAccountId,
        description: `Cash paid for ${expense.expenseNumber}`,
        debit: 0,
        credit: total,
      });

      const journalEntry = await tx.journalEntry.create({
        data: {
          entryNumber: `JE-${String(count + 1).padStart(5, '0')}`,
          date: expense.date,
          description: `Expense ${expense.expenseNumber} - ${expense.description}`,
          status: 'POSTED',
          reference: expense.expenseNumber,
          type: 'EXPENSE',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          lines: {
            create: lines,
          },
        },
      });

      return tx.expense.update({
        where: { id: expense.id },
        data: {
          status: ExpenseStatus.POSTED,
          journalEntryId: journalEntry.id,
        },
        include: {
          vendor: { select: { id: true, name: true } },
          account: { select: { id: true, name: true, code: true } },
          bankAccount: { select: { id: true, name: true } },
        },
      });
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.expense.delete({ where: { id } });
  }
}
