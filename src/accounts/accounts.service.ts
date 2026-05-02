import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAccountDto } from './dto/create-account.dto.js';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  private selectFields = {
    id: true,
    code: true,
    name: true,
    type: true,
    subtype: true,
    systemTag: true,
    description: true,
    parentId: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  async findAll() {
    return this.prisma.account.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      select: this.selectFields,
    });
  }

  async create(dto: CreateAccountDto) {
    if (dto.systemTag === 'DEFAULT_REVENUE') {
      throw new BadRequestException(
        'Default revenue accounts are no longer supported. Choose the revenue account explicitly on each submitted invoice line before posting.',
      );
    }

    const existing = await this.prisma.account.findUnique({
      where: { code: dto.code },
    });
    if (existing?.isActive) {
      throw new ConflictException(
        `Account code "${dto.code}" is already in use.`,
      );
    }

    // If a systemTag is provided, ensure no other active account already claims it.
    // Inactive accounts should not block reuse of a system role.
    if (dto.systemTag) {
      const tagTaken = await this.prisma.account.findUnique({
        where: { systemTag: dto.systemTag },
      });

      if (tagTaken?.isActive && tagTaken.id !== existing?.id) {
        throw new ConflictException(
          `Another account ("${tagTaken.name}") is already marked as ${dto.systemTag.replace(/_/g, ' ').toLowerCase()}. Remove that tag first.`,
        );
      }

      if (tagTaken && !tagTaken.isActive && tagTaken.id !== existing?.id) {
        await this.prisma.account.update({
          where: { id: tagTaken.id },
          data: { systemTag: null },
        });
      }
    }

    const data = {
      code: dto.code,
      name: dto.name,
      type: dto.type,
      subtype: dto.subtype,
      systemTag: dto.systemTag,
      description: dto.description,
      parentId: dto.parentId,
    };

    if (existing && !existing.isActive) {
      return this.prisma.account.update({
        where: { id: existing.id },
        data: {
          ...data,
          isActive: true,
        },
        select: this.selectFields,
      });
    }

    return this.prisma.account.create({
      data,
      select: this.selectFields,
    });
  }

  async remove(id: string) {
    const account = await this.prisma.account.findUnique({
      where: { id },
      include: {
        children: { select: { id: true }, take: 1 },
        journalLines: { select: { id: true }, take: 1 },
        bankAccounts: { select: { id: true }, take: 1 },
        invoiceItems: { select: { id: true }, take: 1 },
        billItems: { select: { id: true }, take: 1 },
        expenses: { select: { id: true }, take: 1 },
      },
    });
    if (!account) throw new NotFoundException('Account not found.');

    const hasDependencies =
      account.children.length > 0 ||
      account.journalLines.length > 0 ||
      account.bankAccounts.length > 0 ||
      account.invoiceItems.length > 0 ||
      account.billItems.length > 0 ||
      account.expenses.length > 0;

    if (!hasDependencies) {
      return this.prisma.account.delete({
        where: { id },
      });
    }

    return this.prisma.account.update({
      where: { id },
      data: {
        isActive: false,
        systemTag: null,
      },
    });
  }
}
