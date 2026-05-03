import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BillStatus, Prisma } from '@prisma/client';
import {
  CreateBillDto,
  type CreateBillItemDto,
} from './dto/create-bill.dto.js';
import { CreateBillPaymentDto } from './dto/create-bill-payment.dto.js';
import { UpdateBillDto } from './dto/update-bill.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class BillsService {
  constructor(private readonly prisma: PrismaService) {}

  private roundMoney(value: number) {
    return Number(value.toFixed(2));
  }

  private async findCashAccountId(bankAccountId?: string | null) {
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
          `The selected bank account "${bankAccount.name}" must be linked to an asset account before you can record vendor disbursements.`,
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
        'No default cash account is configured. Tag one asset account as Cash or choose a bank account before recording this disbursement.',
      );
    }

    return cashAccount.id;
  }

  private resolveBillStatus(
    balanceDue: number,
    dueDate: Date,
    currentStatus?: BillStatus,
  ) {
    if (currentStatus === BillStatus.CANCELLED) {
      return BillStatus.CANCELLED;
    }

    if (balanceDue <= 0) {
      return BillStatus.PAID;
    }

    if (currentStatus === BillStatus.DRAFT) {
      return BillStatus.DRAFT;
    }

    if (currentStatus === BillStatus.PARTIAL) {
      return BillStatus.PARTIAL;
    }

    if (new Date(dueDate).getTime() < Date.now()) {
      return BillStatus.OVERDUE;
    }

    return BillStatus.RECEIVED;
  }

  private ensurePostedBillEditable(
    existing: {
      journalEntryId: string | null;
      payments: { id: string }[];
    },
    dto: UpdateBillDto,
  ) {
    if (!existing.journalEntryId) {
      return;
    }

    const financialFieldsTouched =
      dto.vendorId !== undefined ||
      dto.issueDate !== undefined ||
      dto.dueDate !== undefined ||
      dto.taxAmount !== undefined ||
      dto.items !== undefined ||
      dto.category !== undefined;

    if (financialFieldsTouched) {
      throw new BadRequestException(
        'Posted bills can no longer change vendor, dates, category, line items, or totals. Void and recreate the bill if the accounting needs to change.',
      );
    }

    if (existing.payments.length > 0 && dto.status === BillStatus.CANCELLED) {
      throw new BadRequestException(
        'Bills with recorded disbursements cannot be cancelled directly. Reverse the payments first.',
      );
    }
  }

  private normalizeItems(items: CreateBillItemDto[]) {
    if (!items.length) {
      throw new BadRequestException('Add at least one bill item.');
    }

    return items.map((item) => ({
      description: item.description.trim(),
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: Number((item.quantity * item.unitPrice).toFixed(2)),
      accountId: item.accountId ?? null,
    }));
  }

  private calculateTotals(
    items: CreateBillItemDto[],
    taxAmount = 0,
    amountPaid = 0,
  ) {
    const normalizedItems = this.normalizeItems(items);
    const subtotal = Number(
      normalizedItems.reduce((sum, item) => sum + item.amount, 0).toFixed(2),
    );
    const total = Number((subtotal + taxAmount).toFixed(2));
    const balanceDue = Number(Math.max(total - amountPaid, 0).toFixed(2));

    return { normalizedItems, subtotal, total, balanceDue };
  }

  private async buildBillNumber() {
    const count = await this.prisma.bill.count();
    return `BILL-${String(count + 1).padStart(5, '0')}`;
  }

  async create(dto: CreateBillDto, userId: string) {
    const vendor = await this.prisma.contact.findUnique({
      where: { id: dto.vendorId },
      select: { id: true, name: true, type: true, isActive: true },
    });

    if (!vendor || !vendor.isActive) {
      throw new NotFoundException('Vendor not found.');
    }

    const taxAmount = dto.taxAmount ?? 0;
    const amountPaid = dto.amountPaid ?? 0;

    if (amountPaid > 0) {
      throw new BadRequestException(
        'Create the bill first, then record vendor payments separately so Accounts Payable and cash stay in sync.',
      );
    }

    if (
      dto.status &&
      dto.status !== BillStatus.DRAFT &&
      dto.status !== BillStatus.RECEIVED
    ) {
      throw new BadRequestException(
        'New bills can only start as Draft or Received. Partial and paid states must come from posted vendor disbursements.',
      );
    }

    const { normalizedItems, subtotal, total, balanceDue } =
      this.calculateTotals(dto.items, taxAmount, amountPaid);

    return this.prisma.bill.create({
      data: {
        billNumber: dto.billNumber ?? (await this.buildBillNumber()),
        vendorId: dto.vendorId,
        issueDate: new Date(dto.issueDate),
        dueDate: new Date(dto.dueDate),
        status:
          dto.status ??
          this.resolveBillStatus(balanceDue, new Date(dto.dueDate)),
        category: dto.category ?? null,
        subtotal,
        taxAmount,
        total,
        amountPaid,
        balanceDue,
        notes: dto.notes ?? null,
        createdBy: userId,
        items: {
          create: normalizedItems,
        },
      },
      include: {
        vendor: { select: { id: true, name: true } },
        items: true,
        payments: {
          orderBy: { date: 'desc' },
          select: {
            id: true,
            date: true,
            amount: true,
            method: true,
            reference: true,
            bankAccountId: true,
            notes: true,
            journalEntryId: true,
          },
        },
      },
    });
  }

  async findAll() {
    const bills = await this.prisma.bill.findMany({
      orderBy: { issueDate: 'desc' },
      include: {
        vendor: { select: { id: true, name: true } },
      },
    });

    return { bills };
  }

  async findOne(id: string) {
    const bill = await this.prisma.bill.findUnique({
      where: { id },
      include: {
        vendor: { select: { id: true, name: true } },
        items: true,
        payments: {
          orderBy: { date: 'desc' },
          select: {
            id: true,
            date: true,
            amount: true,
            method: true,
            reference: true,
            bankAccountId: true,
            notes: true,
            journalEntryId: true,
          },
        },
      },
    });

    if (!bill) {
      throw new NotFoundException('Bill not found.');
    }

    return bill;
  }

  async update(id: string, dto: UpdateBillDto) {
    const existing = await this.prisma.bill.findUnique({
      where: { id },
      include: { items: true, payments: { select: { id: true } } },
    });

    if (!existing) {
      throw new NotFoundException('Bill not found.');
    }

    this.ensurePostedBillEditable(existing, dto);

    if (dto.vendorId) {
      const vendor = await this.prisma.contact.findUnique({
        where: { id: dto.vendorId },
        select: { id: true, isActive: true },
      });

      if (!vendor || !vendor.isActive) {
        throw new NotFoundException('Vendor not found.');
      }
    }

    if (
      dto.amountPaid !== undefined &&
      dto.amountPaid !== existing.amountPaid
    ) {
      throw new BadRequestException(
        'Use the disbursement workflow to update paid amounts. Do not edit bill payments directly.',
      );
    }

    if (dto.status === BillStatus.PAID || dto.status === BillStatus.PARTIAL) {
      throw new BadRequestException(
        'Use the disbursement workflow to mark bills as partially paid or paid.',
      );
    }

    const items =
      dto.items ??
      existing.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        accountId: item.accountId ?? undefined,
      }));
    const taxAmount = dto.taxAmount ?? existing.taxAmount;
    const amountPaid = existing.amountPaid;
    const { normalizedItems, subtotal, total, balanceDue } =
      this.calculateTotals(items, taxAmount, amountPaid);

    const data: Prisma.BillUpdateInput = {
      billNumber: dto.billNumber,
      issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      status: dto.status
        ? this.resolveBillStatus(
            balanceDue,
            dto.dueDate ? new Date(dto.dueDate) : existing.dueDate,
            dto.status,
          )
        : undefined,
      category: dto.category,
      subtotal,
      taxAmount,
      total,
      amountPaid,
      balanceDue,
      notes: dto.notes,
      vendor: dto.vendorId ? { connect: { id: dto.vendorId } } : undefined,
      items: {
        deleteMany: {},
        create: normalizedItems,
      },
    };

    return this.prisma.bill.update({
      where: { id },
      data,
      include: {
        vendor: { select: { id: true, name: true } },
        items: true,
        payments: {
          orderBy: { date: 'desc' },
          select: {
            id: true,
            date: true,
            amount: true,
            method: true,
            reference: true,
            bankAccountId: true,
            notes: true,
            journalEntryId: true,
          },
        },
      },
    });
  }

  async recordPayment(id: string, dto: CreateBillPaymentDto, userId: string) {
    const bill = await this.prisma.bill.findUnique({
      where: { id },
      include: {
        vendor: { select: { id: true, name: true } },
        journalEntry: { select: { id: true, status: true } },
      },
    });

    if (!bill) {
      throw new NotFoundException('Bill not found.');
    }

    if (!bill.journalEntryId || bill.journalEntry?.status !== 'POSTED') {
      throw new BadRequestException(
        'Post the bill to Accounts Payable before recording a vendor payment.',
      );
    }

    if (bill.status === BillStatus.CANCELLED) {
      throw new BadRequestException(
        'Cancelled bills cannot receive vendor payments.',
      );
    }

    if (bill.balanceDue <= 0) {
      throw new BadRequestException('This bill is already fully settled.');
    }

    const amount = this.roundMoney(dto.amount);
    if (amount > this.roundMoney(bill.balanceDue)) {
      throw new BadRequestException(
        'Disbursement amount cannot be greater than the remaining bill balance.',
      );
    }

    const apAccount = await this.prisma.account.findFirst({
      where: { isActive: true, systemTag: 'ACCOUNTS_PAYABLE' },
      select: { id: true },
    });

    if (!apAccount) {
      throw new BadRequestException(
        'No Accounts Payable account is configured. Tag one liability account as Accounts Payable before recording vendor disbursements.',
      );
    }

    const cashAccountId = await this.findCashAccountId(dto.bankAccountId);
    const paymentDate = new Date(dto.date);
    const nextAmountPaid = this.roundMoney(bill.amountPaid + amount);
    const nextBalanceDue = this.roundMoney(bill.total - nextAmountPaid);
    const nextStatus =
      nextBalanceDue <= 0 ? BillStatus.PAID : BillStatus.PARTIAL;

    return this.prisma.$transaction(async (tx) => {
      const count = await tx.journalEntry.count();
      const journalEntry = await tx.journalEntry.create({
        data: {
          entryNumber: `JE-${String(count + 1).padStart(5, '0')}`,
          date: paymentDate,
          description: `Payment for ${bill.billNumber} - ${bill.vendor.name}`,
          status: 'POSTED',
          reference: dto.reference?.trim() || bill.billNumber,
          type: 'PAYMENT',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          lines: {
            create: [
              {
                accountId: apAccount.id,
                description: `Accounts Payable - ${bill.billNumber}`,
                debit: amount,
                credit: 0,
              },
              {
                accountId: cashAccountId,
                description: `Cash paid to ${bill.vendor.name}`,
                debit: 0,
                credit: amount,
              },
            ],
          },
        },
      });

      const payment = await tx.payment.create({
        data: {
          billId: bill.id,
          date: paymentDate,
          amount,
          method: dto.method.trim(),
          reference: dto.reference?.trim() || null,
          bankAccountId: dto.bankAccountId ?? null,
          notes: dto.notes?.trim() || null,
          journalEntryId: journalEntry.id,
          createdBy: userId,
        },
      });

      await tx.bill.update({
        where: { id: bill.id },
        data: {
          amountPaid: nextAmountPaid,
          balanceDue: nextBalanceDue,
          status: nextStatus,
        },
      });

      return payment;
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.bill.delete({ where: { id } });
  }
}
