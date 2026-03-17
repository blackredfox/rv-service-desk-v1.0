# RV Service Desk — Product Requirements Document

## Original Problem Statement
A Next.js diagnostic assistant for RV technicians. The system helps technicians diagnose problems with RV systems (water heaters, water pumps, furnaces, AC, etc.) through a structured step-by-step diagnostic procedure.

## Core Architecture
- **Next.js + TypeScript + Vitest**
- Single API endpoint: `POST /api/chat`
- Diagnostic engine: `context-engine` (state machine) + `diagnostic-registry` (step tracking) + `diagnostic-procedures` (procedure definitions)
- LLM (OpenAI) renders questions; the engine controls the flow
- Retrieval enrichment: optional, additive-only, failure-tolerant manufacturer-specific hints

## Key Architectural Principle
**The diagnostic procedure engine is the single source of authority for step progression.**
- The registry defines procedures with ordered steps and prerequisites
- The context engine tracks state (active step, completed steps, unable steps, equipment identity)
- The LLM receives ONLY the current active step question — it does NOT decide which step comes next
- Retrieval enrichment may add specificity but CANNOT alter the step sequence

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
- Created structured water heater procedure

### Authoritative Step Progression (DONE - Feb 2026)
1. Server determines next step via `registryGetNextStepId()` — never resets to null
2. Active-step-only matching — completion runs only against `activeStepId`
3. `buildProcedureContext` outputs only `CURRENT STEP` — no completed/unable listings

### Test Suite Cleanup (DONE - Feb 2026)
- Replaced stale `output-validator.validateResponse()` tests
- Fixed `getSafeFallback` test
- Aligned prompt tests with updated prompt contract

### Task 03: Diagnostic Authority and Model/Manufacturer Retrieval (DONE - Feb 2026)

**Part A — Procedure Authority Hardening:**
- Backward drift prevention: engine never assigns a completed/closed step
- "Problem not found" resume: completes current step and advances
- Clarification does NOT close the active step

**Part B — Water Heater Gas Branch Extension:**
- Added 4 new steps (wh_13–wh_16): LP inlet pressure, regulator output, hose routing, hose kink/blockage
- Prerequisite chain: wh_8 → wh_13 → wh_14, wh_13 → wh_15 → wh_16
- Total water heater steps: 12 → 16

**Part C — Equipment Identity:**
- Identity extraction integrated into context engine (not a standalone service)
- Extracts manufacturer, model, year from technician messages
- Supports English and Russian manufacturer names (Cyrillic-aware)
- Stored in `DiagnosticContext.equipmentIdentity`

**Part D — Retrieval Enrichment Layer:**
- New module: `src/lib/retrieval-enrichment.ts`
- Static knowledge base keyed by manufacturer → system → stepId
- Covers: Suburban, Atwood, Dometic, Norcold, Lippert, Carefree, Shurflo
- Model-specific filtering (e.g., Atwood GC-series vs G-series)
- Injected during prompt composition in route.ts (after step selection)
- Cannot alter active step or procedure sequencing

**Part E — Prompt Contract Alignment:**
- Updated `MODE_PROMPT_DIAGNOSTIC.txt` for engine-authority model
- Added enrichment integration rules
- Added "no problem found" handling directive

Files created/modified:
- `src/lib/context-engine/types.ts` — added `EquipmentIdentity` type
- `src/lib/context-engine/context-engine.ts` — drift guard, identity extraction, step initialization safety net
- `src/lib/context-engine/index.ts` — exports
- `src/lib/diagnostic-procedures.ts` — 4 new water heater steps
- `src/lib/retrieval-enrichment.ts` — **new** retrieval layer
- `src/app/api/chat/route.ts` — wired retrieval enrichment
- `prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt` — prompt contract update
- `tests/task03-diagnostic-authority.test.ts` — **new** 25 tests covering all 5 parts

## Current Test Status
- **690 passed, 12 pre-existing failures**
- Pre-existing failures:
  - `input-language-lock.test.ts` (6)
  - `retention.test.ts` (5)
  - `b2b-billing.test.ts` (1, flaky/intermittent)

## Upcoming Tasks
- **(P1)** Fix remaining 12 pre-existing test failures
- **(Future)** Task 04+ — TBD by user
- **(Future)** Diagnostic voice redesign (prompt-only, terminal-style → conversational)
