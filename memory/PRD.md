# RV Service Desk — PRD & Implementation Memory

## Original Problem Statement
Transform the diagnostic Agent from a mechanical/template-driven assistant into a professional senior RV technician with strict procedural diagnostics. No repeated questions, no invented steps, no cross-system drift, initial message pre-completion, and LP Gas pressure-before-ignition ordering.

## Architecture
- **Stack**: Next.js (App Router), TypeScript, Vitest, OpenAI API
- **Diagnostic flow**: `diagnostic` (procedure-guided) → `labor_confirmation` → `final_report`
- **Procedure model**: `diagnostic-procedures.ts` — structured data, not prompt text
- **Step tracking**: `diagnostic-registry.ts` — procedure-aware per-case registry
- **Language policy**: `lang.ts` → `prompt-composer.ts` → `mode-validators.ts`
- **Retention**: `retention.ts` — 30-day TTL from lastActivityAt

## What's Been Implemented

### Session 1 — Language Policy
- Declarative `LanguagePolicy` in `lang.ts`

### Session 2 — Labor Confirmation + Copy UX
- `labor_confirmation` mode, labor sum validation, copy button feedback

### Session 3 — Diagnostic Behavior Fix
- Diagnostic question registry, pivot rules, fact-locked reports, tone adjustment

### Session 4 — Case Persistence + Retention
- 30-day retention, expiration badges, cleanup script

### Session 5 (Jan 2026) — Pro-Tech Diagnostic Behavior

#### A. Diagnostic Procedures Model (`src/lib/diagnostic-procedures.ts`)
- **Types**: `DiagnosticStep { id, question, prerequisites, matchPatterns }`, `DiagnosticProcedure { system, displayName, complex, variant, steps }`
- **11 system procedures**: water_pump, lp_gas, furnace, roof_ac, refrigerator, slide_out, leveling, inverter_converter, electrical_12v, electrical_ac, consumer_appliance
- **System detection**: `detectSystem(message)` — pattern-based, ordered to avoid ambiguity
- **Step ordering**: `getNextStep(procedure, completedIds, unableIds)` — prerequisite-aware
- **Initial mapping**: `mapInitialMessageToSteps(message, procedure)` — pre-completes steps from technician's first message
- **Context building**: `buildProcedureContext()` — injects active procedure, progress, next step into prompt

#### B. Procedure-Aware Registry (`src/lib/diagnostic-registry.ts`)
- Full rewrite: tracks `completedStepIds`, `unableStepIds`, `procedureSystem`
- `initializeCase()` — detects system, selects procedure, maps initial message to completed steps
- `processUserMessage()` — step-level tracking + legacy topic tracking
- `buildRegistryContext()` — procedure context when available, legacy fallback otherwise
- No re-initialization: first system detection is locked for the case

#### C. Route Integration (`src/app/api/chat/route.ts`)
- Calls `initializeCase()` on first diagnostic message
- Injects procedure context as `additionalConstraints`
- Pivot detection + key finding handling preserved

#### D. Prompt Update (`MODE_PROMPT_DIAGNOSTIC.txt`)
- "PROCEDURE IS LAW" — agent MUST follow active procedure, NEVER invent steps
- References injected ACTIVE PROCEDURE block
- No cross-system drift allowed
- No safety lecturing
- Professional tone: "Noted.", "Confirmed." only

#### Tests
- `tests/diagnostic-procedures.test.ts` — 30 tests (system detection, step ordering, initial mapping, context building)
- `tests/diagnostic-registry.test.ts` — 26 tests (procedure-aware tracking, key findings, pivoting)
- Updated `tests/prompt-enforcement.test.ts`, `tests/prompt-composer.test.ts`, `tests/tone-adjustment.test.ts`
- Total: 504 tests passing, 35 test files

## Backlog
- P0: None
- P1: Manufacturer-specific procedures (when model/year provided)
- P1: Procedure authoring API for admins
- P2: Auto-learning from completed diagnostics to improve step ordering
- P2: Procedure coverage metrics (which steps are most often unable-to-verify)
