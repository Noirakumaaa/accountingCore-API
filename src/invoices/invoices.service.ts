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
import { UpdateInvoiceDto } from './dto/update-invoice.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

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
        status: createInvoiceDto.status ?? InvoiceStatus.DRAFT,
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
      include: { items: true },
    });

    if (!existing) {
      throw new NotFoundException('Invoice not found.');
    }

    if (updateInvoiceDto.customerId) {
      const customer = await this.prisma.contact.findUnique({
        where: { id: updateInvoiceDto.customerId },
        select: { id: true, isActive: true },
      });

      if (!customer || !customer.isActive) {
        throw new NotFoundException('Customer not found.');
      }
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
    const amountPaid = updateInvoiceDto.amountPaid ?? existing.amountPaid;
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
      status: updateInvoiceDto.status,
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
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.invoice.delete({
      where: { id },
    });
  }
}
