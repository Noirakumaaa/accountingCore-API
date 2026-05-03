import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('bank-accounts')
@UseGuards(JwtAuthGuard)
export class BankAccountsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  findAll() {
    return this.prisma.bankAccount.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        bankName: true,
        accountNumber: true,
        currency: true,
      },
      orderBy: { name: 'asc' },
    });
  }
}
