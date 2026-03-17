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

### P0: Procedure Catalog Framework (DONE - Jan 2026)
Created framework documentation and TypeScript schema for systematic procedure development:

**Files Created:**
- `docs/PROCEDURE_CATALOG_FRAMEWORK.md` — Schema, subtype handling, branching, completion criteria
- `docs/PROCEDURE_AUTHORING_STANDARD.md` — Naming conventions, step writing rules, review checklist
- `docs/PROCEDURE_ROLLOUT_PLAN.md` — Phased rollout plan for 6 equipment families
- `src/lib/procedures/procedure-schema.ts` — TypeScript type definitions (non-breaking)
- `src/lib/procedures/index.ts` — Module exports

**Key Framework Features:**
- 3-level subtype hierarchy (primary → secondary → tertiary) with gating
- Step categories (default/advanced/expert) for realistic flow
- Branch definitions with mutual exclusivity
- Completion criteria with key finding shortcuts
- Retrieval boundary enforcement (retrieval enriches, never controls)
- Destructive finding documentation

**Priority Rollout Order:**
1. Water Heater (P0 — first full rewrite)
2. Water Pump (P1 — reference baseline)
3. Furnace (P2)
4. Roof AC (P3)
5. Refrigerator (P4)
6. Slide/Leveling (P5)

### P1: Engine Execution Authority Fix (DONE - Jan 2026)
Fixed the architectural gap where Context Engine was advisory-only, not truly authoritative.

**Root Cause:**
- Engine computed `activeStepId` correctly, but it was passed to LLM as prompt text only
- No validation that LLM output matched the active step
- Loop recovery was detected but never applied

**Changes:**
- **Step Compliance Validation** (`mode-validators.ts`) — `validateStepCompliance()` checks LLM output matches active step
- **Contextual Completion** — `isStepAnswered()` accepts short answers ("yes", "12V", "да")
- **Loop Recovery Enforcement** (`route.ts`) — Now applies recovery, force-completes stuck steps
- **Authoritative Fallback** (`output-policy.ts`) — When LLM fails, returns exact step question
- **Registry Extensions** — `getActiveStepMetadata()`, `forceStepComplete()`, `isProcedureFullyComplete()`

**ADR:** `docs/ADR-ENGINE-EXECUTION-AUTHORITY.md`

### P1.5: Branch-Aware Step Resolution (DONE - Jan 2026)
Fixed flat step list treating parallel branches as simultaneous.

**Problem:**
- `getNextStep()` operated on `completedStepIds + unableStepIds` WITHOUT branch constraints
- No concept of active branch, decision tree, or path locking
- Same step ID could have different meanings in different contexts

**Solution:**
- **Branch State Tracking** — `activeBranchId`, `decisionPath`, `lockedOutBranches` in registry
- **Branch-Aware Resolution** — `getNextStepBranchAware()` considers active branch
- **Mutual Exclusivity** — Entering `no_ignition` locks out `flame_failure` and vice versa
- **Branch Trigger Detection** — `detectBranchTrigger()` identifies when to enter a branch
- **Water Heater Branches** — Added 3 branches: `no_ignition`, `flame_failure`, `no_gas`

**ADR:** `docs/ADR-BRANCH-AWARE-RESOLUTION.md`

### P1.5b: Branch Runtime Integration (DONE - Jan 2026)
Integrated branch processing into route.ts runtime path.

**Problem Found:**
- Branch infrastructure was built but NOT integrated into runtime
- `processResponseForBranch()` was never called after step completion
- Steps stayed on same ID (`wh_7`) while asking different semantic questions

**Fix Applied:**
- `route.ts` now calls `processResponseForBranch()` after `markStepCompleted()`
- Branch trigger check syncs state to context engine
- Auto branch exit when branch steps exhausted (returns to main flow)
- Added locked-out branch check in `processResponseForBranch()`

**Tests:** 670 passing (+ 5 new branch-runtime-integration tests)

## Upcoming Tasks
- **(P2)** Add branches to furnace, roof AC procedures
- **(P3)** Fix remaining stable test failures (Prisma issues)
- **(Future)** Diagnostic voice redesign (prompt-only)
