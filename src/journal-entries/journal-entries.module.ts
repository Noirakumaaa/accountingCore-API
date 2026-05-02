import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { JournalEntriesController } from './journal-entries.controller.js';
import { JournalEntriesService } from './journal-entries.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [JournalEntriesController],
  providers: [JournalEntriesService],
})
export class JournalEntriesModule {}
