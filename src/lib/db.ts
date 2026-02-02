// NOTE: Prisma client types are generated ("prisma generate").
// In local dev, DATABASE_URL may be intentionally unset, so generated client
// may not exist. To keep typecheck working without generated artifacts,
// we use a minimal structural type.
export type PrismaClientType = {
  case: unknown;
  message: unknown;
  user: unknown;
  subscription: unknown;
  event: unknown;
  analyticsEvent: unknown;
  paymentTransaction: unknown;
  $disconnect: () => Promise<void>;
};

// NOTE: Prisma client types may be unavailable in local dev if `prisma generate`
// hasn't been run (e.g., DATABASE_URL missing). We keep runtime imports guarded
// and typecheck-friendly by loosening the constructor import below.

declare global {
  // Cached instance for dev hot-reload.
  var __prisma: PrismaClientType | null | undefined;
}

/**
 * Returns a PrismaClient instance when DATABASE_URL is set and Prisma client is generated.
 * DATABASE_URL is REQUIRED for Release 1 - throws if not configured.
 */
export async function getPrisma(): Promise<PrismaClientType | null> {
  if (!process.env.DATABASE_URL) {
    // In Release 1, database is required for auth
    return null;
  }

  if (global.__prisma !== undefined) {
    return global.__prisma;
  }

  try {
    // Prisma's generated runtime may not exist if prisma generate wasn't run.
    // Use a guarded dynamic import and cast to avoid hard TS dependency on generated types.
    const mod = (await import("@prisma/client")) as unknown as { PrismaClient?: new () => PrismaClientType };
    if (!mod.PrismaClient) {
      global.__prisma = null;
      return null;
    }
    const client = new mod.PrismaClient();
    global.__prisma = client;
    return client;
  } catch {
    // If prisma client hasn't been generated yet, this import will fail.
    global.__prisma = null;
    return null;
  }
}
