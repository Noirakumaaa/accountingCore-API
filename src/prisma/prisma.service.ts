import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const getDatabaseUrl = (): string => {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('Missing required environment variable: DATABASE_URL');
  }
  return databaseUrl;
};

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const adapter = new PrismaPg({
      connectionString: getDatabaseUrl(),
    });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
