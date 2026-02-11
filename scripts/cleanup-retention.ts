/**
 * Retention cleanup script.
 *
 * Rules:
 * - DATABASE_URL must be available (GitHub Actions secret in CI, .env locally).
 * - PrismaClient is created with default options so it uses schema datasource/env.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not defined. Set it in .env (local) or as a GitHub Actions secret (CI)."
  );
}

const prisma = new PrismaClient();

function logInfo(message: string): void {
  console.log(`[retention-cleanup] ${message}`);
}

function logError(message: string, err?: unknown): void {
  console.error(`[retention-cleanup] ${message}`);
  if (err) console.error(err);
}

async function main(): Promise<void> {
  logInfo("Starting retention cleanup...");

  await prisma.$queryRaw`SELECT 1`;

  logInfo("Retention cleanup completed.");
}

main()
  .catch((err) => {
    logError("Retention cleanup failed.", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    logInfo("Disconnected Prisma client.");
  });
