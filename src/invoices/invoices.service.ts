import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import {
  CreateInvoiceDto,
  type CreateInvoiceItemDto,
} from './dto/create-invoice.dto.js';
import { CreateInvoicePaymentDto } from './dto/create-invoice-payment.dto.js';
import { UpdateInvoiceDto } from './dto/update-invoice.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class InvoicesService {
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
          `The selected bank account "${bankAccount.name}" must be linked to an asset account before you can record receipts.`,
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
        'No default cash account is configured. Tag one asset account as Cash or choose a bank account before recording this receipt.',
      );
    }

    return cashAccount.id;
  }

  private resolveInvoiceStatus(
    balanceDue: number,
    dueDate: Date,
    currentStatus?: InvoiceStatus,
  ) {
    if (currentStatus === InvoiceStatus.CANCELLED) {
      return InvoiceStatus.CANCELLED;
    }

    if (balanceDue <= 0) {
      return InvoiceStatus.PAID;
    }

    if (currentStatus === InvoiceStatus.DRAFT) {
      return InvoiceStatus.DRAFT;
    }

    if (currentStatus === InvoiceStatus.PARTIAL) {
      return InvoiceStatus.PARTIAL;
    }

    if (new Date(dueDate).getTime() < Date.now()) {
      return InvoiceStatus.OVERDUE;
    }

    return InvoiceStatus.SENT;
  }

  private ensurePostedInvoiceEditable(
    existing: {
      journalEntryId: string | null;
      payments: { id: string }[];
    },
    dto: UpdateInvoiceDto,
  ) {
    if (!existing.journalEntryId) {
      return;
    }

    const financialFieldsTouched =
      dto.customerId !== undefined ||
      dto.issueDate !== undefined ||
      dto.dueDate !== undefined ||
      dto.taxRate !== undefined ||
      dto.taxAmount !== undefined ||
      dto.discount !== undefined ||
      dto.items !== undefined;

    if (financialFieldsTouched) {
      throw new BadRequestException(
        'Posted invoices can no longer change customer, dates, line items, or totals. Void and recreate the invoice if the accounting needs to change.',
      );
    }

    if (
      existing.payments.length > 0 &&
      dto.status === InvoiceStatus.CANCELLED
    ) {
      throw new BadRequestException(
        'Invoices with recorded receipts cannot be cancelled directly. Reverse the payments first.',
      );
    }
  }

  private normalizeItems(items: CreateInvoiceItemDto[]) {
    if (!items.length) {
      throw new BadRequestException('Add at least one invoice item.');
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
    items: CreateInvoiceItemDto[],
    taxRate = 0,
    discount = 0,
    amountPaid = 0,
  ) {
    const normalizedItems = this.normalizeItems(items);
    const subtotal = Number(
      normalizedItems.reduce((sum, item) => sum + item.amount, 0).toFixed(2),
    );
    const taxAmount = Number(((subtotal * taxRate) / 100).toFixed(2));
    const total = Number((subtotal + taxAmount - discount).toFixed(2));
    const balanceDue = Number(Math.max(total - amountPaid, 0).toFixed(2));

    return { normalizedItems, subtotal, taxAmount, total, balanceDue };
  }

  private async buildInvoiceNumber() {
    const count = await this.prisma.invoice.count();
    return `INV-${String(count + 1).padStart(5, '0')}`;
  }

  async create(createInvoiceDto: CreateInvoiceDto, userId: string) {
    const customer = await this.prisma.contact.findUnique({
      where: { id: createInvoiceDto.customerId },
      select: { id: true, name: true, type: true, isActive: true },
    });

    if (!customer || !customer.isActive) {
      throw new NotFoundException('Customer not found.');
    }

    const taxRate = createInvoiceDto.taxRate ?? 0;
    const discount = createInvoiceDto.discount ?? 0;
    const amountPaid = createInvoiceDto.amountPaid ?? 0;

    if (amountPaid > 0) {
      throw new BadRequestException(
        'Create the invoice first, then record customer receipts separately so Accounts Receivable and cash stay in sync.',
      );
    }

    if (
      createInvoiceDto.status &&
      createInvoiceDto.status !== InvoiceStatus.DRAFT &&
      createInvoiceDto.status !== InvoiceStatus.SENT
    ) {
      throw new BadRequestException(
        'New invoices can only start as Draft or Sent. Partial and paid states must come from posted customer receipts.',
      );
    }

    const { normalizedItems, subtotal, taxAmount, total, balanceDue } =
      this.calculateTotals(
        createInvoiceDto.items,
        taxRate,
        discount,
        amountPaid,
      );

    return this.prisma.invoice.create({
      data: {
        invoiceNumber:
          createInvoiceDto.invoiceNumber ?? (await this.buildInvoiceNumber()),
        customerId: createInvoiceDto.customerId,
        issueDate: new Date(createInvoiceDto.issueDate),
        dueDate: new Date(createInvoiceDto.dueDate),
        status:
          createInvoiceDto.status ??
          this.resolveInvoiceStatus(
            balanceDue,
            new Date(createInvoiceDto.dueDate),
          ),
        subtotal,
        taxRate,
        taxAmount,
        discount,
        total,
        amountPaid,
        balanceDue,
        notes: createInvoiceDto.notes,
        terms: createInvoiceDto.terms,
        createdBy: userId,
        items: {
          create: normalizedItems,
        },
      },
      include: {
        customer: { select: { id: true, name: true } },
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
    const invoices = await this.prisma.invoice.findMany({
      orderBy: { issueDate: 'desc' },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return { invoices };
  }

  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true } },
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

    if (!invoice) {
      throw new NotFoundException('Invoice not found.');
    }

    return invoice;
  }

  async update(id: string, updateInvoiceDto: UpdateInvoiceDto) {
    const existing = await this.prisma.invoice.findUnique({
      where: { id },
      include: { items: true, payments: { select: { id: true } } },
    });

    if (!existing) {
      throw new NotFoundException('Invoice not found.');
    }

    this.ensurePostedInvoiceEditable(existing, updateInvoiceDto);

    if (updateInvoiceDto.customerId) {
      const customer = await this.prisma.contact.findUnique({
        where: { id: updateInvoiceDto.customerId },
        select: { id: true, isActive: true },
      });

      if (!customer || !customer.isActive) {
        throw new NotFoundException('Customer not found.');
      }
    }

    if (
      updateInvoiceDto.amountPaid !== undefined &&
      updateInvoiceDto.amountPaid !== existing.amountPaid
    ) {
      throw new BadRequestException(
        'Use the receipt workflow to update paid amounts. Do not edit invoice payments directly.',
      );
    }

    if (
      updateInvoiceDto.status === InvoiceStatus.PAID ||
      updateInvoiceDto.status === InvoiceStatus.PARTIAL
    ) {
      throw new BadRequestException(
        'Use the receipt workflow to mark invoices as partially paid or paid.',
      );
    }

    const items =
      updateInvoiceDto.items ??
      existing.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        accountId: item.accountId ?? undefined,
      }));
    const taxRate = updateInvoiceDto.taxRate ?? existing.taxRate;
    const discount = updateInvoiceDto.discount ?? existing.discount;
    const amountPaid = existing.amountPaid;
    const { normalizedItems, subtotal, taxAmount, total, balanceDue } =
      this.calculateTotals(items, taxRate, discount, amountPaid);

    const data: Prisma.InvoiceUpdateInput = {
      invoiceNumber: updateInvoiceDto.invoiceNumber,
      issueDate: updateInvoiceDto.issueDate
        ? new Date(updateInvoiceDto.issueDate)
        : undefined,
      dueDate: updateInvoiceDto.dueDate
        ? new Date(updateInvoiceDto.dueDate)
        : undefined,
      status: updateInvoiceDto.status
        ? this.resolveInvoiceStatus(
            balanceDue,
            updateInvoiceDto.dueDate
              ? new Date(updateInvoiceDto.dueDate)
              : existing.dueDate,
            updateInvoiceDto.status,
          )
        : undefined,
      subtotal,
      taxRate,
      taxAmount,
      discount,
      total,
      amountPaid,
      balanceDue,
      notes: updateInvoiceDto.notes,
      terms: updateInvoiceDto.terms,
      customer: updateInvoiceDto.customerId
        ? { connect: { id: updateInvoiceDto.customerId } }
        : undefined,
      items: {
        deleteMany: {},
        create: normalizedItems,
      },
    };

    return this.prisma.invoice.update({
      where: { id },
      data,
      include: {
        customer: { select: { id: true, name: true } },
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

  async recordPayment(
    id: string,
    dto: CreateInvoicePaymentDto,
    userId: string,
  ) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true } },
        journalEntry: { select: { id: true, status: true } },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found.');
    }

    if (!invoice.journalEntryId || invoice.journalEntry?.status !== 'POSTED') {
      throw new BadRequestException(
        'Post the invoice to Accounts Receivable before recording a customer receipt.',
      );
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException(
        'Cancelled invoices cannot receive customer payments.',
      );
    }

    if (invoice.balanceDue <= 0) {
      throw new BadRequestException('This invoice is already fully settled.');
    }

    const amount = this.roundMoney(dto.amount);
    if (amount > this.roundMoney(invoice.balanceDue)) {
      throw new BadRequestException(
        'Receipt amount cannot be greater than the remaining invoice balance.',
      );
    }

    const arAccount = await this.prisma.account.findFirst({
      where: { isActive: true, systemTag: 'ACCOUNTS_RECEIVABLE' },
      select: { id: true },
    });

    if (!arAccount) {
      throw new BadRequestException(
        'No Accounts Receivable account is configured. Tag one asset account as Accounts Receivable before recording receipts.',
      );
    }

    const cashAccountId = await this.findCashAccountId(dto.bankAccountId);
    const paymentDate = new Date(dto.date);
    const nextAmountPaid = this.roundMoney(invoice.amountPaid + amount);
    const nextBalanceDue = this.roundMoney(invoice.total - nextAmountPaid);
    const nextStatus =
      nextBalanceDue <= 0 ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL;

    return this.prisma.$transaction(async (tx) => {
      const count = await tx.journalEntry.count();
      const journalEntry = await tx.journalEntry.create({
        data: {
          entryNumber: `JE-${String(count + 1).padStart(5, '0')}`,
          date: paymentDate,
          description: `Receipt for ${invoice.invoiceNumber} - ${invoice.customer.name}`,
          status: 'POSTED',
          reference: dto.reference?.trim() || invoice.invoiceNumber,
          type: 'PAYMENT',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          lines: {
            create: [
              {
                accountId: cashAccountId,
                description: `Cash received from ${invoice.customer.name}`,
                debit: amount,
                credit: 0,
              },
              {
                accountId: arAccount.id,
                description: `Accounts Receivable - ${invoice.invoiceNumber}`,
                debit: 0,
                credit: amount,
              },
            ],
          },
        },
      });

      const payment = await tx.payment.create({
        data: {
          invoiceId: invoice.id,
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

      await tx.invoice.update({
        where: { id: invoice.id },
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

    return this.prisma.invoice.delete({
      where: { id },
    });
  }
}
