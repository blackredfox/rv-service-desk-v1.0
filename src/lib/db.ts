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

import type { PrismaClient } from "@prisma/client";
import type { Pool } from "pg";

declare global {
  var __prismaClient: PrismaClient | null | undefined;
  var __prismaPool: Pool | undefined;
}

async function buildClient(): Promise<PrismaClient | null> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[db] DATABASE_URL is not set — running without database.");
    globalThis.__prismaClient = null;
    return null;
  }

  try {
    const [{ PrismaClient }, { PrismaPg }, { Pool }] = await Promise.all([
      import("@prisma/client"),
      import("@prisma/adapter-pg"),
      import("pg"),
    ]);

    const pool = new Pool({ connectionString: url });
    const adapter = new PrismaPg(pool);
    const client = new PrismaClient({ adapter });

    globalThis.__prismaPool = pool;
    globalThis.__prismaClient = client;
    return client;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes(".prisma/client/default")) {
      console.warn("[db] Prisma client is not generated — falling back to memory storage.");
    } else {
      console.error("[db] Failed to initialise Prisma client:", err);
    }

    globalThis.__prismaClient = null;
    return null;
  }
}

/**
 * Returns a singleton PrismaClient, or `null` when DATABASE_URL is not
 * configured (graceful degradation — storage layer falls back to memory).
 *
 * - Production: one client per server process.
 * - Dev: reuses the same instance across hot-reloads via globalThis.
 */
export async function getPrisma(): Promise<PrismaClient | null> {
  if (globalThis.__prismaClient !== undefined) {
    return globalThis.__prismaClient;
  }
  return buildClient();
}
