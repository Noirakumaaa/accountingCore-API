import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ContactsController } from './contacts.controller.js';
import { ContactsService } from './contacts.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [ContactsController],
  providers: [ContactsService],
})
export class ContactsModule {}
