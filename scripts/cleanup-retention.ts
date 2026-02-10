#!/usr/bin/env npx tsx
/**
 * Retention Cleanup Script — deletes expired cases and their messages.
 *
 * Retention window: 30 days from lastActivityAt (= updatedAt in DB).
 * expiresAt = updatedAt + 30 days
 *
 * Run: npx tsx scripts/cleanup-retention.ts
 * Schedule via cron (daily): 0 3 * * * cd /path/to/project && npx tsx scripts/cleanup-retention.ts
 *
 * Options:
 *   --dry-run   Show what would be deleted without actually deleting
 */

import { PrismaClient } from "@prisma/client";
import { RETENTION_DAYS } from "../src/lib/retention";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const prisma = new PrismaClient();

  try {
    const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    console.log(`[Retention Cleanup] ${DRY_RUN ? "(DRY RUN) " : ""}Started at ${new Date().toISOString()}`);
    console.log(`[Retention Cleanup] Retention window: ${RETENTION_DAYS} days`);
    console.log(`[Retention Cleanup] Cutoff date: ${cutoffDate.toISOString()}`);

    // Find expired cases (updatedAt < cutoff)
    const expiredCases = await prisma.case.findMany({
      where: {
        updatedAt: { lt: cutoffDate },
      },
      select: { id: true, title: true, updatedAt: true },
    });

    console.log(`[Retention Cleanup] Found ${expiredCases.length} expired case(s)`);

    if (expiredCases.length === 0) {
      console.log(`[Retention Cleanup] Nothing to clean up. Done.`);
      return;
    }

    const caseIds = expiredCases.map((c) => c.id);

    // Count messages to be deleted
    const messageCount = await prisma.message.count({
      where: { caseId: { in: caseIds } },
    });

    console.log(`[Retention Cleanup] ${messageCount} message(s) belong to expired cases`);

    if (DRY_RUN) {
      console.log(`[Retention Cleanup] DRY RUN — would delete:`);
      for (const c of expiredCases) {
        console.log(`  - Case "${c.title}" (id: ${c.id}, last activity: ${c.updatedAt.toISOString()})`);
      }
      console.log(`  - ${messageCount} total messages`);
      return;
    }

    // Delete messages first (FK constraint)
    const deletedMessages = await prisma.message.deleteMany({
      where: { caseId: { in: caseIds } },
    });

    // Delete cases
    const deletedCases = await prisma.case.deleteMany({
      where: { id: { in: caseIds } },
    });

    console.log(`[Retention Cleanup] Deleted ${deletedCases.count} case(s) and ${deletedMessages.count} message(s)`);
    console.log(`[Retention Cleanup] Done.`);
  } catch (error) {
    console.error(`[Retention Cleanup] Error:`, error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
