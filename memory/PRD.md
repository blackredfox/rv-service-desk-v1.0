# RV Service Desk v1.0 — PRD

## Original Problem Statement
Fix Prisma v7 initialization in `scripts/cleanup-retention.ts` and CI workflow `.github/workflows/retention-cleanup.yml`. The script was failing in GitHub Actions with `PrismaClientInitializationError: PrismaClient needs to be constructed with a non-empty, valid PrismaClientOptions`.

## Architecture
- **Stack**: Next.js 16, TypeScript 5.9, Prisma 7.3, PostgreSQL
- **Package Manager**: Yarn 4.12 via Corepack
- **CI**: GitHub Actions (retention-cleanup workflow)
- **Prisma Config**: `prisma.config.ts` with `env("DATABASE_URL")` — Prisma v7 standard (no `url` in schema.prisma datasource)

## Root Cause Analysis
Prisma v7 `prisma-client-js` generator defaults to "client" engine (WASM-based), which **requires** either:
- `adapter` (e.g., `@prisma/adapter-pg`) for direct DB connections
- `accelerateUrl` for Prisma Accelerate

The old pattern `new PrismaClient()` without arguments throws `PrismaClientInitializationError` in v7.

## What's Been Implemented (Jan 2026)

### Fix: Prisma v7 Adapter-Based Initialization
- **`scripts/cleanup-retention.ts`**: Rewritten to use `@prisma/adapter-pg` + `pg` Pool
- **`package.json`**: Added `@prisma/adapter-pg`, `pg`, `@types/pg` dependencies
- **`.github/workflows/retention-cleanup.yml`**: Explicit `DATABASE_URL` env on `prisma generate` and `retention:cleanup` steps
- **Schema**: `prisma/schema.prisma` unchanged (correct for v7 — provider only, no url)

### Verification
- ✅ No TypeScript errors in cleanup script
- ✅ No ESLint errors
- ✅ PrismaClient initializes without PrismaClientInitializationError
- ✅ DATABASE_URL validation works (clear error when missing)
- ✅ Graceful disconnect (prisma + pool)

## Backlog / Next Tasks
- **P0**: Push changes to GitHub, trigger CI run to validate end-to-end
- **P1**: Update `src/lib/db.ts` (main app) to also use adapter pattern — currently uses `new PrismaClient()` which will fail in Prisma v7
- **P1**: Fix pre-existing TypeScript errors (Stripe API version, test file type mismatches)
- **P2**: Add real cleanup logic (DELETE by retention cutoff) to the script
- **P2**: Add `packageManager: "yarn@4.12.0"` to package.json for Corepack auto-detection
