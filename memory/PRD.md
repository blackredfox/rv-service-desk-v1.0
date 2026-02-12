# RV Service Desk v1.0 — PRD

## Original Problem Statement
Fix Diagnostic Procedure Runner for "How to check?", De-dupe Steps, Awning Electrical Order, and Portal-Cause Correctness.

## Architecture
- **Stack**: Next.js 16, TypeScript 5.9, Prisma 7.3, PostgreSQL
- **Package Manager**: Yarn 4.12 via Corepack
- **CI**: GitHub Actions

## What's Been Implemented (Jan 2026)

### P0: CI retention cleanup (DONE)
### P1: Main app Prisma client + schema (DONE)
### P1: Vitest setup — disable DB env (DONE)
### P1: Diagnostic procedure fixes (DONE)

**Files changed:**
1. `src/lib/diagnostic-procedures.ts`
   - Added `howToCheck?: string` to DiagnosticStep type
   - Added `getStepHowToCheck()` function
   - Updated `buildProcedureContext()` to include how-to-check instructions
   - Rewrote `electrical_12v` order: supply → fuse/CB → switch → ground → voltage → direct power
   - Added `awning` procedure (6 steps, 12V standard)
   - Added `awning` to SYSTEM_PATTERNS

2. `src/lib/diagnostic-registry.ts`
   - Added `detectHowToCheck()` with EN/RU/ES patterns
   - Updated `processUserMessage()`: early return on how-to-check (no step close)
   - Added `askedStepIds` Set + `markStepAsked()` / `isStepAlreadyAsked()` (de-dupe guard)
   - Added blown fuse / tripped breaker key finding patterns

3. `prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt`
   - Added CAUSE-CORRECTNESS RULES (fuse blown ≠ replace motor)
   - Added HOW-TO-CHECK HANDLING rules

4. `src/app/api/chat/route.ts` — log how-to-check event

5. `tests/diagnostic-how-to-check.test.ts` — 29 new tests

### Verification
- yarn test: 533/533 passed (36 files)
- TypeScript: 20 errors (all pre-existing)
- ESLint: 0 errors on changed files
- All 4 acceptance criteria covered by tests

## Backlog
- P2: Manufacturer-specific procedure variants
- P2: Fix pre-existing Stripe API version mismatch
