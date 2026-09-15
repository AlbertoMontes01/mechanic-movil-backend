import { PrismaClient } from '@prisma/client';

// Reuse a single instance across module reloads (relevant with `node --watch`).
const globalForPrisma = globalThis;

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
