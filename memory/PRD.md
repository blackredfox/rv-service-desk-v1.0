# RV Service Desk v1.0 — PRD

## Original Problem Statement
Fix Prisma v7 runtime initialization across the entire app — CI cleanup script, main app client, and schema alignment.

## Architecture
- **Stack**: Next.js 16, TypeScript 5.9, Prisma 7.3, PostgreSQL
- **Package Manager**: Yarn 4.12 via Corepack
- **CI**: GitHub Actions (retention-cleanup workflow)

## Root Cause
Prisma 7.3.0 `prisma-client-js` defaults to TypeScript/WASM "client" engine. `new PrismaClient()` without adapter always fails. Standard v7 pattern requires `@prisma/adapter-pg` + `pg` Pool.

## What's Been Implemented (Jan 2026)

### P0: CI retention cleanup (DONE)
- `scripts/cleanup-retention.ts` — adapter-pg pattern
- `.github/workflows/retention-cleanup.yml` — DATABASE_URL env
- `yarn.lock` — committed with new deps

### P1: Main app Prisma client + schema alignment (DONE)
**4 files changed, 38 insertions, 16 deletions:**

1. `src/lib/db.ts` — Replaced `PrismaClientType` shim (7x `any`) with real `PrismaClient` import
   - Zero `any`, zero `eslint-disable`
   - Adapter-pg pattern, singleton via globalThis
   - Graceful null return when DATABASE_URL absent (test compat)

2. `prisma/schema.prisma` — Added missing fields
   - `Case.inputLanguage Language @default(EN)`
   - `Case.languageSource LanguageSource @default(AUTO)`
   - `Case.language` → added `@default(EN)`
   - `Message.language Language?`

3. `src/lib/storage.ts` — 2 lines: userId guard for createCaseDb/ensureCaseDb

4. `prisma/migrations/20260128000000_add_case_language_fields/migration.sql`

### Verification
- TS errors: 20 (all pre-existing, 0 new)
- ESLint db.ts: 0 errors, 0 warnings
- yarn test: 504/504 passed, 35/35 files
- Runtime: PrismaClient init OK, singleton OK, null fallback OK
- Zero `any` in db.ts

## Commit Message
`fix(db): replace PrismaClientType shim with real PrismaClient (Prisma v7 adapter-pg)`

## Backlog
- P2: Remove `AnyObj = any` helper in storage.ts (replace with proper Prisma types)
- P2: Fix pre-existing Stripe API version mismatch (b2b-stripe.ts, stripe.ts)
- P2: Real retention DELETE logic in cleanup script
- P2: Add `packageManager: "yarn@4.12.0"` to package.json
