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
- Removed auto-transition to final report
- Added validator to block LLM from declaring "isolation complete"
- Added language consistency validation
- Created structured water heater procedure (12 steps)

### Authoritative Step Progression (DONE - Feb 2026)
1. Server determines next step via `registryGetNextStepId()` — never resets to null
2. Active-step-only matching — completion runs only against `activeStepId`
3. `buildProcedureContext` outputs only `CURRENT STEP` — no completed/unable listings
4. Fixed `getNextStepId()` returning full object instead of string ID

### Test Suite Cleanup (DONE - Feb 2026)
- Replaced 5 stale `output-validator.validateResponse()` tests → now test runtime `mode-validators.ts`
- Fixed `getSafeFallback` test: unknown language returns language choice prompt, not EN fallback
- **Failures reduced: 17 → 11** (stable), auth tests are flaky (+/- 2)
- 666 tests passing

### Terminal-Style Output (Confirmed Feb 2026)
Prompt-driven via `MODE_PROMPT_DIAGNOSTIC.txt`, not flow-driven. Voice redesign = prompt edit only.

## Current Test Status
- **666 passed, 11 stable failures**
- Remaining:
  - `input-language-lock.test.ts` (6) — stale test assumptions
  - `retention.test.ts` (5) — storage API mismatch
  - `b2b-billing.test.ts` / `org-activity.test.ts` — flaky auth (intermittent)

## Upcoming Tasks
- **(P1)** Fix remaining 11 stable test failures
- **(Future)** Task 03 — TBD by user
- **(Future)** Diagnostic voice redesign (prompt-only)
