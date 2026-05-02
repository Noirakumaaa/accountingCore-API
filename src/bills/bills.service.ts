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
import { UpdateBillDto } from './dto/update-bill.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class BillsService {
  constructor(private readonly prisma: PrismaService) {}

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
    const { normalizedItems, subtotal, total, balanceDue } =
      this.calculateTotals(dto.items, taxAmount, amountPaid);

    return this.prisma.bill.create({
      data: {
        billNumber: dto.billNumber ?? (await this.buildBillNumber()),
        vendorId: dto.vendorId,
        issueDate: new Date(dto.issueDate),
        dueDate: new Date(dto.dueDate),
        status: dto.status ?? BillStatus.DRAFT,
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
      include: { items: true },
    });

    if (!existing) {
      throw new NotFoundException('Bill not found.');
    }

    if (dto.vendorId) {
      const vendor = await this.prisma.contact.findUnique({
        where: { id: dto.vendorId },
        select: { id: true, isActive: true },
      });

      if (!vendor || !vendor.isActive) {
        throw new NotFoundException('Vendor not found.');
      }
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
    const amountPaid = dto.amountPaid ?? existing.amountPaid;
    const { normalizedItems, subtotal, total, balanceDue } =
      this.calculateTotals(items, taxAmount, amountPaid);

    const data: Prisma.BillUpdateInput = {
      billNumber: dto.billNumber,
      issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      status: dto.status,
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
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.bill.delete({ where: { id } });
  }
}
