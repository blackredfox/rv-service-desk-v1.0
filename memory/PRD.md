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
### Task 02: Route Decomposition (DONE)

### Task 03: Diagnostic Authority and Model/Manufacturer Retrieval (DONE - Feb 2026)
- Part A: Backward drift prevention, "problem not found" resume, clarification safety
- Part B: Water heater gas branch (wh_13–wh_16)
- Part C: Equipment identity extraction in context engine
- Part D: Retrieval enrichment layer
- Part E: Prompt contract alignment

### Post-Task 03 Fixes (DONE - Feb 2026)
**Issue 1 — Terminal-style output removed:**
- Removed CRITICAL OUTPUT RULES block (System/Classification/Mode/Status headers)
- Removed RESPONSE FORMAT with `Step [N]:` template
- Replaced with natural shop-style conversational format
- Removed "Copy." from acknowledgment list

**Issue 2 — "Detected RU · Reply RU":**
- Confirmed UI/test harness label, NOT model output. No changes needed.

**Issue 3 — wh_9 procedure realism:**
- Default question changed to practical visual/tactile check: "clean, free of soot, sitting in flame path?"
- mV measurement removed from default question
- mV noted as "Advanced" optional info in howToCheck only
- Not required for branch completion in normal shop workflow
- Retrieval enrichment updated to match (Suburban: carbon buildup focus; Atwood: position/cleaning focus)

## Current Test Status
- **689 passed, 13 pre-existing failures** (input-language-lock: 6, retention: 5, b2b/org-activity: 2 flaky)

## Upcoming Tasks
- **(P1)** Fix remaining pre-existing test failures
- **(Future)** Task 04+ — TBD by user
