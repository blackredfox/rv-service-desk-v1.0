# RV Service Desk — Product Requirements Document

## Original Problem Statement
A Next.js diagnostic assistant for RV technicians. Structured step-by-step diagnostic procedure engine with LLM rendering.

## Core Architecture
- **Next.js + TypeScript + Vitest**
- Single API endpoint: `POST /api/chat`
- Diagnostic engine: `context-engine` + `diagnostic-registry` + `diagnostic-procedures`
- Retrieval enrichment: optional, additive-only
- **Engine selects step. LLM renders question. No dual authority.**

## Completed Tasks

### Task 01-02: Baseline & Decomposition (DONE)
### Task 03: Diagnostic Authority & Retrieval (DONE)

### Critical Bug Fix: LP Step Loop (DONE - Feb 2026)
**Root cause**: `processMessage()` synced `activeProcedureId` using `registryProcedure.id` — but `DiagnosticProcedure` has no `id` field, only `system`. Result: `activeProcedureId` was always `undefined`, `activeStepId` was never assigned, engine had zero authority. The LLM drove every step.

**Fix**: `registryProcedure.id` → `registryProcedure.system` in `context-engine.ts` step 0 sync.

**Regression tests**: 2 tests in `tests/lp-loop-regression.test.ts`:
1. "газовый Suburban → Баллон полный" → LP tank step does NOT repeat
2. After answering LP appliances → system does NOT return to LP tank step

### Post-Task 03: Voice & Procedure Fixes (DONE - Feb 2026)
- Removed terminal-style headers from prompt
- Fixed wh_9 thermocouple step to be realistic visual check
- Removed "Copy." from acknowledgments

## Current Test Status
- **693 passed, 11 pre-existing failures** (input-language-lock: 6, retention: 5)

## Upcoming Tasks
- **(P1)** Fix remaining 11 pre-existing test failures
- **(Future)** Task 04+ — TBD by user
