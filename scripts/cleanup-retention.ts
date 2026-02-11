/**
 * Retention cleanup script.
 *
 * Rules:
 * - DATABASE_URL must be available (GitHub Actions secret in CI, .env locally).
 * - PrismaClient should be created with default options so it uses schema datasource/env.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || databaseUrl.trim().length === 0) {
  throw new Error(
    "DATABASE_URL is missing or empty. For local runs, ensure it exists in .env. For CI, set GitHub secret DATABASE_URL."
  );
}

const prisma = new PrismaClient();

function logInfo(message: string) {
  console.log(`[retention-cleanup] ${message}`);
}

function logError(message: string, err?: unknown) {
  console.error(`[retention-cleanup] ${message}`);
  if (err) console.error(err);
}

async function main(): Promise<void> {
  logInfo("Starting retention cleanup...");

  // Sanity ping (no data changes)
  await prisma.$queryRaw`SELECT 1`;

  // TODO: Paste your real cleanup logic here (delete/update by retention cutoff).
  logInfo("No-op cleanup (replace TODO with real delete/update logic).");

  logInfo("Retention cleanup completed.");
}

main()
  .catch((err) => {
    logError("Retention cleanup failed.", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
      logInfo("Disconnected Prisma client.");
    } catch (e) {
      logError("Failed to disconnect Prisma client.", e);
    }
  });
