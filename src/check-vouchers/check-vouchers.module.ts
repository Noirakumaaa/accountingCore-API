import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CheckVouchersService } from './check-vouchers.service.js';
import { CheckVouchersController } from './check-vouchers.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [CheckVouchersController],
  providers: [CheckVouchersService],
})
export class CheckVouchersModule {}
