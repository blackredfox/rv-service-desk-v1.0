# RV Service Desk — Agent Gating & Hardening PRD

## Original Problem Statement
**Phase 1:** Fix agent mode/gating regressions — premature labor pivot after fuse replacement, toxic generic fallback, mode regression, language mixing.
**Phase 2:** Harden diagnostic engine architecture — fuse/breaker must NOT be treated as root cause, action-first procedures, mechanical check before motor replacement, serviceability classification.
**Phase 3 (Current):** Production stability fixes — dynamic language switching, final output stability with edit mode, consistent labor format, report-only mode, unit-level replacement policy.

## Architecture
- **Stack**: Next.js + TypeScript, Vitest for testing, Prisma + PostgreSQL for storage, OpenAI for LLM
- **Key modules**: 
  - `diagnostic-registry.ts` (procedure state + findings + serviceability)
  - `diagnostic-procedures.ts` (structured step sequences)
  - `route.ts` (chat API handler + mode gating + language switching + output lock)
  - `context-engine/` (conversation flow state machine)
  - `mode-validators.ts` (output validation)
  - `labor-store.ts` (labor confirmation)
  - `labor-formatter.ts` (canonical labor output format)
  - `replacement-policy.ts` (unit vs component replacement)
  - `report-only-mode.ts` (direct report generation)
  - `prompt-composer.ts` (prompt building)

## What's Been Implemented

### Phase 3 (Production Stability — Dec 2025)
- **A) Dynamic Language Switching**: `computeEffectiveDialogueLanguage()` in lang.ts detects and switches language per-message (AUTO mode only, MANUAL stays fixed)
- **B) Final Output Lock**: `outputLock` state prevents post-report diagnostic loops; `detectEditIntent()` handles labor adjustments, wording changes, translations
- **C) Consistent Labor Format**: `formatLaborBreakdown()` ensures breakdown + total in all outputs; `buildLaborFormatConstraint()` enforces format in prompts
- **D) Report-Only Mode**: `detectReportOnlyScenario()` generates immediate output when technician provides complete findings
- **E) Unit Replacement Policy**: `getReplacementPolicy()` enforces "replace assembly" for fixtures (ceiling fan, water pump) over "replace motor"

### Phase 2 (Diagnostic Hardening — Jan 2026)
- **§1**: Removed fuse/breaker/no-power-downstream from KEY_FINDING_PATTERNS — these are diagnostic branches, not isolation triggers
- **§2**: Refactored 12V electrical procedure to action-first directive steps (tell what to do + how to reply)
- **§3**: Added mandatory mechanical check step (e12_6) for motorized loads before concluding component failure
- **§4**: Added Serviceability classification layer (types + FINDING_META for all findings)

### Phase 1 (Mode Gating — Jan 2026)
- **P1**: `canTransitionToLabor()` gates all transitions by procedure state
- **P2**: `detectRepairNotRestored()` blocks transition when repair fails (EN/RU/ES)
- **P3**: Fixed `updateCaseDb()` to persist mode; fixed `parseLaborConfirmation()` for questions
- **P4**: Updated labor prompt with question handling instructions
- **P5**: Replaced toxic "provide more info" fallback with procedure-aware responses

## Files Modified/Created in Phase 3
| File | Change |
|------|--------|
| `src/lib/lang.ts` | Added `detectMessageLanguage()`, `computeEffectiveDialogueLanguage()` for dynamic switching |
| `src/lib/context-engine/types.ts` | Added `OutputLock`, `EditIntent` types |
| `src/lib/context-engine/edit-mode.ts` | NEW: Edit intent detection, output lock management |
| `src/lib/context-engine/index.ts` | Exported edit mode functions |
| `src/lib/context-engine/context-engine.ts` | Added `outputLock`, `lastEmittedOutput` to context |
| `src/lib/labor-formatter.ts` | NEW: Canonical labor formatting with breakdown + total |
| `src/lib/replacement-policy.ts` | NEW: Unit vs component replacement policy |
| `src/lib/report-only-mode.ts` | NEW: Report-only scenario detection |
| `src/app/api/chat/route.ts` | Integrated all Phase 3 features |
| `tests/language-switching.test.ts` | NEW: 11 tests for dynamic language switching |
| `tests/final-output-lock.test.ts` | NEW: 22 tests for output lock and edit mode |
| `tests/labor-format-contract.test.ts` | NEW: 13 tests for labor formatting |
| `tests/report-only-scenario.test.ts` | NEW: 12 tests for report-only detection |
| `tests/replacement-policy.test.ts` | NEW: 16 tests for replacement policy |

## Test Results
- **74 new Phase 3 tests — ALL PASSING**
- **648 total tests passing** across the test suite
- **45 pre-existing failures** in jsdom/localStorage/API key tests (out of scope)

## Backlog
- P0: None — all Phase 3 acceptance criteria met
- P1: Persist Context Engine state to Prisma DB for serverless robustness
- P1: Add `labor_confirmation` to Prisma CaseMode enum for full DB persistence
- P2: Fix pre-existing jsdom environment issue for DOM tests
- P2: Expand action-first refactor to other procedures (furnace, roof_ac, etc.)
- P3: Add procedure-variant support (ADVANCED procedures for complex systems)

## Next Tasks
- Live integration testing to verify production behavior
- User testing of language switching with EN↔RU mid-conversation
- User testing of edit mode after final report generation
