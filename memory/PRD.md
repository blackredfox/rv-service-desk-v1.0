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

Files changed:
- `src/lib/context-engine/context-engine.ts`
- `src/lib/diagnostic-procedures.ts`
- `src/lib/diagnostic-registry.ts`
- `src/app/api/chat/route.ts`
- `tests/water-heater-diagnostic.test.ts`
- `tests/diagnostic-procedures.test.ts`
- `tests/diagnostic-how-to-check.test.ts`

Test results: 655 passed, 17 known pre-existing failures (unchanged)

## Known Pre-existing Test Failures (P2)
17 failures in:
- `b2b-billing.test.ts` (auth mocking)
- `input-language-lock.test.ts` (6 failures)
- `retention.test.ts` (5 failures)
- `mode-validators.test.ts` (1 failure)
- `prompt-enforcement.test.ts` (5 failures)

## Upcoming Tasks
- **(P0)** User manual testing of water heater scenario to confirm all bugs resolved
- **(P1)** Fix ~17 pre-existing test failures
- **(Future)** Task 03 — details TBD by user
