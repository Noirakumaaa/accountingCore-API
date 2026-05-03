import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { VoucherStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCheckVoucherDto } from './dto/create-check-voucher.dto.js';
import { UpdateCheckVoucherDto } from './dto/update-check-voucher.dto.js';

@Injectable()
export class CheckVouchersService {
  constructor(private readonly prisma: PrismaService) {}

  private roundMoney(value: number) {
    return Number(value.toFixed(2));
  }

  private async buildVoucherNumber() {
    const count = await this.prisma.checkVoucher.count();
    const year = new Date().getFullYear();
    return `CV-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  async create(dto: CreateCheckVoucherDto, userId: string) {
    const bank = await this.prisma.bankAccount.findUnique({
      where: { id: dto.bankAccountId },
      select: { id: true },
    });
    if (!bank) throw new NotFoundException('Bank account not found.');

    if (dto.vendorId) {
      const vendor = await this.prisma.contact.findUnique({
        where: { id: dto.vendorId },
        select: { id: true, isActive: true },
      });
      if (!vendor || !vendor.isActive)
        throw new NotFoundException('Vendor not found.');
    }

    if (dto.billId) {
      const bill = await this.prisma.bill.findUnique({
        where: { id: dto.billId },
        select: { id: true },
      });
      if (!bill) throw new NotFoundException('Bill not found.');
    }

    return this.prisma.checkVoucher.create({
      data: {
        voucherNumber: dto.voucherNumber ?? (await this.buildVoucherNumber()),
        vendorId: dto.vendorId ?? null,
        billId: dto.billId ?? null,
        date: new Date(dto.date),
        checkNumber: dto.checkNumber ?? null,
        bankAccountId: dto.bankAccountId,
        payee: dto.payee.trim(),
        amount: dto.amount,
        purpose: dto.purpose.trim(),
        status: dto.status ?? VoucherStatus.DRAFT,
        createdBy: userId,
      },
      include: {
        vendor: { select: { id: true, name: true } },
        bankAccount: { select: { id: true, name: true } },
        bill: { select: { id: true, billNumber: true } },
      },
    });
  }

  async findAll() {
    const vouchers = await this.prisma.checkVoucher.findMany({
      orderBy: { date: 'desc' },
      include: {
        vendor: { select: { id: true, name: true } },
        bankAccount: { select: { id: true, name: true } },
        bill: { select: { id: true, billNumber: true } },
      },
    });

    const total = vouchers.reduce((sum, v) => sum + v.amount, 0);
    const pending = vouchers.filter(
      (v) =>
        v.status === VoucherStatus.DRAFT || v.status === VoucherStatus.APPROVED,
    ).length;

    return { vouchers, summary: { total, pending, count: vouchers.length } };
  }

  async findOne(id: string) {
    const voucher = await this.prisma.checkVoucher.findUnique({
      where: { id },
      include: {
        vendor: { select: { id: true, name: true } },
        bankAccount: { select: { id: true, name: true } },
        bill: { select: { id: true, billNumber: true } },
      },
    });
    if (!voucher) throw new NotFoundException('Check voucher not found.');
    return voucher;
  }

  async update(id: string, dto: UpdateCheckVoucherDto) {
    const existing = await this.findOne(id);

    if (existing.journalEntryId) {
      throw new BadRequestException(
        'Issued vouchers can no longer be edited. Void and recreate the voucher if something needs to change.',
      );
    }

    if (dto.bankAccountId) {
      const bank = await this.prisma.bankAccount.findUnique({
        where: { id: dto.bankAccountId },
        select: { id: true },
      });
      if (!bank) throw new NotFoundException('Bank account not found.');
    }

    return this.prisma.checkVoucher.update({
      where: { id },
      data: {
        vendorId: dto.vendorId,
        billId: dto.billId,
        date: dto.date ? new Date(dto.date) : undefined,
        checkNumber: dto.checkNumber,
        bankAccountId: dto.bankAccountId,
        payee: dto.payee?.trim(),
        amount: dto.amount,
        purpose: dto.purpose?.trim(),
        status: dto.status,
      },
      include: {
        vendor: { select: { id: true, name: true } },
        bankAccount: { select: { id: true, name: true } },
        bill: { select: { id: true, billNumber: true } },
      },
    });
  }

  async approve(id: string, userId: string) {
    const voucher = await this.findOne(id);
    if (voucher.status !== VoucherStatus.DRAFT) {
      throw new BadRequestException('Only draft vouchers can be approved.');
    }
    return this.prisma.checkVoucher.update({
      where: { id },
      data: { status: VoucherStatus.APPROVED, approvedBy: userId },
    });
  }

  async issue(id: string, userId: string) {
    const voucher = await this.prisma.checkVoucher.findUnique({
      where: { id },
      include: {
        vendor: { select: { id: true, name: true } },
        bill: {
          select: {
            id: true,
            billNumber: true,
            total: true,
            amountPaid: true,
            balanceDue: true,
            status: true,
            journalEntryId: true,
            vendor: { select: { id: true, name: true } },
          },
        },
        bankAccount: {
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
        },
      },
    });

    if (!voucher) {
      throw new NotFoundException('Check voucher not found.');
    }

    if (voucher.status !== VoucherStatus.APPROVED) {
      throw new BadRequestException('Only approved vouchers can be issued.');
    }

    if (voucher.journalEntryId) {
      throw new BadRequestException('This voucher has already been issued.');
    }

    if (!voucher.bill) {
      throw new BadRequestException(
        'Link this voucher to a posted bill before issuing it. Use the Expense module for direct operating spend that is not clearing Accounts Payable.',
      );
    }

    const linkedBill = voucher.bill;

    if (!linkedBill.journalEntryId) {
      throw new BadRequestException(
        'Post the linked bill to Accounts Payable before issuing a check against it.',
      );
    }

    if (linkedBill.status === 'CANCELLED') {
      throw new BadRequestException(
        'Cancelled bills cannot be paid by check voucher.',
      );
    }

    if (linkedBill.balanceDue <= 0) {
      throw new BadRequestException(
        'The linked bill is already fully settled.',
      );
    }

    const amount = this.roundMoney(voucher.amount);
    if (amount > this.roundMoney(linkedBill.balanceDue)) {
      throw new BadRequestException(
        'Voucher amount cannot be greater than the remaining balance of the linked bill.',
      );
    }

    if (
      !voucher.bankAccount.isActive ||
      !voucher.bankAccount.account.isActive ||
      voucher.bankAccount.account.type !== 'ASSET'
    ) {
      throw new BadRequestException(
        'The selected bank account must be active and linked to an asset account before issuing this voucher.',
      );
    }

    const apAccount = await this.prisma.account.findFirst({
      where: { isActive: true, systemTag: 'ACCOUNTS_PAYABLE' },
      select: { id: true },
    });

    if (!apAccount) {
      throw new BadRequestException(
        'No Accounts Payable account is configured. Tag one liability account as Accounts Payable before issuing a vendor check.',
      );
    }

    const paymentDate = new Date(voucher.date);
    const nextAmountPaid = this.roundMoney(linkedBill.amountPaid + amount);
    const nextBalanceDue = this.roundMoney(linkedBill.total - nextAmountPaid);
    const nextBillStatus = nextBalanceDue <= 0 ? 'PAID' : 'PARTIAL';

    return this.prisma.$transaction(async (tx) => {
      const count = await tx.journalEntry.count();
      const journalEntry = await tx.journalEntry.create({
        data: {
          entryNumber: `JE-${String(count + 1).padStart(5, '0')}`,
          date: paymentDate,
          description: `Check voucher ${voucher.voucherNumber} - ${voucher.payee}`,
          status: 'POSTED',
          reference: voucher.checkNumber ?? voucher.voucherNumber,
          type: 'VOUCHER',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          lines: {
            create: [
              {
                accountId: apAccount.id,
                description: `Accounts Payable - ${linkedBill.billNumber}`,
                debit: amount,
                credit: 0,
              },
              {
                accountId: voucher.bankAccount.accountId,
                description: `Check disbursement - ${voucher.payee}`,
                debit: 0,
                credit: amount,
              },
            ],
          },
        },
      });

      await tx.payment.create({
        data: {
          billId: linkedBill.id,
          date: paymentDate,
          amount,
          method: 'check',
          reference: voucher.checkNumber ?? voucher.voucherNumber,
          bankAccountId: voucher.bankAccountId,
          notes: voucher.purpose,
          journalEntryId: journalEntry.id,
          createdBy: userId,
        },
      });

      await tx.bill.update({
        where: { id: linkedBill.id },
        data: {
          amountPaid: nextAmountPaid,
          balanceDue: nextBalanceDue,
          status: nextBillStatus,
        },
      });

      return tx.checkVoucher.update({
        where: { id: voucher.id },
        data: {
          status: VoucherStatus.ISSUED,
          journalEntryId: journalEntry.id,
        },
        include: {
          vendor: { select: { id: true, name: true } },
          bankAccount: { select: { id: true, name: true } },
          bill: { select: { id: true, billNumber: true } },
        },
      });
    });
  }

  async remove(id: string) {
    const voucher = await this.findOne(id);
    if (
      voucher.status === VoucherStatus.ISSUED ||
      voucher.status === VoucherStatus.CLEARED
    ) {
      throw new BadRequestException(
        'Cannot delete an issued or cleared voucher.',
      );
    }
    return this.prisma.checkVoucher.delete({ where: { id } });
  }
}
