import { PrismaClient } from "@prisma/client";

declare global {
  var prisma: PrismaClient | undefined;
}

export const prisma =
  process.env.DATABASE_URL
    ? global.prisma ?? new PrismaClient()
    : null;

if (process.env.NODE_ENV !== "production" && prisma) {
  global.prisma = prisma;
}
