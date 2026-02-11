# RV Service Desk v1.0 — PRD

## Original Problem Statement
Fix Prisma v7 runtime initialization across the entire app — both CI cleanup script and main app Prisma client.

## Architecture
- **Stack**: Next.js 16, TypeScript 5.9, Prisma 7.3, PostgreSQL
- **Package Manager**: Yarn 4.12 via Corepack
- **CI**: GitHub Actions (retention-cleanup workflow)

## Root Cause
Prisma 7.3.0 `prisma-client-js` defaults to TypeScript/WASM "client" engine. `new PrismaClient()` without adapter always fails. The standard v7 pattern requires `@prisma/adapter-pg` + `pg` Pool.

## What's Been Implemented (Jan 2026)

### P0: CI retention cleanup (DONE)
- `scripts/cleanup-retention.ts` — uses `@prisma/adapter-pg` + `pg` Pool
- `.github/workflows/retention-cleanup.yml` — explicit `DATABASE_URL` env
- `yarn.lock` — committed with new deps

### P1: Main app Prisma client (DONE)
- `src/lib/db.ts` — migrated to adapter-pg pattern
  - Singleton with globalThis caching (dev hot-reload safe)
  - Strict DATABASE_URL validation (throws early)
  - Backward-compatible PrismaClientType (storage.ts uses unmigrated schema fields)
  - 0 new TS/ESLint errors introduced
  - All 8 acceptance tests passed

### Dependencies added
- `@prisma/adapter-pg` ^7.4.0 (runtime)
- `pg` ^8.18.0 (runtime)
- `@types/pg` ^8.16.0 (dev)

## Verification
- TS errors: 20 (all pre-existing, 0 new)
- ESLint db.ts: 0 errors, 0 warnings
- Runtime init: PrismaClient creates without error
- Singleton: consecutive calls return same instance
- Env validation: clear throw when DATABASE_URL missing

## Backlog
- P1: Add `inputLanguage`, `languageSource` to Prisma schema → then remove PrismaClientType compat shim
- P1: Fix pre-existing Stripe API version mismatch (b2b-stripe.ts, stripe.ts)
- P2: Add real cleanup DELETE logic to retention script
- P2: Add `packageManager: "yarn@4.12.0"` to package.json
