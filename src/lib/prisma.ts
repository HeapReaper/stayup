import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { Pool } from 'pg';

const createPrismaClient = () => {
  const provider = process.env.DB_PROVIDER || 'sqlite';
  const dbUrl = process.env.DB_URL || 'file:./dev.db';

  let adapter;

  if (provider === 'postgresql') {
    const pool = new Pool({ connectionString: dbUrl });
    adapter = new PrismaPg(pool);
  } else {
    const filePath = dbUrl.replace(/^file:/, '');
    adapter = new PrismaBetterSqlite3({ url: filePath });
  }

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
};

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}