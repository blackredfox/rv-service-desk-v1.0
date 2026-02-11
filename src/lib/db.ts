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

/*
 * Structural return type for getPrisma().
 *
 * storage.ts references Prisma model fields (inputLanguage, languageSource)
 * not yet present in schema.prisma.  Until that schema migration lands the
 * model delegates must stay loosely typed so existing call-sites compile.
 *
 * TODO: Replace PrismaClientType with PrismaClient once schema includes all
 *       fields currently used in storage.ts / auth.ts / analytics.ts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- required for backward-compat with consumers using unmigrated schema fields; see TODO above
type ModelDelegate = Record<string, (...args: any[]) => any>;

export type PrismaClientType = {
  case: ModelDelegate;
  message: ModelDelegate;
  user: ModelDelegate;
  subscription: ModelDelegate;
  event: ModelDelegate;
  analyticsEvent: ModelDelegate;
  paymentTransaction: ModelDelegate;
  $disconnect: () => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- passthrough to PrismaClient.$queryRaw
  $queryRaw: (...args: any[]) => Promise<unknown>;
};

declare global {
  var __prismaClient: PrismaClientType | undefined;
  var __prismaPool: Pool | undefined;
}

function buildClient(): PrismaClientType {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  const pool = new Pool({ connectionString: url });
  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({ adapter });

  globalThis.__prismaPool = pool;
  globalThis.__prismaClient = client as unknown as PrismaClientType;
  return client as unknown as PrismaClientType;
}

/**
 * Returns a singleton PrismaClient.
 *
 * - Production: one client per server process.
 * - Dev: reuses the same instance across hot-reloads via globalThis.
 *
 * Throws immediately when DATABASE_URL is not configured.
 */
export async function getPrisma(): Promise<PrismaClientType> {
  if (globalThis.__prismaClient) {
    return globalThis.__prismaClient;
  }
  return buildClient();
}
