# RV Service Desk — Agent Gating & Hardening PRD

## Original Problem Statement
**Phase 1:** Fix agent mode/gating regressions — premature labor pivot after fuse replacement, toxic generic fallback, mode regression, language mixing.
**Phase 2:** Harden diagnostic engine architecture — fuse/breaker must NOT be treated as root cause, action-first procedures, mechanical check before motor replacement, serviceability classification.
**Phase 3 (Context Engine):** Transform agent from "coin-operated chatbot" into professional diagnostic partner — handle clarifications, support replan on new evidence, prevent loops, non-blocking labor confirmation.
**Phase 4 (Mechanical + Labor Fix):** Ensure mechanical checks are required before isolation, remove interactive labor confirmation loop.

## Architecture
- **Stack**: Next.js + TypeScript, Vitest for testing, Prisma + PostgreSQL for storage, OpenAI for LLM
- **Key modules**: 
  - `diagnostic-registry.ts` (procedure state + findings + serviceability)
  - `diagnostic-procedures.ts` (structured step sequences)
  - `route.ts` (chat API handler + mode gating)
  - `mode-validators.ts` (output validation)
  - `labor-store.ts` (labor confirmation)
  - `prompt-composer.ts` (prompt building)
  - `context-engine/` (conversation manager — SINGLE FLOW AUTHORITY)

## What's Been Implemented

### Phase 1 (Mode Gating — Jan 2026)
- **P1**: `canTransitionToLabor()` gates all transitions by procedure state
- **P2**: `detectRepairNotRestored()` blocks transition when repair fails (EN/RU/ES)
- **P3**: Fixed `updateCaseDb()` to persist mode; fixed `parseLaborConfirmation()` for questions
- **P4**: Updated labor prompt with question handling instructions
- **P5**: Replaced toxic "provide more info" fallback with procedure-aware responses

### Phase 2 (Diagnostic Hardening — Jan 2026)
- **§1**: Removed fuse/breaker/no-power-downstream from KEY_FINDING_PATTERNS
- **§2**: Refactored 12V electrical procedure to action-first directive steps
- **§3**: Added mandatory mechanical check step (e12_6) for motorized loads
- **§4**: Added Serviceability classification layer (types + FINDING_META)

### Phase 3 (Context Engine — Feb 2026)
- **ADR**: `docs/ADR-CTX-ENGINE.md` — full design document (Finalized - Strict Mode)
- **Intent Router**: Server-side deterministic detection of LOCATE/EXPLAIN/HOWTO/NEW_EVIDENCE intents
- **Topic Stack**: Push/pop clarification subflows with return to main diagnostic step
- **Replan Logic**: Detect new evidence after isolation → invalidate prior conclusion → explore new branch
- **Loop Guard**: Prevent consecutive fallbacks, re-asking completed steps, max repeat limits
- **Non-Blocking Labor**: Labor confirmation is draft by default, technician can continue diagnostics
- **STRICT_CONTEXT_ENGINE=true**: Context Engine is ONLY flow authority

### Phase 4 (Mechanical + Labor — Feb 2026)
- **Mechanical Check Flag**: Added `mechanicalCheck` flag to DiagnosticStep type
- **Direct Power Test**: Marked e12_6, awn_6, so_3, e12_7 as mechanicalCheck=true
- **Pivot Guard**: `areMechanicalChecksComplete()` blocks pivot until mechanical steps done
- **Non-Interactive Labor**: Removed labor_confirmation mode as intermediate step
- **Direct Final Report**: diagnostic → final_report (skip labor confirmation)
- **Labor Override**: "set labor to X hours" is parsed and stored, reflected in final report

## Files Modified
| File | Phase | Change |
|------|-------|--------|
| `src/lib/diagnostic-registry.ts` | 1+2+4 | repairNotRestored, canTransitionToLabor, fuse removal, Serviceability, areMechanicalChecksComplete |
| `src/lib/diagnostic-procedures.ts` | 2+4 | Action-first 12V electrical, mechanicalCheck flag |
| `src/app/api/chat/route.ts` | 1+3+4 | Gated pivot, Context Engine, mechanical check guard, no labor_confirmation |
| `src/lib/context-engine/*` | 3 | Intent router, loop guard, replan, topic stack |
| `src/lib/labor-store.ts` | 1+4 | Question guard, clearLaborStore |
| `tests/context-engine*.ts` | 3 | 48 context engine tests |
| `tests/route-strictness.test.ts` | 3 | 13 strictness tests |
| `tests/mechanical-steps-labor.test.ts` | 4 | 15 mechanical/labor tests |

## Test Results
- **548 tests across 37 test files**
- **537 PASSING** (48 context-engine + 13 strictness + 15 mechanical-labor)
- **11 pre-existing failures** (language-detection + prisma-retention — out of scope)

## Backlog
- P0: None — Mechanical checks required, labor confirmation removed
- P1: Persist context to database (Prisma) for serverless cold starts
- P2: Fix pre-existing jsdom environment issue for DOM tests (5 test files)
- P2: Expand action-first refactor to other procedures (furnace, roof_ac, etc.)
- P2: Remove deprecated legacy functions from diagnostic-registry (cleanup)
- P3: Add procedure-variant support (ADVANCED procedures for complex systems)

## Next Tasks
- Live integration testing with actual OpenAI calls to verify end-to-end behavior
- Context persistence to database for serverless environments
- Expand serviceability classification to cover all procedures
