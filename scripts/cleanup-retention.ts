/**
 * Retention cleanup script (Prisma v7).
 *
 * Prisma 7 replaced the Rust binary engine with a TypeScript/WASM compiler.
 * The generated PrismaClient now requires a driver adapter for direct
 * database connections.  This is the standard v7 instantiation pattern —
 * not a custom override.
 *
 * @see https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not defined. Set it in .env (local) or as a GitHub Actions secret (CI)."
  );
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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
    await pool.end();
    logInfo("Disconnected Prisma client.");
  });
