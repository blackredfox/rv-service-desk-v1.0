import type { PrismaClient as PrismaClientType } from "@prisma/client";

declare global {
  // Cached instance for dev hot-reload. Can be null when DB is not configured.
  var __prisma: PrismaClientType | null | undefined;
}

/**
 * Returns a PrismaClient instance when DATABASE_URL is set and Prisma client is generated.
 * In early bootstrap (no DATABASE_URL), returns null and callers should fall back to in-memory storage.
 */
export async function getPrisma(): Promise<PrismaClientType | null> {
  if (!process.env.DATABASE_URL) return null;

  if (global.__prisma !== undefined) {
    return global.__prisma;
  }

  try {
    const { PrismaClient } = await import("@prisma/client");
    const client = new PrismaClient();
    global.__prisma = client;
    return client;
  } catch {
    // If prisma client hasn't been generated yet, this import will fail.
    global.__prisma = null;
    return null;
  }
}
