/**
 * Shared Prisma client for the main app (Prisma v7).
 *
 * Prisma 7 uses a TypeScript/WASM query compiler and requires a driver
 * adapter for direct database connections.  We use @prisma/adapter-pg
 * with a pg Pool — the standard v7 instantiation pattern.
 *
 * The client is cached on globalThis so Next.js dev hot-reload does not
 * create new connections on every module re-evaluation.
 *
 * @see https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var -- globalThis caching requires var
  var __prismaClient: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var __prismaPool: Pool | undefined;
}

function buildClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  const pool = new Pool({ connectionString: url });
  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({ adapter });

  globalThis.__prismaPool = pool;
  globalThis.__prismaClient = client;
  return client;
}

/**
 * Returns a singleton PrismaClient.
 *
 * - Production: one client per server process.
 * - Dev: reuses the same instance across hot-reloads via globalThis.
 *
 * Throws immediately when DATABASE_URL is not configured.
 */
export async function getPrisma(): Promise<PrismaClient> {
  if (globalThis.__prismaClient) {
    return globalThis.__prismaClient;
  }
  return buildClient();
}
