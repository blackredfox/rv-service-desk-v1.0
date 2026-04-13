# RV Service Desk — PR-2: Evidence Integrity + Step/State Consistency

## Original Problem Statement
Fix evidence corruption and step/state inconsistency in the chat runtime for guided diagnostics.
Target branch: `fix/evidence-integrity-and-step-state`
Base branch: `neo-base/evidence-integrity-and-step-state`

## Architecture
- Next.js full-stack app with Prisma + Firebase + OpenAI
- Context Engine is the single flow authority for diagnostic state
- Validation/retry pipeline catches LLM output policy violations
- Step progression managed by diagnostic registry + context engine

## Core Requirements (Static)
- Summaries/recaps grounded only in actual collected evidence
- Corrected technician answers override mistaken values
- Step numbering and progression remain stable
- No premature recap/report-ready while evidence is unresolved
- No internal repair/debug artifacts visible to technicians

## What's Been Implemented (2026-01-17)
### Root Causes Found
1. **Intent misclassification**: `TECHNICAL_CONTEXT_PATTERNS` in intent-router.ts lacked Cyrillic measurement units (В, мВ, Ом, etc.), causing correction messages like "ой, 12В" to be classified as `CONFIRMATION(12)` instead of `MAIN_DIAGNOSTIC`
2. **Repair artifact leakage**: `validateDiagnosticOutput` had no check for `[System]`, `[Repair]`, `[Debug]` scaffolding markers, allowing them to pass validation and reach users
3. **Duplicate step numbering**: `validateStepCompliance` didn't explicitly detect "Шаг 6: ... Шаг 6: ..." patterns; also missing `cab_` prefix in step ID regex

### Files Changed
- `src/lib/context-engine/intent-router.ts` — Added Cyrillic/Spanish measurement unit patterns to TECHNICAL_CONTEXT_PATTERNS
- `src/lib/mode-validators.ts` — Added repair artifact detection (containsRepairArtifact), duplicate step-numbering check, `cab_` prefix to step ID regex
- `tests/chat-evidence-integrity-regression.test.ts` — Added 2 new tests + strengthened Case-41 assertions

### Tests (6 total in evidence-integrity suite)
- Case-39: Evidence grounding / invented recap suppression ✓
- Case-40: Duplicate step numbering / contradictory recap ✓
- Case-41: Immediate correction handling + intent correctness ✓
- Case-42: Follow-up hypothesis reopens investigation ✓
- Intent regression: Cyrillic units ≠ labor confirmations ✓
- Repair artifact regression: scaffolding text blocked ✓

### Broader regression: 221 tests across 16 files — all green

## Explicit Non-Scope Confirmation
Report-intent / `START FINAL REPORT` behavior was intentionally left unchanged for PR-3. No report-intent scope drift occurred.

## Backlog (Next PR)
- P0: Natural-language final report triggering
- P0: `START FINAL REPORT` alias support improvements
- P1: Missing-field minimization for report generation
- P1: Work-list drafting / labor editing workflow
- P2: Broad prompt redesign
