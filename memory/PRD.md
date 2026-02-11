# RV Service Desk v1.0 — PRD

## Original Problem Statement
Fix Prisma v7 initialization in `scripts/cleanup-retention.ts` and CI workflow `.github/workflows/retention-cleanup.yml`. The script was failing in GitHub Actions with `PrismaClientInitializationError`.

## Architecture
- **Stack**: Next.js 16, TypeScript 5.9, Prisma 7.3, PostgreSQL
- **Package Manager**: Yarn 4.12 via Corepack
- **CI**: GitHub Actions (retention-cleanup workflow)

## Root Cause
Prisma 7.3.0 `prisma-client-js` defaults to TypeScript/WASM "client" engine. `new PrismaClient()` without adapter always fails. `engineType` is deprecated and ignored in v7. The standard v7 pattern requires `@prisma/adapter-pg`.

## What's Been Implemented (Jan 2026)
- `scripts/cleanup-retention.ts` — uses `@prisma/adapter-pg` + `pg` Pool
- `package.json` — added `@prisma/adapter-pg`, `pg`, `@types/pg`
- `yarn.lock` — updated and committed (fixes `--immutable` CI install)
- `.github/workflows/retention-cleanup.yml` — explicit `DATABASE_URL` env on generate/cleanup steps

## Verified locally
- `yarn install --immutable` ✅
- `yarn prisma generate` ✅
- `yarn retention:cleanup` ✅ (PrismaClient init OK, P2010 expected without real DB)
- TypeScript ✅, ESLint ✅

## Backlog
- P0: Push to GitHub, run CI workflow
- P1: `src/lib/db.ts` also uses `new PrismaClient()` — needs adapter
- P2: Real cleanup DELETE logic
