# RV Service Desk — Agent Gating & Hardening PRD

## Original Problem Statement
**Phase 1:** Fix agent mode/gating regressions — premature labor pivot after fuse replacement, toxic generic fallback, mode regression, language mixing.
**Phase 2:** Harden diagnostic engine architecture — fuse/breaker must NOT be treated as root cause, action-first procedures, mechanical check before motor replacement, serviceability classification.

## Architecture
- **Stack**: Next.js + TypeScript, Vitest for testing, Prisma + PostgreSQL for storage, OpenAI for LLM
- **Key modules**: `diagnostic-registry.ts` (procedure state + findings + serviceability), `diagnostic-procedures.ts` (structured step sequences), `route.ts` (chat API handler + mode gating), `mode-validators.ts` (output validation), `labor-store.ts` (labor confirmation), `prompt-composer.ts` (prompt building)

## What's Been Implemented

### Phase 1 (Mode Gating — Jan 2026)
- **P1**: `canTransitionToLabor()` gates all transitions by procedure state
- **P2**: `detectRepairNotRestored()` blocks transition when repair fails (EN/RU/ES)
- **P3**: Fixed `updateCaseDb()` to persist mode; fixed `parseLaborConfirmation()` for questions
- **P4**: Updated labor prompt with question handling instructions
- **P5**: Replaced toxic "provide more info" fallback with procedure-aware responses

### Phase 2 (Diagnostic Hardening — Jan 2026)
- **§1**: Removed fuse/breaker/no-power-downstream from KEY_FINDING_PATTERNS — these are diagnostic branches, not isolation triggers
- **§2**: Refactored 12V electrical procedure to action-first directive steps (tell what to do + how to reply)
- **§3**: Added mandatory mechanical check step (e12_6) for motorized loads before concluding component failure
- **§4**: Added Serviceability classification layer (types + FINDING_META for all findings)

## Files Modified
| File | Phase | Change |
|------|-------|--------|
| `src/lib/diagnostic-registry.ts` | 1+2 | repairNotRestored, canTransitionToLabor, fuse removal, Serviceability + FINDING_META |
| `src/lib/diagnostic-procedures.ts` | 2 | Action-first 12V electrical procedure + mechanical check step |
| `src/app/api/chat/route.ts` | 1 | Gated pivot + auto-transition, procedure-aware fallback |
| `src/lib/mode-validators.ts` | 1 | Non-toxic FALLBACK_QUESTIONS |
| `src/lib/labor-store.ts` | 1 | Question guard in parseLaborConfirmation |
| `src/lib/storage.ts` | 1 | Mode in DB update |
| `prompts/modes/MODE_PROMPT_LABOR_CONFIRMATION.txt` | 1 | Question handling instructions |
| `tests/agent-gating.test.ts` | 1+2 | 33 tests covering all acceptance criteria |
| `tests/diagnostic-registry.test.ts` | 2 | Fuse-not-key-finding tests |
| `tests/diagnostic-how-to-check.test.ts` | 2 | Updated for fuse removal + mechanical check |
| `tests/mode-validators.test.ts` | 1 | Updated fallback expectations |
| `tests/payload-v2.test.ts` | 1 | Updated fallback expectations |

## Test Results
- **543 tests across 36 test files — 532 PASSING**
- **11 pre-existing failures** (language detection & prisma/retention tests — unrelated to hotfix)
- **69 diagnostic-registry/how-to-check tests — ALL PASSING**
- **Hotfix verified**: fuse/breaker patterns removed, serviceability layer added with tests

## Backlog
- P0: None — all acceptance criteria met
- P1: Add `labor_confirmation` to Prisma CaseMode enum for full DB persistence
- P1: Integrate FINDING_META into route.ts for actionHint injection into prompts
- P2: Fix pre-existing jsdom environment issue for DOM tests (5 test files)
- P2: Expand action-first refactor to other procedures (furnace, roof_ac, etc.)
- P3: Add procedure-variant support (ADVANCED procedures for complex systems)

## Next Tasks
- Live integration testing with actual OpenAI calls to verify prompt behavior
- Route.ts integration of FINDING_META actionHint into diagnostic context
- Expand serviceability classification to cover all procedures
