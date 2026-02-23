# RV Service Desk — Agent Gating & Hardening PRD

## Original Problem Statement
**Phase 1:** Fix agent mode/gating regressions — premature labor pivot after fuse replacement, toxic generic fallback, mode regression, language mixing.
**Phase 2:** Harden diagnostic engine architecture — fuse/breaker must NOT be treated as root cause, action-first procedures, mechanical check before motor replacement, serviceability classification.
**Phase 3 (Context Engine):** Transform agent from "coin-operated chatbot" into professional diagnostic partner — handle clarifications, support replan on new evidence, prevent loops, non-blocking labor confirmation.

## Architecture
- **Stack**: Next.js + TypeScript, Vitest for testing, Prisma + PostgreSQL for storage, OpenAI for LLM
- **Key modules**: 
  - `diagnostic-registry.ts` (procedure state + findings + serviceability)
  - `diagnostic-procedures.ts` (structured step sequences)
  - `route.ts` (chat API handler + mode gating)
  - `mode-validators.ts` (output validation)
  - `labor-store.ts` (labor confirmation)
  - `prompt-composer.ts` (prompt building)
  - **NEW** `context-engine/` (conversation manager)

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

### Phase 3 (Context Engine — Feb 2026)
- **ADR**: `docs/ADR-CTX-ENGINE.md` — full design document
- **Intent Router**: Server-side deterministic detection of LOCATE/EXPLAIN/HOWTO/NEW_EVIDENCE intents
- **Topic Stack**: Push/pop clarification subflows with return to main diagnostic step
- **Replan Logic**: Detect new evidence after isolation → invalidate prior conclusion → explore new branch
- **Loop Guard**: Prevent consecutive fallbacks, re-asking completed steps, max repeat limits
- **Non-Blocking Labor**: Labor confirmation is draft by default, technician can continue diagnostics

## Files Modified
| File | Phase | Change |
|------|-------|--------|
| `src/lib/diagnostic-registry.ts` | 1+2 | repairNotRestored, canTransitionToLabor, fuse removal, Serviceability + FINDING_META |
| `src/lib/diagnostic-procedures.ts` | 2 | Action-first 12V electrical procedure + mechanical check step |
| `src/app/api/chat/route.ts` | 1 | Gated pivot + auto-transition, procedure-aware fallback |
| `src/lib/mode-validators.ts` | 1 | Non-toxic FALLBACK_QUESTIONS |
| `src/lib/labor-store.ts` | 1 | Question guard in parseLaborConfirmation |
| `src/lib/storage.ts` | 1 | Mode in DB update |
| `prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt` | 3 | Clarification subflows, replan rules, anti-loop rules |
| `prompts/modes/MODE_PROMPT_LABOR_CONFIRMATION.txt` | 3 | Non-blocking labor mode |
| `src/lib/context-engine/types.ts` | 3 | Complete type definitions |
| `src/lib/context-engine/intent-router.ts` | 3 | Server-side intent detection |
| `src/lib/context-engine/loop-guard.ts` | 3 | Anti-loop protection |
| `src/lib/context-engine/replan.ts` | 3 | Replan logic |
| `src/lib/context-engine/topic-stack.ts` | 3 | Clarification subflow management |
| `src/lib/context-engine/context-engine.ts` | 3 | Main orchestrator |
| `tests/context-engine.test.ts` | 3 | 26 tests for context engine |
| `tests/context-engine-integration.test.ts` | 3 | 9 integration tests for route.ts wiring |
| `tests/route-strictness.test.ts` | 3 | 13 tests ensuring strict context engine mode |

## Test Results
- **581 tests across 39 test files**
- **570 PASSING** (48 context-engine tests: 26 unit + 9 integration + 13 strictness)
- **11 pre-existing failures** (language-detection + prisma-retention — out of scope)

## Backlog
- P0: None — Context Engine is single flow authority (STRICT_CONTEXT_ENGINE=true)
- P1: Persist context to database (Prisma) for serverless cold starts
- P1: Add `labor_confirmation` to Prisma CaseMode enum for full DB persistence
- P1: Integrate FINDING_META into route.ts for actionHint injection into prompts
- P2: Fix pre-existing jsdom environment issue for DOM tests (5 test files)
- P2: Expand action-first refactor to other procedures (furnace, roof_ac, etc.)
- P2: Remove deprecated legacy functions from diagnostic-registry (cleanup)
- P3: Add procedure-variant support (ADVANCED procedures for complex systems)

## Next Tasks
- Live integration testing with actual OpenAI calls to verify end-to-end behavior
- Context persistence to database for serverless environments
- Expand serviceability classification to cover all procedures
