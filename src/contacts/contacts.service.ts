import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContactType, type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateContactDto } from './dto/create-contact.dto.js';

type ContactKind = 'all' | 'customer' | 'vendor';

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  private getWhere(kind: ContactKind): Prisma.ContactWhereInput | undefined {
    if (kind === 'customer') {
      return { type: { in: [ContactType.CUSTOMER, ContactType.BOTH] } };
    }

    if (kind === 'vendor') {
      return { type: { in: [ContactType.VENDOR, ContactType.BOTH] } };
    }

    return undefined;
  }

  async findAll(kind: ContactKind = 'all') {
    const contacts = await this.prisma.contact.findMany({
      where: this.getWhere(kind),
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
    });

    return { contacts };
  }

  async create(dto: CreateContactDto) {
    return this.prisma.contact.create({
      data: {
        type: dto.type,
        name: dto.name.trim(),
        email: dto.email?.trim() || null,
        phone: dto.phone?.trim() || null,
        taxId: dto.taxId?.trim() || null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async setActive(id: string, isActive: boolean) {
    const contact = await this.prisma.contact.findUnique({ where: { id } });
    if (!contact) throw new NotFoundException('Contact not found.');
    return this.prisma.contact.update({ where: { id }, data: { isActive } });
  }

  async remove(id: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
      include: {
        _count: { select: { invoices: true, bills: true, expenses: true } },
      },
    });

    if (!contact) throw new NotFoundException('Contact not found.');

    const linked =
      contact._count.invoices + contact._count.bills + contact._count.expenses;

    if (linked > 0) {
      throw new ConflictException(
        `This contact has ${linked} linked record${linked === 1 ? '' : 's'} and cannot be deleted. Deactivate it instead.`,
      );
    }

    return this.prisma.contact.delete({ where: { id } });
  }
}
