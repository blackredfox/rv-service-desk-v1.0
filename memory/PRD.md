# RV Service Desk — Product Requirements Document

## Original Problem Statement
A Next.js diagnostic assistant for RV technicians. The system helps technicians diagnose problems with RV systems (water heaters, water pumps, furnaces, AC, etc.) through a structured step-by-step diagnostic procedure.

## Core Architecture
- **Next.js + TypeScript + Vitest**
- Single API endpoint: `POST /api/chat`
- Diagnostic engine: `context-engine` (state machine) + `diagnostic-registry` (step tracking) + `diagnostic-procedures` (procedure definitions)
- LLM (OpenAI) renders questions; the engine controls the flow

## Key Architectural Principle
**The diagnostic procedure engine is the single source of authority for step progression.**
- The registry defines procedures with ordered steps and prerequisites
- The context engine tracks state (active step, completed steps, unable steps)
- The LLM receives ONLY the current active step question — it does NOT decide which step comes next

## Completed Tasks

### Task 01: Rollback & Baseline (DONE)
- Established baseline: 588+ passed, ~17 known failures
- Report: `reports/baseline-report.md`

### Task 02: Route Decomposition (DONE)
- Refactored `app/api/chat/route.ts` into modules under `src/lib/chat/`
- ADR: `docs/adr/001-chat-module-decomposition.md`

### Bug Fixes (DONE)
- Removed auto-transition to final report (LLM-driven `[TRANSITION: FINAL_REPORT]` removed)
- Added validator to block LLM from declaring "isolation complete"
- Added language consistency validation
- Created structured water heater procedure (12 steps)

### Authoritative Step Progression (DONE - Feb 2026)
Three corrections implemented:
1. **Server determines next step**: After step completion, engine immediately assigns next step via `registryGetNextStepId()` — never resets to null
2. **Active-step-only matching**: Step completion runs only against `activeStepId`, not all procedure steps
3. **LLM sees only active step**: `buildProcedureContext` outputs only `CURRENT STEP: <id>` + question — no completed/unable step listings

Fixed bug: `getNextStepId()` was returning full `DiagnosticStep` object instead of string ID.

### Test Suite Cleanup (DONE - Feb 2026)
- Replaced 5 stale `output-validator.validateResponse()` tests in `prompt-enforcement.test.ts`
- New tests target the real runtime validators: `validateDiagnosticOutput`, `validateLanguageConsistency`, `validateFinalReportOutput` from `mode-validators.ts`
- Dead code path (`output-validator.ts`) no longer tested
- Test failures reduced: 17 → 12

### Terminal-Style Output Confirmation (Feb 2026)
Confirmed: the structured diagnostic output (System, Classification, Mode, Status, Step IDs) is 100% **prompt-driven** via `MODE_PROMPT_DIAGNOSTIC.txt`, not flow-driven. Changing the voice requires only prompt edits — no engine changes needed.

## Current Test Status
- **665 passed, 12 failed** (down from 17)
- Remaining failures are pre-existing in:
  - `input-language-lock.test.ts` (6) — stale test assumptions
  - `retention.test.ts` (5) — storage API mismatch
  - `mode-validators.test.ts` (1) — edge case

## Upcoming Tasks
- **(P1)** Fix remaining 12 pre-existing test failures
- **(Future)** Task 03 — details TBD by user
- **(Future)** Diagnostic voice redesign — remove terminal-style headers from prompt
